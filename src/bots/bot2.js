"use strict";

const crypto =
  require("crypto");

const Application =
  require("../models/application");

const eventBus =
  require("../utils/event-bus");

const {
  requireAutomationRelease
} =
  require(
    "../services/admin/automation-guard"
  );

const logger =
  require("../utils/logger");

const {
  STATES,
  isKnownState
} =
  require(
    "../services/application/application-state-machine"
  );


const MIN_INTERVAL =
  Math.max(
    3000,
    Number(
      process.env.RADAR_MIN_INTERVAL_MS
    ) || 5000
  );

const MAX_INTERVAL =
  Math.max(
    MIN_INTERVAL,
    Number(
      process.env.RADAR_MAX_INTERVAL_MS
    ) || 30000
  );

const ERROR_COOLDOWN =
  Math.max(
    10000,
    Number(
      process.env.RADAR_ERROR_COOLDOWN_MS
    ) || 30000
  );

const TIMEOUT =
  Math.max(
    3000,
    Number(
      process.env.BOT2_TIMEOUT_MS
    ) || 10000
  );

const BATCH_SIZE =
  Math.max(
    1,
    Number(
      process.env.BOT2_BATCH_SIZE
    ) || 20
  );


/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function withTimeout(
  promise,
  timeoutMs,
  operation
) {
  let timer;

  const timeout =
    new Promise(
      (_, reject) => {
        timer =
          setTimeout(
            () => {
              reject(
                new Error(
                  `${operation} timed out after ${timeoutMs}ms`
                )
              );
            },
            timeoutMs
          );
      }
    );

  return Promise.race([
    promise,
    timeout
  ]).finally(
    () => {
      clearTimeout(timer);
    }
  );
}


function normalizeAvailability(
  availability
) {
  if (!availability) {
    return [];
  }

  if (
    Array.isArray(
      availability
    )
  ) {
    return availability;
  }

  if (
    Array.isArray(
      availability.slots
    )
  ) {
    return availability.slots;
  }

  if (
    Array.isArray(
      availability.dates
    )
  ) {
    return availability.dates;
  }

  return [];
}


function slotKey(
  slot
) {
  return [
    slot?.date || "",
    slot?.time || "",
    slot?.id || ""
  ].join("|");
}


function hashAvailability(
  availability
) {
  const normalized =
    normalizeAvailability(
      availability
    )
      .map(
        slot => ({
          date:
            String(
              slot?.date || ""
            ),

          time:
            String(
              slot?.time || ""
            ),

          id:
            String(
              slot?.id || ""
            ),

          available:
            slot?.available !== false,

          capacity:
            Number.isFinite(
              Number(
                slot?.capacity
              )
            )
              ? Number(
                  slot.capacity
                )
              : null
        })
      )
      .sort(
        (a, b) =>
          JSON.stringify(a)
            .localeCompare(
              JSON.stringify(b)
            )
      );

  return crypto
    .createHash(
      "sha256"
    )
    .update(
      JSON.stringify(
        normalized
      )
    )
    .digest(
      "hex"
    );
}


/*
 * ============================================================
 * WORKFLOW
 * ============================================================
 */

function getWorkflowState(
  application
) {
  if (
    application?.workflowState &&
    isKnownState(
      application.workflowState
    )
  ) {
    return application.workflowState;
  }

  if (
    typeof application?.getWorkflowState ===
    "function"
  ) {
    return application.getWorkflowState();
  }

  /*
   * Compatibilidade com aplicações
   * criadas antes da migração.
   */

  switch (
    application?.status
  ) {
    case "created":
      return STATES.CREATED;

    case "preparing":
      return STATES.IDENTITY_PREPARATION;

    case "otp_required":
      return STATES.OTP_REQUIRED;

    case "otp_verified":
      return STATES.OTP_VERIFIED;

    case "identity_verification":
      return STATES.IDENTITY_PREPARATION;

    case "calendar":
      return STATES.RADAR_ACTIVE;

    case "waiting_for_slot":
      return STATES.RADAR_ACTIVE;

    case "slot_received":
      return STATES.SLOT_FOUND;

    case "continuing":
      return STATES.BOOKING;

    case "review_pay":
      return STATES.PAYMENT_PENDING;

    case "book_appointment":
      return STATES.APPOINTMENT_BOOKED;

    case "completed":
      return STATES.COMPLETED;

    case "cancelled":
      return STATES.CANCELLED;

    default:
      return STATES.CREATED;
  }
}


