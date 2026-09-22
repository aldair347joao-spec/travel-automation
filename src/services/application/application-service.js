const mongoose = require("mongoose");

const Application = require("../../models/application");
const Client = require("../../models/client");

const {
  STATES,
  canTransition
} = require("./application-state-machine");

const facialService = require("../facial/facial-service");

const DEFAULT_PREFERRED_TIME = "ANY";

const VISA_TYPES = Object.freeze([
  "SCHENGEN",
  "NACIONAL"
]);

const BOOKING_MODES = Object.freeze([
  "GROUP_REQUIRED",
  "PARTIAL_ALLOWED",
  "SINGLE"
]);

const REQUIRED_LIVENESS_POSITIONS = Object.freeze([
  1, 2, 3, 4, 5,
  6, 7, 8, 9, 10
]);

function asObjectId(value) {
  if (!value) {
    return null;
  }

  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

function cleanString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();

  return normalized || null;
}

function normalizeWeekdays(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(Number)
        .filter(
          (day) =>
            Number.isInteger(day) &&
            day >= 0 &&
            day <= 6
        )
    )
  ].sort((a, b) => a - b);
}

function normalizeDate(value) {
  const normalized = cleanString(value);

  if (!normalized) {
    return null;
  }

  const date = new Date(
    `${normalized}T00:00:00.000Z`
  );

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return normalized;
}

function normalizePreferences(input = {}) {
  const start =
    normalizeDate(
      input.preferredDates?.start ??
      input.startDate
    );

  const end =
    normalizeDate(
      input.preferredDates?.end ??
      input.endDate
    );

  return {
    visaType:
      cleanString(input.visaType)?.toUpperCase() ||
      null,

    visaCenter:
      cleanString(input.visaCenter),

    travelPurpose:
      cleanString(input.travelPurpose),

    serviceType:
      cleanString(input.serviceType),

    appointmentMode:
      cleanString(input.appointmentMode) ||
      "VFS_APPOINTMENT",

    preferredDates: {
      start,
      end
    },

    preferredTime:
      cleanString(input.preferredTime) ||
      DEFAULT_PREFERRED_TIME,

    preferredWeekdays:
      normalizeWeekdays(
        input.preferredWeekdays
      )
  };
}

function getClientPassportStatus(client) {
  if (!client) {
    return "missing";
  }

  const validation =
    client.passportValidation || {};

  if (validation.status === "passed") {
    return "passed";
  }

  if (validation.status === "pending") {
    return "pending";
  }

  if (
    validation.status ===
    "requires_user"
  ) {
    return "requires_user";
  }

  if (validation.status === "failed") {
    return "failed";
  }

  return "not_started";
}

/**
 * =========================================================
 * LIVENESS
 * =========================================================
 *
 * A identidade do cliente deixou de depender de 10 imagens
 * armazenadas.
 *
 * O requisito agora é uma sessão de liveness concluída,
 * validada pelo backend, contendo as 10 posições obrigatórias.
 *
 * Mantemos validateTenFacialPositions() abaixo para o fluxo
 * legado/oficial que ainda possa utilizar posições armazenadas.
 */

function getLivenessSession(client) {
  return (
    client?.facialPreflight?.livenessSession ||
    null
  );
}

function validateLivenessSession(client) {
  const session =
    getLivenessSession(client);

  if (!session) {
    return {
      valid: false,
      code:
        "LIVENESS_SESSION_MISSING",
      message:
        "O cliente ainda não possui uma sessão de liveness concluída."
    };
  }

  if (
    session.status !== "passed"
  ) {
    return {
      valid: false,
      code:
        "LIVENESS_NOT_PASSED",
      message:
        "A sessão de liveness ainda não foi aprovada.",
      status:
        session.status || "unknown"
    };
  }

  if (session.verified !== true) {
    return {
      valid: false,
      code:
        "LIVENESS_NOT_VERIFIED",
      message:
        "A sessão de liveness não está marcada como verificada."
    };
  }

  const positions =
    Array.isArray(session.positions)
      ? session.positions
      : [];

  if (
    positions.length !==
    REQUIRED_LIVENESS_POSITIONS.length
  ) {
    return {
      valid: false,
      code:
        "LIVENESS_POSITIONS_INCOMPLETE",
      message:
        "A sessão de liveness precisa conter exatamente as 10 posições obrigatórias."
    };
  }

  const numbers =
    positions
      .map(
        (position) =>
          Number(position.position)
      )
      .sort((a, b) => a - b);

  const complete =
    numbers.length ===
      REQUIRED_LIVENESS_POSITIONS.length &&
    numbers.every(
      (value, index) =>
        value ===
        REQUIRED_LIVENESS_POSITIONS[index]
    );

  if (!complete) {
    return {
      valid: false,
      code:
        "LIVENESS_POSITIONS_INVALID",
      message:
        "As posições da sessão de liveness devem corresponder exatamente às posições 1 a 10."
    };
  }

  const invalidPositions =
    positions.filter(
      (position) =>
        position.verified !== true ||
        position.faceDetected !== true ||
        position.singleFace !== true
    );

  if (
    invalidPositions.length > 0
  ) {
    return {
      valid: false,
      code:
        "LIVENESS_POSITIONS_NOT_VERIFIED",
      message:
        "Uma ou mais posições da sessão de liveness não estão verificadas."
    };
  }

  const smilePosition =
    positions.find(
      (position) =>
        Number(position.position) === 10
    );

  if (
    !smilePosition ||
    smilePosition.smileDetected !== true
  ) {
    return {
      valid: false,
      code:
        "LIVENESS_SMILE_NOT_VERIFIED",
      message:
        "A posição final de sorriso ainda não foi validada."
    };
  }

  const score =
    Number(session.score);

  if (
    !Number.isFinite(score) ||
    score < 0.82
  ) {
    return {
      valid: false,
      code:
        "LIVENESS_SCORE_INSUFFICIENT",
      message:
        "A pontuação geral da sessão de liveness não atingiu o mínimo necessário.",
      score
    };
  }

  return {
    valid: true,
    session
  };
}