async function persistWorkflowState(
  application,
  state,
  metadata = {}
) {
  if (
    !application
  ) {
    return null;
  }

  const current =
    getWorkflowState(
      application
    );

  if (
    current === state &&
    application.workflowState === state
  ) {
    return application;
  }

  /*
   * Se o model novo estiver disponível,
   * usamos a máquina de estados central.
   */

  if (
    typeof application.transitionTo ===
    "function"
  ) {
    try {
      application.transitionTo(
        state,
        metadata
      );

      await application.save();

      return application;
    } catch (
      error
    ) {
      logger.warn(
        "RADAR workflow transition rejected",
        {
          applicationId:
            application._id?.toString?.() ||
            null,

          currentState:
            current,

          nextState:
            state,

          event:
            metadata.event ||
            null,

          reason:
            metadata.reason ||
            null,

          error:
            error.message
        }
      );

      throw error;
    }
  }

  /*
   * Fallback para documentos/modelos
   * durante a migração.
   */

  application.workflowState =
    state;

  application.workflow =
    application.workflow ||
    {};

  application.workflow.previousState =
    current;

  application.workflow.stateChangedAt =
    new Date();

  application.workflow.lastEvent =
    metadata.event ||
    null;

  application.workflow.lastReason =
    metadata.reason ||
    null;

  await application.save();

  return application;
}


/*
 * ============================================================
 * PREFERENCES
 * ============================================================
 */

function normalizeDate(
  value
) {
  if (!value) {
    return null;
  }

  const stringValue =
    String(
      value
    ).slice(
      0,
      10
    );

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      stringValue
    )
  ) {
    return stringValue;
  }

  return null;
}


function normalizeTime(
  value
) {
  if (!value) {
    return null;
  }

  const match =
    String(
      value
    ).match(
      /^(\d{1,2}):(\d{2})/
    );

  if (!match) {
    return null;
  }

  const hour =
    Number(
      match[1]
    );

  const minute =
    Number(
      match[2]
    );

  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return (
    `${String(hour).padStart(2, "0")}:` +
    `${String(minute).padStart(2, "0")}`
  );
}


function matchesPreferences(
  slot,
  application
) {
  if (
    !slot ||
    !slot.date
  ) {
    return false;
  }

  const dateString =
    normalizeDate(
      slot.date
    );

  if (
    !dateString
  ) {
    return false;
  }

  const date =
    new Date(
      `${dateString}T00:00:00`
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return false;
  }


  /*
   * ----------------------------------------------------------
   * DATA
   * ----------------------------------------------------------
   */

  const preferredDates =
    application.preferredDates ||
    {};

  const start =
    normalizeDate(
      preferredDates.start
    );

  const end =
    normalizeDate(
      preferredDates.end
    );

  if (
    start &&
    dateString < start
  ) {
    return false;
  }

  if (
    end &&
    dateString > end
  ) {
    return false;
  }


  /*
   * ----------------------------------------------------------
   * WEEKDAYS
   * ----------------------------------------------------------
   */

  const weekdays =
    Array.isArray(
      application.preferredWeekdays
    )
      ? application.preferredWeekdays
      : [];

  if (
    weekdays.length
  ) {
    const normalizedWeekdays =
      weekdays
        .map(
          value =>
            Number(value)
        )
        .filter(
          value =>
            Number.isInteger(
              value
            ) &&
            value >= 0 &&
            value <= 6
        );

    if (
      normalizedWeekdays.length &&
      !normalizedWeekdays.includes(
        date.getDay()
      )
    ) {
      return false;
    }
  }


  /*
   * ----------------------------------------------------------
   * TIME
   * ----------------------------------------------------------
   */

  const preferredTime =
    normalizeTime(
      application.preferredTime
    );

  const slotTime =
    normalizeTime(
      slot.time
    );

  if (
    preferredTime &&
    slotTime
  ) {
    if (
      slotTime !==
      preferredTime
    ) {
      return false;
    }
  }


  /*
   * ----------------------------------------------------------
   * AVAILABILITY
   * ----------------------------------------------------------
   */

  return (
    slot.available !== false
  );
}


/*
 * ============================================================
 * GROUP MATCHING
 * ============================================================
 */

function findCompatibleGroupSlots(
  availability,
  application
) {
  const slots =
    normalizeAvailability(
      availability
    )
      .filter(
        slot =>
          matchesPreferences(
            slot,
            application
          )
      );

  if (
    !slots.length
  ) {
    return null;
  }

  const required =
    Math.max(
      1,
      Number(
        application.applicantsCount
      ) ||
      Number(
        application.applicants?.length
      ) ||
      1
    );

  const mode =
    application.bookingMode ||
    "SINGLE";


  /*
   * ----------------------------------------------------------
   * SINGLE
   * ----------------------------------------------------------
   */

  if (
    required === 1 ||
    mode === "SINGLE"
  ) {
    const first =
      slots[0];

    return {
      date:
        String(
          first.date
        ),

      time:
        String(
          first.time || ""
        ),

      id:
        first.id ||
        null,

      applicants: [
        {
          client:
            application
              .applicants?.[0]
              ?.client ||
            application.client,

          date:
            String(
              first.date
            ),

          time:
            String(
              first.time || ""
            )
        }
      ]
    };
  }


  /*
   * ----------------------------------------------------------
   * GROUP
   * ----------------------------------------------------------
   */

  const groups =
    new Map();

  for (
    const slot of slots
  ) {
    const key =
      `${slot.date}|${slot.time || ""}`;

    if (
      !groups.has(
        key
      )
    ) {
      groups.set(
        key,
        []
      );
    }

    groups
      .get(key)
      .push(slot);
  }


  for (
    const [key, group]
    of groups
  ) {
    const explicitCapacity =
      Number(
        group[0]?.capacity
      );

    const capacity =
      Number.isFinite(
        explicitCapacity
      )
        ? explicitCapacity
        : group.length;

    if (
      capacity <
      required
    ) {
      continue;
    }

    const [
      date,
      time
    ] =
      key.split("|");

    const applicants =
      (
        application.applicants ||
        []
      )
        .slice(
          0,
          required
        )
        .map(
          applicant => ({
            client:
              applicant.client,

            date,

            time
          })
        );

    if (
      applicants.length !==
      required
    ) {
      continue;
    }

    return {
      date,

      time,

      id:
        group[0]?.id ||
        null,

      applicants
    };
  }

  return null;
}


/*
 * ============================================================
 * RADAR INTERVAL
 * ============================================================
 */

function calculateNextInterval(
  current,
  result
) {
  if (
    result === "slot"
  ) {
    return MIN_INTERVAL;
  }

  if (
    result === "change"
  ) {
    return Math.max(
      MIN_INTERVAL,
      Math.floor(
        current * 0.7
      )
    );
  }

  if (
    result === "empty"
  ) {
    return Math.min(
      MAX_INTERVAL,
      Math.floor(
        current * 1.2
      )
    );
  }

  if (
    result === "error"
  ) {
    return Math.min(
      MAX_INTERVAL,
      Math.max(
        ERROR_COOLDOWN,
        current * 2
      )
    );
  }

  return current;
}


/*
 * ============================================================
 * BOT 2
 * ============================================================
 */

class Bot2 {

  constructor({
    getAdapter
  }) {
    this.getAdapter =
      getAdapter;

    this.workerId =
      crypto.randomUUID();

    this.running =
      false;

    this.timer =
      null;

    this.tickInProgress =
      false;

    this.inFlight =
      new Set();

    this.stats = {
      checks:
        0,

      slotsFound:
        0,

      errors:
        0,

      changes:
        0,

      sessionsReady:
        0,

      authenticationRequired:
        0,

      lastTickAt:
        null,

      lastErrorAt:
        null
    };
  }