/**
 * =========================================================
 * LEGACY FACIAL POSITIONS
 * =========================================================
 *
 * Mantido para compatibilidade com o fluxo oficial que ainda
 * possa resolver uma posição facial através de uma referência
 * de armazenamento.
 */

function getFacialPositions(client) {
  const positions =
    client?.facialProfile?.positions;

  if (!Array.isArray(positions)) {
    return [];
  }

  return positions.filter(
    (position) =>
      Number.isInteger(position.position) &&
      position.position >= 1 &&
      position.position <= 10 &&
      cleanString(position.label) &&
      cleanString(position.storageReference)
  );
}

function validateTenFacialPositions(client) {
  const positions =
    getFacialPositions(client);

  if (positions.length !== 10) {
    return {
      valid: false,
      code:
        "FACIAL_POSITIONS_INCOMPLETE",
      message:
        "O cliente não possui exatamente 10 posições faciais armazenadas."
    };
  }

  const numbers =
    positions
      .map(
        (position) =>
          position.position
      )
      .sort((a, b) => a - b);

  const expected =
    REQUIRED_LIVENESS_POSITIONS;

  const complete =
    numbers.length === expected.length &&
    numbers.every(
      (value, index) =>
        value === expected[index]
    );

  if (!complete) {
    return {
      valid: false,
      code:
        "FACIAL_POSITIONS_INVALID",
      message:
        "As posições faciais armazenadas devem corresponder exatamente às posições 1 a 10."
    };
  }

  const duplicatedReferences =
    new Set(
      positions.map(
        (position) =>
          position.storageReference
      )
    ).size !== 10;

  if (duplicatedReferences) {
    return {
      valid: false,
      code:
        "FACIAL_POSITION_REFERENCE_DUPLICATED",
      message:
        "As referências das 10 posições faciais devem ser distintas."
    };
  }

  const unverified =
    positions.filter(
      (position) =>
        position.verified !== true
    );

  if (unverified.length > 0) {
    return {
      valid: false,
      code:
        "FACIAL_POSITIONS_NOT_VERIFIED",
      message:
        "Nem todas as 10 posições faciais estão verificadas."
    };
  }

  return {
    valid: true,
    positions
  };
}

function validatePassport(client) {
  const status =
    getClientPassportStatus(client);

  if (status !== "passed") {
    return {
      valid: false,
      code:
        "PASSPORT_NOT_VERIFIED",
      message:
        "O passaporte ainda não foi validado com sucesso.",
      status
    };
  }

  if (
    !cleanString(
      client.passportNumber
    )
  ) {
    return {
      valid: false,
      code:
        "PASSPORT_NUMBER_MISSING",
      message:
        "O número do passaporte não está disponível."
    };
  }

  if (
    !cleanString(
      client.passportExpiryDate
    )
  ) {
    return {
      valid: false,
      code:
        "PASSPORT_EXPIRY_MISSING",
      message:
        "A validade do passaporte não está disponível."
    };
  }

  return {
    valid: true
  };
}

function validatePreferences(preferences) {
  const errors = [];

  if (
    !VISA_TYPES.includes(
      preferences.visaType
    )
  ) {
    errors.push(
      "visaType inválido."
    );
  }

  if (!preferences.visaCenter) {
    errors.push(
      "O centro VFS é obrigatório."
    );
  }

  if (
    preferences.preferredDates.start &&
    preferences.preferredDates.end
  ) {
    const start =
      new Date(
        `${preferences.preferredDates.start}T00:00:00.000Z`
      );

    const end =
      new Date(
        `${preferences.preferredDates.end}T00:00:00.000Z`
      );

    if (start > end) {
      errors.push(
        "O intervalo de datas é inválido."
      );
    }
  } else {
    errors.push(
      "O intervalo de datas preferido é obrigatório."
    );
  }

  if (
    !Array.isArray(
      preferences.preferredWeekdays
    )
  ) {
    errors.push(
      "Os dias da semana são inválidos."
    );
  }

  return {
    valid:
      errors.length === 0,
    errors
  };
}

/**
 * =========================================================
 * APPLICANT SNAPSHOT
 * =========================================================
 *
 * O snapshot passa a carregar também o estado da liveness.
 * Não copiamos imagens nem data URLs.
 */