  /*
   * =======================================================
   * ADMIN AUTOMATION GATE
   * =======================================================
   */

  async assertAdminRelease(
    applicationId
  ) {
    await requireAutomationRelease(
      applicationId
    );

    return true;
  }


  /*
   * ==========================================================
   * PREPARE APPLICATION FOR RADAR
   * ==========================================================
   */

  async prepareApplication(
    application
  ) {
    const id =
      application?._id?.toString?.();

    if (
      !id
    ) {
      throw new Error(
        "Application ID is required."
      );
    }

    /*
     * PRIMEIRO CHECK:
     * nenhuma preparação do Bot 2
     * acontece sem liberação administrativa.
     */

    await this.assertAdminRelease(
      id
    );

    const state =
      getWorkflowState(
        application
      );


    /*
     * O Radar só trabalha depois
     * de o cliente estar realmente
     * pronto para automação.
     */

    if (
      state !==
        STATES.READY_FOR_AUTOMATION &&
      state !==
        STATES.VFS_SESSION &&
      state !==
        STATES.VFS_AUTHENTICATING &&
      state !==
        STATES.VFS_AUTHENTICATED &&
      state !==
        STATES.RADAR_ACTIVE
    ) {
      return {
        ready:
          false,

        state,

        reason:
          "Application is not ready for automation."
      };
    }


    /*
     * Se já existe sessão autenticada,
     * não fazemos login novamente.
     */

    if (
      state ===
      STATES.VFS_AUTHENTICATED
    ) {
      return {
        ready:
          true,

        authenticated:
          true,

        state
      };
    }


    /*
     * --------------------------------------------------------
     * ADAPTER
     * --------------------------------------------------------
     */

    const adapter =
      await this.getAdapter(
        id
      );


    /*
     * --------------------------------------------------------
     * SESSION
     * --------------------------------------------------------
     */

    if (
      state ===
      STATES.READY_FOR_AUTOMATION
    ) {
      await persistWorkflowState(
        application,
        STATES.VFS_SESSION,
        {
          event:
            "vfs_session_start",

          reason:
            "Application entered VFS automation session"
        }
      );
    }


    /*
     * O adapter atual não expõe ainda
     * um método seguro de autenticação
     * automática.
     *
     * Não inventamos credenciais,
     * selectors ou bypass de CAPTCHA.
     *
     * Se futuramente o adapter devolver
     * authenticated=true, seguimos.
     */

    if (
      typeof adapter.ensureAuthenticated ===
      "function"
    ) {
      await persistWorkflowState(
        application,
        STATES.VFS_AUTHENTICATING,
        {
          event:
            "vfs_authentication_start",

          reason:
            "Checking official VFS authentication state"
        }
      );


      const authentication =
        await withTimeout(
          adapter.ensureAuthenticated(
            application
          ),
          TIMEOUT,
          "VFS authentication"
        );


      if (
        authentication?.captchaRequired
      ) {
        this.stats.authenticationRequired++;


        await persistWorkflowState(
          application,
          STATES.CAPTCHA_REQUIRED,
          {
            event:
              "vfs_captcha_required",

            reason:
              "VFS reported an official CAPTCHA/security checkpoint"
          }
        );


        return {
          ready:
            false,

          authenticated:
            false,

          captchaRequired:
            true,

          state:
            STATES.CAPTCHA_REQUIRED,

          reason:
            authentication.reason ||
            "Official VFS security checkpoint is required."
        };
      }


      if (
        authentication?.authenticated ===
        true
      ) {
        await persistWorkflowState(
          application,
          STATES.VFS_AUTHENTICATED,
          {
            event:
              "vfs_authenticated",

            reason:
              "Official VFS session reported as authenticated"
          }
        );


        this.stats.sessionsReady++;


        return {
          ready:
            true,

          authenticated:
            true,

          state:
            STATES.VFS_AUTHENTICATED
        };
      }


      /*
       * Se o adapter diz que a sessão
       * ainda não está autenticada,
       * não tentamos contornar o checkpoint.
       */

      await persistWorkflowState(
        application,
        STATES.VFS_AUTHENTICATING,
        {
          event:
            "vfs_authentication_pending",

          reason:
            authentication?.reason ||
            "VFS authentication is not yet confirmed"
        }
      );


      return {
        ready:
          false,

        authenticated:
          false,

        state:
          STATES.VFS_AUTHENTICATING,

        reason:
          authentication?.reason ||
          "VFS authentication is not yet confirmed."
      };
    }


    /*
     * --------------------------------------------------------
     * COMPATIBILIDADE COM O ADAPTER ATUAL
     * --------------------------------------------------------
     */

    if (
      typeof adapter.detectState ===
      "function"
    ) {
      const siteState =
        await withTimeout(
          adapter.detectState(),
          TIMEOUT,
          "VFS state detection"
        );


      /*
       * O adapter atual usa DASHBOARD,
       * APPLICATION_DETAIL, SERVICES etc.
       *
       * Chegar a DASHBOARD não significa,
       * sozinho, que a sessão está autenticada.
       *
       * Por isso não promovemos o estado
       * automaticamente para AUTHENTICATED.
       */

      if (
        siteState ===
        "SERVICES"
      ) {
        await persistWorkflowState(
          application,
          STATES.VFS_AUTHENTICATED,
          {
            event:
              "vfs_authenticated_detected",

            reason:
              "VFS session reached the services area through the official flow"
          }
        );


        this.stats.sessionsReady++;


        return {
          ready:
            true,

          authenticated:
            true,

          state:
            STATES.VFS_AUTHENTICATED,

          siteState
        };
      }


      if (
        siteState ===
        "DASHBOARD" ||
        siteState ===
        "APPLICATION_DETAIL" ||
        siteState ===
        "YOUR_DETAILS"
      ) {
        await persistWorkflowState(
          application,
          STATES.VFS_AUTHENTICATING,
          {
            event:
              "vfs_session_not_confirmed",

            reason:
              `VFS is at ${siteState}; authentication is not independently confirmed`
          }
        );


        return {
          ready:
            false,

          authenticated:
            false,

          state:
            STATES.VFS_AUTHENTICATING,

          siteState,

          reason:
            "VFS authentication has not been independently confirmed."
        };
      }
    }


    return {
      ready:
        false,

      authenticated:
        false,

      state:
        getWorkflowState(
          application
        ),

      reason:
        "VFS session state could not be confirmed."
    };
  }


  /*
   * ==========================================================
   * CHECK APPLICATION
   * ==========================================================
   */

  async checkApplication(
    application
  ) {
    const id =
      application._id.toString();


    /*
     * SEGUNDO CHECK:
     * cada execução individual do radar
     * precisa continuar autorizada.
     *
     * Isto impede que uma aplicação
     * liberada anteriormente continue
     * pesquisando depois de ser pausada
     * pelo administrador.
     */

    await this.assertAdminRelease(
      id
    );


    if (
      this.inFlight.has(
        id
      )
    ) {
      return;
    }


    this.inFlight.add(
      id
    );


    try {

      /*
       * ------------------------------------------------------
       * CLAIM
       * ------------------------------------------------------
       */

      const currentState =
        getWorkflowState(
          application
        );


      /*
       * Bot 2 só pode pesquisar em
       * RADAR_ACTIVE.
       */

      if (
        currentState !==
        STATES.RADAR_ACTIVE
      ) {
        return;
      }


      /*
       * IMPORTANTE:
       *
       * O filtro anterior tinha dois
       * "$or" no mesmo objeto MongoDB.
       *
       * Isso é incorreto porque uma
       * propriedade "$or" substitui a outra.
       *
       * Agora usamos "$and" contendo
       * os dois grupos de condições.
       */

      const claimed =
        await Application.findOneAndUpdate(
          {
            _id:
              application._id,

            workflowState:
              STATES.RADAR_ACTIVE,

            $and: [
              {
                $or: [
                  {
                    "bot2.monitoring":
                      true
                  },

                  {
                    "bot2.monitoring":
                      null
                  },

                  {
                    "bot2.monitoring":
                      {
                        $exists:
                          false
                      }
                  }
                ]
              },

              {
                $or: [
                  {
                    "radar.nextCheckAt":
                      null
                  },

                  {
                    "radar.nextCheckAt":
                      {
                        $lte:
                          new Date()
                      }
                  }
                ]
              }
            ]
          },

          {
            $set: {

              "bot2.status":
                "monitoring",

              "bot2.workerId":
                this.workerId,

              "bot2.lastCheckAt":
                new Date(),

              "bot2.heartbeatAt":
                new Date(),

              "bot2.monitoring":
                true,

              "radar.enabled":
                true
            },

            $inc: {
              "bot2.checks":
                1
            }
          },

          {
            new:
              true
          }
        );


      if (
        !claimed
      ) {
        return;
      }


      /*
       * ------------------------------------------------------
       * REVALIDAÇÃO ADMINISTRATIVA
       * ------------------------------------------------------
       *
       * Existe uma pequena janela entre
       * o primeiro check e o claim.
       *
       * Revalidamos antes de contactar
       * o VFS.
       */

      await this.assertAdminRelease(
        id
      );


      /*
       * ------------------------------------------------------
       * ADAPTER
       * ------------------------------------------------------
       */

      const adapter =
        await this.getAdapter(
          id
        );


      this.stats.checks++;


      /*
       * ------------------------------------------------------
       * CONFIRM SESSION
       * ------------------------------------------------------
       */

      if (
        typeof adapter.detectState ===
        "function"
      ) {
        const siteState =
          await withTimeout(
            adapter.detectState(),
            TIMEOUT,
            "VFS state detection"
          );


        /*
         * SERVICES é o único estado
         * que permite a pesquisa de
         * disponibilidade com o adapter
         * atual.
         */

        if (
          siteState !==
          "SERVICES"
        ) {

          /*
           * O administrador pode ter
           * pausado durante detectState().
           * Não gravamos novamente o estado
           * sem confirmar a liberação.
           */

          try {
            await this.assertAdminRelease(
              id
            );
          } catch (
            guardError
          ) {
            logger.info(
              "RADAR state update discarded because automation was paused",
              {
                applicationId:
                  id,

                workerId:
                  this.workerId,

                reason:
                  guardError.message
              }
            );

            return;
          }

          await Application.updateOne(
            {
              _id:
                claimed._id,

              workflowState:
                STATES.RADAR_ACTIVE
            },

            {
              $set: {

                "bot2.status":
                  "waiting",

                "bot2.heartbeatAt":
                  new Date(),

                "radar.nextCheckAt":
                  new Date(
                    Date.now() +
                    MIN_INTERVAL
                  )
              }
            }
          );


          return;
        }
      }


      /*
       * ------------------------------------------------------
       * AVAILABILITY
       * ------------------------------------------------------
       */

      await this.assertAdminRelease(
        id
      );

      const availability =
        await withTimeout(
          adapter.checkAvailability(
            claimed
          ),
          TIMEOUT,
          "Availability check"
        );


      /*
       * A liberação administrativa pode ser
       * retirada enquanto a consulta ao VFS
       * está em andamento.
       *
       * Antes de processar ou gravar qualquer
       * resultado, validamos novamente.
       */

      await this.assertAdminRelease(
        id
      );


      const hash =
        hashAvailability(
          availability
        );


      const previousHash =
        claimed.radar
          ?.lastAvailabilityHash ||
        null;


      const compatibleSlot =
        findCompatibleGroupSlots(
          availability,
          claimed
        );


      const now =
        new Date();


      /*
       * Última barreira antes de alterar
       * o estado da aplicação e entregar
       * uma vaga ao Bot 1.
       */

      await this.assertAdminRelease(
        id
      );


      /*
       * ------------------------------------------------------
       * SLOT FOUND
       * ------------------------------------------------------
       */

      if (
        compatibleSlot
      ) {

        /*
         * Antes de emitir o evento,
         * confirmamos novamente que o
         * administrador ainda mantém
         * a aplicação liberada.
         */

        await this.assertAdminRelease(
          id
        );


        const updated =
          await Application.findOneAndUpdate(
            {
              _id:
                claimed._id,

              workflowState:
                STATES.RADAR_ACTIVE,

              "bot2.monitoring":
                true
            },

            {
              $set: {

                slot:
                  compatibleSlot,

                workflowState:
                  STATES.SLOT_FOUND,

                status:
                  "slot_received",

                "bot2.status":
                  "slot_found",

                "bot2.monitoring":
                  false,

                "bot2.workerId":
                  this.workerId,

                "bot2.slotDetectedAt":
                  now,

                "bot2.heartbeatAt":
                  now,

                "radar.enabled":
                  false,

                "radar.lastAvailabilityHash":
                  hash,

                "radar.lastChangeAt":
                  now,

                "radar.lastSuccessfulCheckAt":
                  now,

                "radar.currentIntervalMs":
                  MIN_INTERVAL,

                "radar.consecutiveErrors":
                  0,

                "radar.consecutiveEmptyChecks":
                  0,

                "radar.riskLevel":
                  "normal",

                "radar.nextCheckAt":
                  null
              }
            },

            {
              new:
                true
            }
          );


        if (
          !updated
        ) {
          return;
        }


        this.stats.slotsFound++;


        logger.info(
          "RADAR compatible slot detected",
          {
            applicationId:
              id,

            groupId:
              updated.groupId,

            applicants:
              updated.applicantsCount,

            date:
              updated.slot?.date,

            time:
              updated.slot?.time,

            slotId:
              updated.slot?.id ||
              null
          }
        );


        eventBus.emit(
          "slot_found",
          {
            applicationId:
              id,

            slot:
              updated.slot,

            detectedAt:
              now,

            workerId:
              this.workerId
          }
        );


        return;
      }


      /*
       * ------------------------------------------------------
       * NO MATCH
       * ------------------------------------------------------
       */

      const changed =
        Boolean(
          previousHash &&
          previousHash !==
            hash
        );


      if (
        changed
      ) {
        this.stats.changes++;
      }


      const currentInterval =
        Number(
          claimed.radar
            ?.currentIntervalMs
        ) ||
        MIN_INTERVAL;


      const nextInterval =
        calculateNextInterval(
          currentInterval,
          changed
            ? "change"
            : "empty"
        );


      /*
       * Se o administrador pausou a aplicação
       * enquanto a consulta estava em andamento,
       * não devemos reativar o radar nem alterar
       * os controles da aplicação.
       */

      try {
        await this.assertAdminRelease(
          id
        );
      } catch (
        guardError
      ) {
        logger.info(
          "RADAR result discarded because automation was paused",
          {
            applicationId:
              id,

            workerId:
              this.workerId,

            reason:
              guardError.message
          }
        );

        return;
      }


      await Application.updateOne(
        {
          _id:
            claimed._id,

          workflowState:
            STATES.RADAR_ACTIVE
        },

        {
          $set: {

            "bot2.status":
              "monitoring",

            "bot2.heartbeatAt":
              now,

            "radar.lastAvailabilityHash":
              hash,

            "radar.lastSuccessfulCheckAt":
              now,

            "radar.currentIntervalMs":
              nextInterval,

            "radar.nextCheckAt":
              new Date(
                Date.now() +
                nextInterval
              ),

            "radar.riskLevel":
              "normal",

            "radar.consecutiveErrors":
              0
          },

          $inc: {

            "radar.consecutiveEmptyChecks":
              changed
                ? 0
                : 1
          }
        }
      );


    } catch (
      error
    ) {

      this.stats.errors++;

      this.stats.lastErrorAt =
        new Date();


      const now =
        new Date();


      /*
       * IMPORTANTE:
       *
       * O erro pode ter sido causado
       * pelo próprio bloqueio administrativo.
       *
       * Antes de gravar cooldown como se
       * fosse erro do VFS, verificamos
       * novamente a liberação.
       */

      try {
        await this.assertAdminRelease(
          id
        );
      } catch (
        guardError
      ) {
        logger.info(
          "RADAR error state discarded because automation was paused",
          {
            applicationId:
              id,

            workerId:
              this.workerId,

            reason:
              guardError.message,

            originalError:
              error.message
          }
        );

        return;
      }


      await Application.updateOne(
        {
          _id:
            application._id,

          workflowState:
            STATES.RADAR_ACTIVE
        },

        {
          $set: {

            "bot2.status":
              "cooldown",

            "bot2.workerId":
              this.workerId,

            "bot2.heartbeatAt":
              now,

            "radar.riskLevel":
              "elevated",

            "radar.nextCheckAt":
              new Date(
                Date.now() +
                ERROR_COOLDOWN
              )
          },

          $inc: {

            "bot2.errors":
              1,

            "radar.consecutiveErrors":
              1
          }
        }
      );


      /*
       * Uma pausa administrativa
       * não deve ser tratada como
       * uma falha do VFS.
       */

      logger.error(
        "RADAR availability check failed",
        {
          applicationId:
            id,

          workerId:
            this.workerId,

          error:
            error.message
        }
      );


    } finally {

      this.inFlight.delete(
        id
      );
    }
  }