function buildApplicant(client) {
  const liveness =
    getLivenessSession(client);

  return {
    client: client._id,

    passport: {
      number:
        client.passportNumber ||
        null,

      nationality:
        client.nationality ||
        null,

      expiryDate:
        client.passportExpiryDate ||
        null,

      validationStatus:
        client.passportValidation?.status ||
        "not_started"
    },

    personalData: {
      fullName:
        client.fullName ||
        null,

      dateOfBirth:
        client.dateOfBirth ||
        null,

      gender:
        client.gender ||
        null,

      nationality:
        client.nationality ||
        null,

      email:
        client.email ||
        null,

      phone:
        client.phone ||
        null
    },

    identityStatus:
      client.facialPreflight?.status ===
      "passed"
        ? "ready"
        : "pending",

    vfsStatus:
      "not_started",

    liveness: {
      status:
        liveness?.status ||
        "not_started",

      sessionId:
        liveness?.sessionId ||
        null,

      score:
        Number.isFinite(
          Number(liveness?.score)
        )
          ? Number(liveness.score)
          : null,

      completedCount:
        Number(
          liveness?.completedCount || 0
        ),

      total:
        Number(
          liveness?.total || 10
        ),

      verified:
        liveness?.verified === true,

      startedAt:
        liveness?.startedAt ||
        null,

      completedAt:
        liveness?.completedAt ||
        null
    }
  };
}

function syncApplicantsFromClients(
  application,
  clients
) {
  if (
    !application ||
    !Array.isArray(
      application.applicants
    )
  ) {
    return;
  }

  const clientsById =
    new Map(
      clients.map(
        (client) => [
          String(client._id),
          client
        ]
      )
    );

  application.applicants =
    application.applicants.map(
      (existingApplicant) => {
        const client =
          clientsById.get(
            String(
              existingApplicant.client
            )
          );

        if (!client) {
          return existingApplicant;
        }

        const freshApplicant =
          buildApplicant(client);

        existingApplicant.passport =
          freshApplicant.passport;

        existingApplicant.personalData =
          freshApplicant.personalData;

        existingApplicant.identityStatus =
          freshApplicant.identityStatus;

        existingApplicant.vfsStatus =
          freshApplicant.vfsStatus;

        /*
         * O schema atual de Application pode não possuir
         * este campo em documentos antigos.
         *
         * O Mongoose permite que o serviço seja atualizado
         * posteriormente com o campo formal no model.
         */
        existingApplicant.liveness =
          freshApplicant.liveness;

        return existingApplicant;
      }
    );
}

async function transition(
  application,
  nextState,
  metadata = {}
) {
  const currentState =
    application.getWorkflowState();

  if (currentState === nextState) {
    return application;
  }

  if (
    !canTransition(
      currentState,
      nextState
    )
  ) {
    const error =
      new Error(
        `Transição inválida: ${currentState} -> ${nextState}`
      );

    error.code =
      "INVALID_WORKFLOW_TRANSITION";

    error.currentState =
      currentState;

    error.nextState =
      nextState;

    throw error;
  }

  application.transitionTo(
    nextState,
    metadata
  );

  await application.save();

  return application;
}

class ApplicationService {
  /**
   * Cria uma aplicação já associada
   * ao cliente e às preferências.
   *
   * Não inicia os bots.
   */
  async create({
    accountId,
    createdBy,
    clientId,
    clientIds,
    bookingMode = "SINGLE",
    ...input
  }) {
    if (!accountId) {
      throw new Error(
        "accountId é obrigatório."
      );
    }

    const ids =
      Array.isArray(clientIds) &&
      clientIds.length
        ? clientIds
        : clientId
          ? [clientId]
          : [];

    if (!ids.length) {
      throw new Error(
        "É necessário informar pelo menos um cliente."
      );
    }

    if (
      !BOOKING_MODES.includes(
        bookingMode
      )
    ) {
      throw new Error(
        "bookingMode inválido."
      );
    }

    const objectIds =
      ids
        .map(asObjectId)
        .filter(Boolean);

    if (
      objectIds.length !== ids.length
    ) {
      throw new Error(
        "Um ou mais clientIds são inválidos."
      );
    }

    const clients =
      await Client.find({
        _id: {
          $in: objectIds
        },
        accountId,
        active: true
      });

    if (
      clients.length !==
      objectIds.length
    ) {
      throw new Error(
        "Um ou mais clientes não pertencem à conta ou estão inativos."
      );
    }

    const preferences =
      normalizePreferences(input);

    const preferenceCheck =
      validatePreferences(
        preferences
      );

    if (!preferenceCheck.valid) {
      const error =
        new Error(
          preferenceCheck.errors.join(" ")
        );

      error.code =
        "INVALID_PREFERENCES";

      error.details =
        preferenceCheck.errors;

      throw error;
    }

    const applicants =
      clients.map(buildApplicant);

    const application =
      new Application({
        accountId,

        createdBy:
          createdBy || null,

        client:
          clients.length === 1
            ? clients[0]._id
            : null,

        applicants,

        applicantsCount:
          clients.length,

        bookingMode,

        visaType:
          preferences.visaType,

        visaCenter:
          preferences.visaCenter,

        travelPurpose:
          preferences.travelPurpose,

        serviceType:
          preferences.serviceType,

        appointmentMode:
          preferences.appointmentMode,

        preferredDates:
          preferences.preferredDates,

        preferredTime:
          preferences.preferredTime,

        preferredWeekdays:
          preferences.preferredWeekdays,

        status:
          "created",

        workflowState:
          STATES.CREATED,

        workflow: {
          stateChangedAt:
            new Date(),

          lastEvent:
            "APPLICATION_CREATED",

          lastReason:
            "Application created"
        },

        radar: {
          enabled: false
        },

        bot1: {
          status: "idle"
        },

        bot2: {
          status: "idle",
          monitoring: false
        }
      });

    await application.save();

    return application;
  }