  /*
   * ==========================================================
   * TICK
   * ==========================================================
   */

  async tick() {

    if (
      !this.running ||
      this.tickInProgress
    ) {
      return;
    }


    this.tickInProgress =
      true;

    this.stats.lastTickAt =
      new Date();


    try {

      /*
       * Só carregamos aplicações
       * que já chegaram ao radar.
       */

      const applications =
        await Application.find(
          {
            workflowState:
              STATES.RADAR_ACTIVE,

            "bot2.monitoring":
              true,

            "radar.enabled":
              true,

            $or: [
              {
                "radar.nextCheckAt":
                  null
              },

              {
                "radar.nextCheckAt":
                  {
                    $lte:
                      new Date()
                  }
              }
            ]
          }
        )
          .sort(
            {
              "radar.nextCheckAt":
                1
            }
          )
          .limit(
            BATCH_SIZE
          );


      /*
       * checkApplication() faz sua
       * própria validação administrativa.
       *
       * Portanto uma aplicação que
       * tenha sido pausada entre o
       * find() e a execução não passa.
       */

      await Promise.all(
        applications.map(
          application =>
            this.checkApplication(
              application
            )
              .catch(
                error => {
                  logger.warn(
                    "RADAR application skipped",
                    {
                      applicationId:
                        application._id?.toString?.() ||
                        null,

                      error:
                        error.message
                    }
                  );
                }
              )
        )
      );


    } catch (
      error
    ) {

      this.stats.errors++;


      logger.error(
        "RADAR tick failed",
        {
          workerId:
            this.workerId,

          error:
            error.message
        }
      );


    } finally {

      this.tickInProgress =
        false;
    }
  }


  /*
   * ==========================================================
   * START
   * ==========================================================
   */

  start() {

    if (
      this.running
    ) {
      return;
    }


    this.running =
      true;


    logger.info(
      "RADAR started",
      {
        workerId:
          this.workerId,

        minInterval:
          MIN_INTERVAL,

        maxInterval:
          MAX_INTERVAL
      }
    );


    const loop =
      async () => {

        if (
          !this.running
        ) {
          return;
        }


        try {

          await this.tick();

        } catch (
          error
        ) {

          logger.error(
            "RADAR loop error",
            {
              error:
                error.message
            }
          );
        }


        if (
          this.running
        ) {

          this.timer =
            setTimeout(
              loop,
              MIN_INTERVAL
            );
        }
      };


    loop();
  }


  /*
   * ==========================================================
   * STOP
   * ==========================================================
   */

  stop() {

    this.running =
      false;


    if (
      this.timer
    ) {

      clearTimeout(
        this.timer
      );

      this.timer =
        null;
    }


    logger.info(
      "RADAR stopped",
      {
        workerId:
          this.workerId
      }
    );
  }


  /*
   * ==========================================================
   * STATUS
   * ==========================================================
   */

  status() {

    return {

      running:
        this.running,

      workerId:
        this.workerId,

      inFlight:
        this.inFlight.size,

      tickInProgress:
        this.tickInProgress,

      stats:
        this.stats
    };
  }
}


module.exports =
  Bot2;