  /**
   * Obtém uma aplicação garantindo
   * isolamento por accountId.
   */
  async getById(
    applicationId,
    accountId
  ) {
    if (
      !mongoose.Types.ObjectId.isValid(
        applicationId
      )
    ) {
      throw new Error(
        "applicationId inválido."
      );
    }

    const application =
      await Application.findOne({
        _id: applicationId,
        accountId
      });

    if (!application) {
      const error =
        new Error(
          "Aplicação não encontrada."
        );

      error.code =
        "APPLICATION_NOT_FOUND";

      throw error;
    }

    return application;
  }

  /**
   * Verifica se todos os clientes
   * da aplicação estão prontos.
   *
   * IDENTIDADE:
   * agora usa a sessão de liveness validada,
   * não 10 imagens armazenadas.
   */
  async validateReadiness(
    application
  ) {
    const clientIds =
      application.applicants
        ?.map(
          (applicant) =>
            applicant.client
        )
        .filter(Boolean) || [];

    if (!clientIds.length) {
      return {
        ready: false,
        code:
          "NO_APPLICANTS",
        message:
          "A aplicação não possui candidatos."
      };
    }

    const clients =
      await Client.find({
        _id: {
          $in: clientIds
        },
        accountId:
          application.accountId,
        active: true
      });

    if (
      clients.length !==
      clientIds.length
    ) {
      return {
        ready: false,
        code:
          "APPLICANT_NOT_FOUND",
        message:
          "Um ou mais candidatos não foram encontrados."
      };
    }

    /*
     * Atualizamos o snapshot da aplicação com os
     * dados atuais do cliente.
     *
     * Isto é importante porque o cliente pode ter
     * concluído o passaporte e a liveness depois
     * da criação da aplicação.
     */
    syncApplicantsFromClients(
      application,
      clients
    );

    const passportErrors = [];
    const facialErrors = [];

    for (const client of clients) {
      const passport =
        validatePassport(client);

      if (!passport.valid) {
        passportErrors.push({
          clientId:
            String(client._id),
          ...passport
        });
      }

      /*
       * NOVO FLUXO:
       * validamos a sessão de liveness.
       */
      const liveness =
        validateLivenessSession(
          client
        );

      if (!liveness.valid) {
        facialErrors.push({
          clientId:
            String(client._id),
          ...liveness
        });
      }
    }

    const preferences =
      validatePreferences({
        visaType:
          application.visaType,

        visaCenter:
          application.visaCenter,

        preferredDates:
          application.preferredDates,

        preferredWeekdays:
          application.preferredWeekdays
      });

    /*
     * Guardamos a sincronização dos candidatos
     * antes de retornar o readiness.
     */
    await application.save();

    if (
      passportErrors.length
    ) {
      return {
        ready: false,
        code:
          "PASSPORT_NOT_READY",
        message:
          "Existem candidatos com passaporte não validado.",
        passportErrors,
        facialErrors,
        preferenceErrors:
          preferences.errors
      };
    }

    if (
      facialErrors.length
    ) {
      return {
        ready: false,
        code:
          "IDENTITY_NOT_READY",
        message:
          "Existem candidatos sem uma sessão de liveness aprovada.",
        passportErrors,
        facialErrors,
        preferenceErrors:
          preferences.errors
      };
    }

    if (!preferences.valid) {
      return {
        ready: false,
        code:
          "PREFERENCES_NOT_READY",
        message:
          "As preferências da aplicação estão incompletas.",
        passportErrors,
        facialErrors,
        preferenceErrors:
          preferences.errors
      };
    }

    return {
      ready: true,
      clients
    };
  }

  /**
   * Prepara a aplicação para automação.
   *
   * A preparação exige:
   * - passaporte validado;
   * - liveness aprovado;
   * - preferências completas.
   *
   * Não exige imagens faciais armazenadas.
   */
  async prepare(
    applicationId,
    accountId
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    const currentState =
      application.getWorkflowState();

    if (
      currentState ===
      STATES.READY_FOR_AUTOMATION
    ) {
      return application;
    }

    const allowedStartingStates = [
      STATES.CREATED,
      STATES.PASSPORT_PENDING,
      STATES.PASSPORT_VERIFIED,
      STATES.IDENTITY_PREPARATION,
      STATES.IDENTITY_READY,
      STATES.PREFERENCES_PENDING
    ];

    if (
      !allowedStartingStates.includes(
        currentState
      )
    ) {
      const error =
        new Error(
          `A aplicação não pode ser preparada no estado ${currentState}.`
        );

      error.code =
        "APPLICATION_NOT_PREPARABLE";

      throw error;
    }

    await transition(
      application,
      STATES.PASSPORT_PENDING,
      {
        event:
          "PASSPORT_VALIDATION_STARTED",
        reason:
          "Application preparation started"
      }
    );

    const readiness =
      await this.validateReadiness(
        application
      );

    if (!readiness.ready) {
      if (
        readiness.code ===
        "PASSPORT_NOT_READY"
      ) {
        await transition(
          application,
          STATES.PASSPORT_PENDING,
          {
            event:
              "PASSPORT_VALIDATION_PENDING",
            reason:
              readiness.message
          }
        );
      } else if (
        readiness.code ===
        "IDENTITY_NOT_READY"
      ) {
        await transition(
          application,
          STATES.IDENTITY_PREPARATION,
          {
            event:
              "IDENTITY_PREPARATION_REQUIRED",
            reason:
              readiness.message
          }
        );
      } else {
        await transition(
          application,
          STATES.PREFERENCES_PENDING,
          {
            event:
              "PREFERENCES_REQUIRED",
            reason:
              readiness.message
          }
        );
      }

      return {
        application,
        ready: false,
        ...readiness
      };
    }

    await transition(
      application,
      STATES.PASSPORT_VERIFIED,
      {
        event:
          "PASSPORT_VALIDATED",
        reason:
          "All passports passed validation"
      }
    );

    await transition(
      application,
      STATES.IDENTITY_PREPARATION,
      {
        event:
          "IDENTITY_PREPARATION_STARTED",
        reason:
          "Validating completed liveness session"
      }
    );

    /*
     * A identidade já foi verificada pelo fluxo
     * de liveness.
     *
     * Não capturamos nem exigimos fotografias
     * adicionais aqui.
     */
    for (
      const client of readiness.clients
    ) {
      const liveness =
        validateLivenessSession(
          client
        );

      if (!liveness.valid) {
        const error =
          new Error(
            liveness.message
          );

        error.code =
          liveness.code;

        throw error;
      }
    }

    await transition(
      application,
      STATES.IDENTITY_READY,
      {
        event:
          "IDENTITY_LIVENESS_VERIFIED",
        reason:
          "All applicants have a verified liveness session"
      }
    );

    await transition(
      application,
      STATES.PREFERENCES_PENDING,
      {
        event:
          "PREFERENCES_VALIDATION_STARTED",
        reason:
          "Validating appointment preferences"
      }
    );

    const preferences =
      validatePreferences({
        visaType:
          application.visaType,

        visaCenter:
          application.visaCenter,

        preferredDates:
          application.preferredDates,

        preferredTime:
          application.preferredTime,

        preferredWeekdays:
          application.preferredWeekdays
      });

    if (!preferences.valid) {
      return {
        application,
        ready: false,
        code:
          "PREFERENCES_NOT_READY",
        message:
          "As preferências ainda não estão completas.",
        preferenceErrors:
          preferences.errors
      };
    }

    application.preparedAt =
      new Date();

    application.metrics =
      application.metrics || {};

    application.metrics.preparationMs =
      application.preparedAt -
      application.createdAt;

    application.radar.enabled =
      true;

    application.bot2.monitoring =
      false;

    application.bot2.status =
      "idle";

    await application.save();

    await transition(
      application,
      STATES.READY_FOR_AUTOMATION,
      {
        event:
          "APPLICATION_READY_FOR_AUTOMATION",
        reason:
          "Passport, verified liveness and preferences are ready"
      }
    );

    return {
      application,
      ready: true
    };
  }

  /**
   * Inicia o radar.
   */
  async startRadar(
    applicationId,
    accountId
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    const state =
      application.getWorkflowState();

    if (
      state !==
      STATES.READY_FOR_AUTOMATION
    ) {
      const error =
        new Error(
          `O radar só pode iniciar quando a aplicação estiver READY_FOR_AUTOMATION. Estado atual: ${state}`
        );

      error.code =
        "RADAR_NOT_READY";

      throw error;
    }

    application.radar.enabled =
      true;

    application.bot2.monitoring =
      true;

    application.bot2.status =
      "monitoring";

    await application.save();

    await transition(
      application,
      STATES.RADAR_ACTIVE,
      {
        event:
          "RADAR_STARTED",
        reason:
          "Bot 2 started monitoring"
      }
    );

    return application;
  }

  /**
   * Registra um slot compatível.
   */
  async registerSlotFound(
    applicationId,
    accountId,
    slot
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    const state =
      application.getWorkflowState();

    if (
      ![
        STATES.RADAR_ACTIVE,
        STATES.SLOT_LOST
      ].includes(state)
    ) {
      const error =
        new Error(
          `Slot não pode ser registrado no estado ${state}.`
        );

      error.code =
        "SLOT_EVENT_NOT_ALLOWED";

      throw error;
    }

    if (
      !slot ||
      !cleanString(slot.date) ||
      !cleanString(slot.time)
    ) {
      const error =
        new Error(
          "Slot inválido."
        );

      error.code =
        "INVALID_SLOT";

      throw error;
    }

    application.slot = {
      date:
        cleanString(slot.date),

      time:
        cleanString(slot.time),

      applicants:
        Array.isArray(
          slot.applicants
        )
          ? slot.applicants
          : []
    };

    application.bot2.status =
      "slot_found";

    application.bot2.monitoring =
      false;

    application.bot2.slotDetectedAt =
      new Date();

    application.radar.lastChangeAt =
      new Date();

    application.radar.lastSuccessfulCheckAt =
      new Date();

    application.radar.enabled =
      false;

    await application.save();

    await transition(
      application,
      STATES.SLOT_FOUND,
      {
        event:
          "SLOT_FOUND",
        reason:
          "Bot 2 found a slot matching the application criteria"
      }
    );

    return application;
  }

  /**
   * Inicia a fase de booking.
   */
  async beginBooking(
    applicationId,
    accountId
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    const state =
      application.getWorkflowState();

    if (
      state !==
      STATES.SLOT_FOUND
    ) {
      const error =
        new Error(
          `Booking não pode iniciar no estado ${state}.`
        );

      error.code =
        "BOOKING_NOT_READY";

      throw error;
    }

    await transition(
      application,
      STATES.SLOT_LOCKED,
      {
        event:
          "SLOT_LOCKED",
        reason:
          "Booking worker acquired the slot"
      }
    );

    await transition(
      application,
      STATES.SLOT_REVALIDATED,
      {
        event:
          "SLOT_REVALIDATION_REQUIRED",
        reason:
          "Slot must be revalidated before booking"
      }
    );

    return application;
  }

  /**
   * Registra que o passaporte pode ser
   * enviado ao fluxo oficial.
   */
  async beginPassportUpload(
    applicationId,
    accountId
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    const state =
      application.getWorkflowState();

    if (
      ![
        STATES.BOOKING,
        STATES.SLOT_REVALIDATED,
        STATES.DOCUMENT_UPLOAD
      ].includes(state)
    ) {
      const error =
        new Error(
          `Upload de passaporte não pode iniciar no estado ${state}.`
        );

      error.code =
        "PASSPORT_UPLOAD_NOT_ALLOWED";

      throw error;
    }

    if (
      state !==
      STATES.DOCUMENT_UPLOAD
    ) {
      await transition(
        application,
        STATES.BOOKING,
        {
          event:
            "BOOKING_STARTED",
          reason:
            "Official VFS booking flow started"
        }
      );

      await transition(
        application,
        STATES.DOCUMENT_UPLOAD,
        {
          event:
            "DOCUMENT_UPLOAD_STARTED",
          reason:
            "Passport/document phase started"
        }
      );
    }

    await transition(
      application,
      STATES.PASSPORT_UPLOAD_REQUIRED,
      {
        event:
          "PASSPORT_UPLOAD_REQUIRED",
        reason:
          "VFS requires passport upload"
      }
    );

    return application;
  }

  /**
   * Registra passport upload concluído.
   */
  async markPassportUploaded(
    applicationId,
    accountId
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    if (
      application.getWorkflowState() !==
      STATES.PASSPORT_UPLOADING
    ) {
      await transition(
        application,
        STATES.PASSPORT_UPLOADING,
        {
          event:
            "PASSPORT_UPLOAD_STARTED"
        }
      );
    }

    await transition(
      application,
      STATES.PASSPORT_UPLOADED,
      {
        event:
          "PASSPORT_UPLOADED",
        reason:
          "Passport accepted by official upload step"
      }
    );

    return application;
  }

  /**
   * Prepara a resolução de uma solicitação
   * facial usando as 10 posições armazenadas.
   *
   * Mantido apenas para compatibilidade com o
   * fluxo oficial que utiliza referências seguras.
   */
  async resolveFacialPosition(
    applicationId,
    accountId,
    request
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    const state =
      application.getWorkflowState();

    if (
      ![
        STATES.PASSPORT_UPLOADED,
        STATES.FACIAL_SESSION_STARTING,
        STATES.FACIAL_LIVENESS_REQUIRED,
        STATES.FACIAL_LIVENESS_PROCESSING,
        STATES.FACIAL_POSITION_REQUESTED,
        STATES.FACIAL_POSITION_UNRESOLVED
      ].includes(state)
    ) {
      const error =
        new Error(
          `A resolução facial não pode iniciar no estado ${state}.`
        );

      error.code =
        "FACIAL_STEP_NOT_ALLOWED";

      throw error;
    }

    const clientIds =
      application.applicants
        ?.map(
          (applicant) =>
            applicant.client
        )
        .filter(Boolean) || [];

    const clients =
      await Client.find({
        _id: {
          $in: clientIds
        },
        accountId:
          application.accountId
      });

    if (!clients.length) {
      const error =
        new Error(
          "Nenhum candidato disponível para a etapa facial."
        );

      error.code =
        "FACIAL_CLIENT_NOT_FOUND";

      throw error;
    }

    const client =
      clients[0];

    const validation =
      validateTenFacialPositions(
        client
      );

    if (!validation.valid) {
      const error =
        new Error(
          validation.message
        );

      error.code =
        validation.code;

      throw error;
    }

    if (
      application.getWorkflowState() !==
      STATES.FACIAL_POSITION_REQUESTED
    ) {
      await transition(
        application,
        STATES.FACIAL_POSITION_REQUESTED,
        {
          event:
            "FACIAL_POSITION_REQUESTED",
          reason:
            "VFS requested a facial position"
        }
      );
    }

    await transition(
      application,
      STATES.FACIAL_POSITION_RESOLVING,
      {
        event:
          "FACIAL_POSITION_RESOLUTION_STARTED"
      }
    );

    const result =
      await facialService.resolvePositionRequest({
        request,
        positions:
          validation.positions
      });

    if (
      !result ||
      result.unresolved
    ) {
      await transition(
        application,
        STATES.FACIAL_POSITION_UNRESOLVED,
        {
          event:
            "FACIAL_POSITION_UNRESOLVED",
          reason:
            "No sufficiently confident stored position matched the request"
        }
      );

      return {
        application,
        resolved: false,
        result
      };
    }

    application.workflow.lastEvent =
      "FACIAL_POSITION_RESOLVED";

    application.workflow.lastReason =
      `Stored position ${result.position} selected`;

    await application.save();

    return {
      application,
      resolved: true,
      result
    };
  }

  /**
   * Marca que a posição facial selecionada
   * foi entregue pelo adaptador compatível.
   */
  async markFacialPositionSubmitted(
    applicationId,
    accountId
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    if (
      application.getWorkflowState() !==
      STATES.FACIAL_POSITION_RESOLVING
    ) {
      const error =
        new Error(
          "A posição facial não está pronta para submissão."
        );

      error.code =
        "FACIAL_POSITION_NOT_RESOLVED";

      throw error;
    }

    await transition(
      application,
      STATES.FACIAL_POSITION_SUBMITTING,
      {
        event:
          "FACIAL_POSITION_SUBMISSION_STARTED"
      }
    );

    return application;
  }

  /**
   * Registra a conclusão da verificação
   * facial oficial.
   */
  async markFacialVerificationCompleted(
    applicationId,
    accountId
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    await transition(
      application,
      STATES.FACIAL_VERIFICATION_COMPLETED,
      {
        event:
          "FACIAL_VERIFICATION_COMPLETED",
        reason:
          "Official facial verification completed"
      }
    );

    return application;
  }

  /**
   * Marca OTP como obrigatório.
   */
  async requireOtp(
    applicationId,
    accountId,
    metadata = {}
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    const state =
      application.getWorkflowState();

    if (
      ![
        STATES.VFS_AUTHENTICATING,
        STATES.VFS_AUTHENTICATED,
        STATES.BOOKING,
        STATES.FACIAL_VERIFICATION_COMPLETED,
        STATES.OTP_REQUIRED,
        STATES.OTP_RECEIVING
      ].includes(state)
    ) {
      const error =
        new Error(
          `OTP não pode ser solicitado no estado ${state}.`
        );

      error.code =
        "OTP_NOT_ALLOWED";

      throw error;
    }

    application.otp.status =
      "waiting";

    if (metadata.requestId) {
      application.otp.requestId =
        metadata.requestId;
    }

    if (metadata.expiresAt) {
      application.otp.expiresAt =
        new Date(
          metadata.expiresAt
        );
    }

    await application.save();

    if (
      state !==
      STATES.OTP_REQUIRED
    ) {
      await transition(
        application,
        STATES.OTP_REQUIRED,
        {
          event:
            "OTP_REQUIRED",
          reason:
            "Official VFS flow requested OTP"
        }
      );
    }

    return application;
  }

  /**
   * Marca OTP recebido.
   */
  async markOtpReceived(
    applicationId,
    accountId,
    metadata = {}
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    if (
      application.getWorkflowState() !==
      STATES.OTP_REQUIRED
    ) {
      const error =
        new Error(
          "OTP não está no estado requerido."
        );

      error.code =
        "OTP_NOT_EXPECTED";

      throw error;
    }

    application.otp.status =
      "waiting";

    if (metadata.requestId) {
      application.otp.requestId =
        metadata.requestId;
    }

    if (metadata.expiresAt) {
      application.otp.expiresAt =
        new Date(
          metadata.expiresAt
        );
    }

    await application.save();

    await transition(
      application,
      STATES.OTP_RECEIVING,
      {
        event:
          "OTP_RECEIVING"
      }
    );

    await transition(
      application,
      STATES.OTP_RECEIVED,
      {
        event:
          "OTP_RECEIVED",
        reason:
          "Authorized OTP provider returned a code"
      }
    );

    return application;
  }

  /**
   * Marca OTP verificado.
   */
  async markOtpVerified(
    applicationId,
    accountId
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    application.otp.status =
      "verified";

    application.otp.verifiedAt =
      new Date();

    await application.save();

    await transition(
      application,
      STATES.OTP_VERIFIED,
      {
        event:
          "OTP_VERIFIED",
        reason:
          "VFS accepted the OTP"
      }
    );

    return application;
  }

  /**
   * Regista falha de OTP.
   */
  async markOtpFailed(
    applicationId,
    accountId,
    reason
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    application.otp.status =
      "failed";

    application.otp.attempts =
      Number(
        application.otp.attempts || 0
      ) + 1;

    await application.save();

    await transition(
      application,
      STATES.OTP_FAILED,
      {
        event:
          "OTP_FAILED",
        reason:
          cleanString(reason) ||
          "OTP verification failed"
      }
    );

    return application;
  }

  /**
   * Marca aplicação como paga.
   */
  async markPaymentPending(
    applicationId,
    accountId,
    payment = {}
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    application.result =
      application.result || {};

    if (payment.reference) {
      application.result.reference =
        String(
          payment.reference
        );
    }

    if (payment.entity) {
      application.result.entity =
        String(
          payment.entity
        );
    }

    if (
      payment.transactionId
    ) {
      application.result.transactionId =
        String(
          payment.transactionId
        );
    }

    if (
      payment.amount !==
      undefined
    ) {
      application.result.paymentAmount =
        payment.amount;
    }

    if (payment.currency) {
      application.result.paymentCurrency =
        String(
          payment.currency
        );
    }

    if (payment.deadline) {
      application.result.paymentDeadline =
        String(
          payment.deadline
        );
    }

    application.result.paymentStatus =
      "pending";

    await application.save();

    if (
      application.getWorkflowState() !==
      STATES.PAYMENT_PENDING
    ) {
      await transition(
        application,
        STATES.PAYMENT_PENDING,
        {
          event:
            "PAYMENT_PENDING",
          reason:
            "Appointment booked and payment is pending"
        }
      );
    }

    return application;
  }

  /**
   * Confirma o pagamento.
   */
  async markPaymentConfirmed(
    applicationId,
    accountId,
    payment = {}
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    application.result =
      application.result || {};

    application.result.paymentStatus =
      "confirmed";

    if (
      payment.transactionId
    ) {
      application.result.transactionId =
        String(
          payment.transactionId
        );
    }

    await application.save();

    await transition(
      application,
      STATES.PAYMENT_CONFIRMED,
      {
        event:
          "PAYMENT_CONFIRMED",
        reason:
          "Payment confirmed"
      }
    );

    await transition(
      application,
      STATES.COMPLETED,
      {
        event:
          "APPLICATION_COMPLETED",
        reason:
          "Appointment and payment workflow completed"
      }
    );

    return application;
  }

  /**
   * Marca pagamento expirado.
   */
  async markPaymentExpired(
    applicationId,
    accountId,
    reason
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    application.result =
      application.result || {};

    application.result.paymentStatus =
      "expired";

    await application.save();

    await transition(
      application,
      STATES.PAYMENT_EXPIRED,
      {
        event:
          "PAYMENT_EXPIRED",
        reason:
          cleanString(reason) ||
          "Payment deadline expired"
      }
    );

    return application;
  }

  /**
   * Regista slot perdido.
   */
  async markSlotLost(
    applicationId,
    accountId,
    reason
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    application.slot =
      application.slot || {};

    application.slot.date =
      null;

    application.slot.time =
      null;

    application.bot2.monitoring =
      true;

    application.bot2.status =
      "monitoring";

    application.radar.enabled =
      true;

    await application.save();

    await transition(
      application,
      STATES.SLOT_LOST,
      {
        event:
          "SLOT_LOST",
        reason:
          cleanString(reason) ||
          "Slot was no longer available"
      }
    );

    await transition(
      application,
      STATES.RADAR_ACTIVE,
      {
        event:
          "RADAR_RESUMED",
        reason:
          "Returning application to radar"
      }
    );

    return application;
  }

  /**
   * Cancela uma aplicação.
   */
  async cancel(
    applicationId,
    accountId,
    reason
  ) {
    const application =
      await this.getById(
        applicationId,
        accountId
      );

    if (
      application.getWorkflowState() ===
      STATES.COMPLETED
    ) {
      throw new Error(
        "Uma aplicação concluída não pode ser cancelada."
      );
    }

    await transition(
      application,
      STATES.CANCELLED,
      {
        event:
          "APPLICATION_CANCELLED",
        reason:
          cleanString(reason) ||
          "Application cancelled"
      }
    );

    application.radar.enabled =
      false;

    application.bot2.monitoring =
      false;

    application.bot2.status =
      "stopped";

    await application.save();

    return application;
  }

  /**
   * Resumo seguro para API/UI.
   */
  serialize(application) {
    if (!application) {
      return null;
    }

    return {
      id:
        String(application._id),

      accountId:
        application.accountId,

      status:
        application.status,

      workflowState:
        application.getWorkflowState(),

      visaType:
        application.visaType,

      visaCenter:
        application.visaCenter,

      serviceType:
        application.serviceType,

      appointmentMode:
        application.appointmentMode,

      preferredDates:
        application.preferredDates,

      preferredTime:
        application.preferredTime,

      preferredWeekdays:
        application.preferredWeekdays,

      applicants:
        Array.isArray(
          application.applicants
        )
          ? application.applicants.map(
              (applicant) => ({
                client:
                  applicant.client,

                passport:
                  applicant.passport,

                personalData:
                  applicant.personalData,

                identityStatus:
                  applicant.identityStatus,

                vfsStatus:
                  applicant.vfsStatus,

                liveness:
                  applicant.liveness ||
                  null
              })
            )
          : [],

      applicantsCount:
        application.applicantsCount,

      slot:
        application.slot,

      radar: {
        enabled:
          application.radar?.enabled ||
          false,

        status:
          application.bot2?.status ||
          "idle",

        lastCheckAt:
          application.bot2?.lastCheckAt ||
          null,

        lastSuccessfulCheckAt:
          application.radar
            ?.lastSuccessfulCheckAt ||
          null,

        nextCheckAt:
          application.radar
            ?.nextCheckAt ||
          null
      },

      result: {
        reference:
          application.result
            ?.reference ||
          null,

        entity:
          application.result
            ?.entity ||
          null,

        transactionId:
          application.result
            ?.transactionId ||
          null,

        paymentStatus:
          application.result
            ?.paymentStatus ||
          null,

        paymentAmount:
          application.result
            ?.paymentAmount ||
          null,

        paymentCurrency:
          application.result
            ?.paymentCurrency ||
          null,

        paymentDeadline:
          application.result
            ?.paymentDeadline ||
          null,

        confirmationUrl:
          application.result
            ?.confirmationUrl ||
          null
      },

      bot1: {
        status:
          application.bot1
            ?.status ||
          "idle",

        lastAction:
          application.bot1
            ?.lastAction ||
          null
      },

      bot2: {
        status:
          application.bot2
            ?.status ||
          "idle",

        monitoring:
          application.bot2
            ?.monitoring ||
          false
      },

      otp: {
        status:
          application.otp
            ?.status ||
          "not_required",

        expiresAt:
          application.otp
            ?.expiresAt ||
          null,

        verifiedAt:
          application.otp
            ?.verifiedAt ||
          null
      },

      workflow: {
        previousState:
          application.workflow
            ?.previousState ||
          null,

        stateChangedAt:
          application.workflow
            ?.stateChangedAt ||
          null,

        lastEvent:
          application.workflow
            ?.lastEvent ||
          null,

        lastReason:
          application.workflow
            ?.lastReason ||
          null,

        transitionCount:
          application.workflow
            ?.transitionCount ||
          0
      },

      createdAt:
        application.createdAt,

      updatedAt:
        application.updatedAt
    };
  }
}

module.exports =
  new ApplicationService();
