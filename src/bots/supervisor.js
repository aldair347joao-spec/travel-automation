"use strict";

const Application =
  require("../models/application");

const Bot1 =
  require("./bot1");

const Bot2 =
  require("./bot2");

const eventBus =
  require("../utils/event-bus");

const TelegramService =
  require("../services/telegram/telegram-service");

const logger =
  require("../utils/logger");

const PaymentResumeService =
  require("../services/payment/payment-resume-service");

const {
  STATES,
  isKnownState
} =
  require("../services/application/application-state-machine");

const crypto =
  require("crypto");


class Supervisor {

  constructor({
    siteFactory,
    intervalMs = 2000
  }) {

    this.siteFactory =
      siteFactory;

    this.telegram =
      new TelegramService();

    this.adapters =
      new Map();

    this.bot1 =
      new Map();

    this.bot2 =
      new Bot2({
        getAdapter:
          applicationId =>
            this.getAdapter(
              applicationId
            ),

        intervalMs
      });

    this.started =
      false;

    this.workerId =
      crypto.randomUUID();

    this.stats = {
      slotEvents:
        0,

      completed:
        0,

      paymentPending:
        0,

      requiresUser:
        0,

      recovered:
        0,

      errors:
        0,

      startedAt:
        null
    };

    this.onSlotFound =
      this.onSlotFound.bind(
        this
      );
  }


  /* =======================================================
   * ADAPTER
   * ======================================================= */

  async getAdapter(
    applicationId
  ) {

    if (
      this.adapters.has(
        applicationId
      )
    ) {

      return this.adapters.get(
        applicationId
      );
    }

    const adapter =
      this.siteFactory(
        applicationId
      );

    await adapter.initialize();

    this.adapters.set(
      applicationId,
      adapter
    );

    return adapter;
  }


  /* =======================================================
   * BOT 1
   * ======================================================= */

  async getBot1(
    applicationId
  ) {

    if (
      this.bot1.has(
        applicationId
      )
    ) {

      return this.bot1.get(
        applicationId
      );
    }

    const adapter =
      await this.getAdapter(
        applicationId
      );

    const bot =
      new Bot1(
        adapter
      );

    this.bot1.set(
      applicationId,
      bot
    );

    return bot;
  }


  async prepare(
    applicationId
  ) {

    const bot =
      await this.getBot1(
        applicationId
      );

    return bot.prepare(
      applicationId
    );
  }


  async verifyOtp(
    applicationId,
    code
  ) {

    const bot =
      await this.getBot1(
        applicationId
      );

    return bot.verifyOtp(
      applicationId,
      code
    );
  }


  async continueAfterVerification(
    applicationId
  ) {

    const bot =
      await this.getBot1(
        applicationId
      );

    return bot.continueAfterVerification(
      applicationId
    );
  }


  /* =======================================================
   * WORKFLOW HELPERS
   * ======================================================= */

  getWorkflowState(
    application
  ) {

    if (
      !application
    ) {

      return STATES.ERROR;
    }

    if (
      application.workflowState &&
      isKnownState(
        application.workflowState
      )
    ) {

      return application.workflowState;
    }

    if (
      typeof application.getWorkflowState ===
      "function"
    ) {

      return application.getWorkflowState();
    }

    return STATES.CREATED;
  }


  async transitionApplication(
    application,
    nextState,
    metadata = {}
  ) {

    if (
      !application
    ) {

      throw new Error(
        "Application is required for workflow transition"
      );
    }

    const currentState =
      this.getWorkflowState(
        application
      );

    if (
      currentState ===
      nextState
    ) {

      return application;
    }

    try {

      application.transitionTo(
        nextState,
        metadata
      );

      await application.save();

      return application;

    } catch (error) {

      logger.warn(
        "APPLICATION workflow transition rejected",
        {
          applicationId:
            application._id?.toString?.() ||
            null,

          currentState,

          nextState,

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


  async ensureWorkflowState(
    application
  ) {

    if (
      !application
    ) {

      return null;
    }

    const current =
      this.getWorkflowState(
        application
      );

    if (
      application.workflowState ===
      current
    ) {

      return current;
    }

    application.workflowState =
      current;

    if (
      !application.workflow
    ) {

      application.workflow = {};
    }

    application.workflow.stateChangedAt =
      application.workflow.stateChangedAt ||
      new Date();

    await application.save();

    return current;
  }


  /* =======================================================
   * PAYMENT RESUME
   * ======================================================= */

  async resumeApplication(
    applicationId
  ) {

    let application =
      await Application.findById(
        applicationId
      );

    if (
      !application
    ) {

      throw new Error(
        "Application not found"
      );
    }

    await this.ensureWorkflowState(
      application
    );

    const workflowState =
      this.getWorkflowState(
        application
      );

    const paymentPending =
      workflowState ===
        STATES.PAYMENT_PENDING ||
      (
        application.status ===
          "requires_user" &&
        application.result?.paymentStatus ===
          "pending"
      );

    if (
      !paymentPending
    ) {

      throw new Error(
        "Application is not waiting for payment confirmation"
      );
    }

    const adapter =
      await this.getAdapter(
        applicationId
      );

    const service =
      new PaymentResumeService({
        adapter,

        timeoutMs:
          Number(
            process.env.BOT1_TIMEOUT_MS
          ) || 30000
      });


    try {

      /*
       * Se a aplicação ainda estiver em
       * APPOINTMENT_BOOKED, avançamos para
       * PAYMENT_PENDING.
       */

      if (
        this.getWorkflowState(
          application
        ) ===
        STATES.APPOINTMENT_BOOKED
      ) {

        await this.transitionApplication(
          application,
          STATES.PAYMENT_PENDING,
          {
            event:
              "payment_resume_requested",

            reason:
              "Appointment booked and payment confirmation is pending"
          }
        );
      }


      /*
       * LOCK EXCLUSIVO
       *
       * O erro antigo estava aqui:
       *
       * $or
       * $or
       *
       * O segundo sobrescrevia o primeiro.
       *
       * Agora as duas condições são combinadas
       * dentro de $and.
       */

      const locked =
        await Application.findOneAndUpdate(
          {
            _id:
              applicationId,

            $and: [

              {
                $or: [
                  {
                    workflowState:
                      STATES.PAYMENT_PENDING
                  },

                  {
                    status:
                      "requires_user"
                  }
                ]
              },

              {
                $or: [
                  {
                    "lock.owner":
                      null
                  },

                  {
                    "lock.owner": {
                      $exists:
                        false
                    }
                  },

                  {
                    "lock.expiresAt": {
                      $lt:
                        new Date()
                    }
                  }
                ]
              }

            ]
          },
          {
            $set: {
              workflowState:
                STATES.PAYMENT_PENDING,

              status:
                "review_pay",

              "bot1.status":
                "running",

              "bot1.workerId":
                this.workerId,

              "bot1.heartbeatAt":
                new Date(),

              "bot1.lastAction":
                "resuming_payment",

              "lock.owner":
                this.workerId,

              "lock.expiresAt":
                new Date(
                  Date.now() +
                  (
                    Number(
                      process.env.BOT1_LOCK_MS
                    ) || 60000
                  )
                ),

              "bot2.monitoring":
                false,

              "radar.enabled":
                false
            }
          },
          {
            new:
              true
          }
        );


      if (
        !locked
      ) {

        throw new Error(
          "Application is already being resumed or its payment state changed"
        );
      }


      const result =
        await service.resume(
          locked
        );


      /*
       * ---------------------------------------------------
       * PAGAMENTO AINDA PENDENTE
       * ---------------------------------------------------
       */

      if (
        result.requiresUser ===
        true
      ) {

        const updated =
          await Application.findOneAndUpdate(
            {
              _id:
                applicationId,

              "lock.owner":
                this.workerId
            },
            {
              $set: {

                workflowState:
                  STATES.PAYMENT_PENDING,

                status:
                  "review_pay",

                "bot1.status":
                  "waiting",

                "bot1.lastAction":
                  "payment_pending",

                "bot1.heartbeatAt":
                  new Date(),

                "lock.owner":
                  null,

                "lock.expiresAt":
                  null,

                "bot2.monitoring":
                  false,

                "radar.enabled":
                  false
              }
            },
            {
              new:
                true
            }
          );


        this.stats.paymentPending++;


        logger.info(
          "ORCHESTRATOR payment still pending",
          {
            applicationId,

            reference:
              updated?.result
                ?.reference ||
              result.payment
                ?.reference ||
              null,

            entity:
              updated?.result
                ?.entity ||
              result.payment
                ?.entity ||
              null,

            amount:
              updated?.result
                ?.paymentAmount ||
              result.payment
                ?.amount ||
              null,

            currency:
              updated?.result
                ?.paymentCurrency ||
              result.payment
                ?.currency ||
              null,

            deadline:
              updated?.result
                ?.paymentDeadline ||
              result.payment
                ?.deadline ||
              null
          }
        );


        return {
          success:
            true,

          completed:
            false,

          requiresUser:
            false,

          paymentPending:
            true,

          reason:
            result.reason ||
            "Payment is still pending.",

          application:
            updated,

          payment:
            result.payment ||
            null
        };
      }


      /*
       * ---------------------------------------------------
       * PAGAMENTO NÃO CONFIRMADO
       * ---------------------------------------------------
       */

      if (
        result.completed !==
        true
      ) {

        const updated =
          await Application.findOneAndUpdate(
            {
              _id:
                applicationId,

              "lock.owner":
                this.workerId
            },
            {
              $set: {

                workflowState:
                  STATES.PAYMENT_PENDING,

                status:
                  "review_pay",

                "bot1.status":
                  "waiting",

                "bot1.lastAction":
                  "payment_not_confirmed",

                "bot1.heartbeatAt":
                  new Date(),

                "lock.owner":
                  null,

                "lock.expiresAt":
                  null
              }
            },
            {
              new:
                true
            }
          );


        this.stats.paymentPending++;


        return {
          success:
            true,

          completed:
            false,

          requiresUser:
            false,

          paymentPending:
            true,

          reason:
            "Payment confirmation could not be independently verified.",

          application:
            updated,

          payment:
            result.payment ||
            null
        };
      }


      /*
       * ---------------------------------------------------
       * PAGAMENTO CONFIRMADO
       * ---------------------------------------------------
       */

      const confirmed =
        await Application.findOneAndUpdate(
          {
            _id:
              applicationId,

            "lock.owner":
              this.workerId
          },
          {
            $set: {

              workflowState:
                STATES.PAYMENT_CONFIRMED,

              status:
                "book_appointment",

              "bot1.status":
                "continuing",

              "bot1.lastAction":
                "payment_confirmed",

              "bot1.heartbeatAt":
                new Date(),

              "lock.owner":
                this.workerId,

              "lock.expiresAt":
                new Date(
                  Date.now() +
                  (
                    Number(
                      process.env.BOT1_LOCK_MS
                    ) || 60000
                  )
                )
            }
          },
          {
            new:
              true
          }
        );


      if (
        !confirmed
      ) {

        throw new Error(
          "Application payment confirmation lock was lost"
        );
      }


      /*
       * Só marcamos COMPLETED depois da
       * confirmação independente do pagamento.
       */

      const completed =
        await Application.findOneAndUpdate(
          {
            _id:
              applicationId,

            workflowState:
              STATES.PAYMENT_CONFIRMED,

            "lock.owner":
              this.workerId
          },
          {
            $set: {

              workflowState:
                STATES.COMPLETED,

              status:
                "completed",

              "bot1.status":
                "completed",

              "bot1.lastAction":
                "completed",

              "bot1.completedAt":
                new Date(),

              "bot1.heartbeatAt":
                new Date(),

              "bot2.monitoring":
                false,

              "radar.enabled":
                false,

              "lock.owner":
                null,

              "lock.expiresAt":
                null,

              "result.paymentStatus":
                result.payment
                  ?.paymentStatus ||
                "confirmed",

              "result.reference":
                result.payment
                  ?.reference ||
                null,

              "result.entity":
                result.payment
                  ?.entity ||
                null,

              "result.transactionId":
                result.payment
                  ?.transactionId ||
                null,

              "result.paymentAmount":
                result.payment
                  ?.amount ||
                null,

              "result.paymentCurrency":
                result.payment
                  ?.currency ||
                null,

              "result.paymentDeadline":
                result.payment
                  ?.deadline ||
                null,

              "result.confirmationUrl":
                result.payment
                  ?.confirmationUrl ||
                null
            }
          },
          {
            new:
              true
          }
        );


      if (
        !completed
      ) {

        throw new Error(
          "Application completion lock was lost"
        );
      }


      this.stats.completed++;


      try {

        await this.telegram.completed(
          completed,
          completed.client
        );

      } catch (
        telegramError
      ) {

        logger.error(
          "Telegram completion notification failed after payment resume",
          {
            applicationId,

            error:
              telegramError.message
          }
        );
      }


      await this.closeAdapter(
        applicationId
      );


      return {
        success:
          true,

        completed:
          true,

        requiresUser:
          false,

        paymentPending:
          false,

        application:
          completed,

        payment:
          result.payment ||
          null,

        confirmation:
          result.confirmation ||
          null
      };


    } catch (
      error
    ) {

      await Application.updateOne(
        {
          _id:
            applicationId,

          "lock.owner":
            this.workerId
        },
        {
          $set: {

            "bot1.status":
              "error",

            "bot1.lastAction":
              "resume_error",

            "lock.owner":
              null,

            "lock.expiresAt":
              null,

            "error.code":
              "PAYMENT_RESUME_FAILED",

            "error.message":
              error.message,

            "error.at":
              new Date()
          }
        }
      );


      logger.error(
        "ORCHESTRATOR payment resume failed",
        {
          applicationId,

          error:
            error.message
        }
      );

      throw error;
    }
  }


  /* =======================================================
   * SLOT FOUND
   * ======================================================= */

  async onSlotFound(
    payload
  ) {

    const {
      applicationId,
      detectedAt
    } =
      payload;

    this.stats.slotEvents++;


    try {

      let application =
        await Application.findById(
          applicationId
        ).populate(
          "client"
        );


      if (
        !application
      ) {

        logger.warn(
          "ORCHESTRATOR received slot for missing application",
          {
            applicationId
          }
        );

        return;
      }


      await this.ensureWorkflowState(
        application
      );


      const currentState =
        this.getWorkflowState(
          application
        );


      if (
        currentState ===
        STATES.RADAR_ACTIVE
      ) {

        await this.transitionApplication(
          application,
          STATES.SLOT_FOUND,
          {
            event:
              "slot_found",

            reason:
              "Bot 2 found a slot matching application preferences"
          }
        );

      } else if (
        currentState !==
        STATES.SLOT_FOUND &&
        currentState !==
        STATES.SLOT_LOCKED &&
        currentState !==
        STATES.SLOT_REVALIDATED
      ) {

        if (
          application.status ===
          "slot_received"
        ) {

          application.workflowState =
            STATES.SLOT_FOUND;

          application.workflow =
            application.workflow ||
            {};

          application.workflow.stateChangedAt =
            new Date();

          application.workflow.lastEvent =
            "slot_found";

          application.workflow.lastReason =
            "Recovered legacy slot_received state";

          await application.save();

        } else {

          logger.info(
            "ORCHESTRATOR ignored slot event with incompatible state",
            {
              applicationId,

              status:
                application.status,

              workflowState:
                currentState
            }
          );

          return;
        }
      }


      const bot =
        await this.getBot1(
          applicationId
        );


      /*
       * O Bot 1 assume o lock do slot.
       */

      const locked =
        await Application.findOneAndUpdate(
          {
            _id:
              applicationId,

            workflowState:
              STATES.SLOT_FOUND,

            $or: [
              {
                "lock.owner":
                  null
              },

              {
                "lock.owner": {
                  $exists:
                    false
                }
              },

              {
                "lock.expiresAt": {
                  $lt:
                    new Date()
                }
              }
            ]
          },
          {
            $set: {

              workflowState:
                STATES.SLOT_LOCKED,

              "bot1.status":
                "starting",

              "bot1.workerId":
                this.workerId,

              "bot1.startedAt":
                new Date(),

              "bot1.heartbeatAt":
                new Date(),

              "bot1.lastAction":
                "slot_locked",

              "lock.owner":
                this.workerId,

              "lock.expiresAt":
                new Date(
                  Date.now() +
                  (
                    Number(
                      process.env.BOT1_LOCK_MS
                    ) || 60000
                  )
                ),

              "bot2.monitoring":
                false,

              "radar.enabled":
                false
            }
          },
          {
            new:
              true
          }
        );


      if (
        !locked
      ) {

        logger.info(
          "ORCHESTRATOR ignored duplicate or already claimed slot",
          {
            applicationId
          }
        );

        return;
      }


      let result;


      try {

        result =
          await bot.handleSlot(
            applicationId,
            detectedAt
          );

      } catch (
        botError
      ) {

        await Application.updateOne(
          {
            _id:
              applicationId,

            "lock.owner":
              this.workerId
          },
          {
            $set: {

              workflowState:
                STATES.BOOKING_FAILED,

              status:
                "error",

              "bot1.status":
                "error",

              "bot1.lastAction":
                "slot_processing_failed",

              "error.code":
                "BOT1_SLOT_PROCESSING_FAILED",

              "error.message":
                botError.message,

              "error.at":
                new Date(),

              "lock.owner":
                null,

              "lock.expiresAt":
                null
            }
          }
        );

        throw botError;
      }


      if (
        !result ||
        !result.success
      ) {

        const current =
          await Application.findById(
            applicationId
          );

        logger.info(
          "ORCHESTRATOR slot processing did not complete",
          {
            applicationId,

            status:
              current?.status ||
              "unknown",

            workflowState:
              current?.workflowState ||
              null,

            message:
              result?.message ||
              null
          }
        );

        return;
      }


      let updatedApplication =
        result.application ||
        await Application.findById(
          applicationId
        ).populate(
          "client"
        );


      if (
        !updatedApplication
      ) {

        logger.warn(
          "ORCHESTRATOR could not reload application after slot processing",
          {
            applicationId
          }
        );

        return;
      }


      await this.ensureWorkflowState(
        updatedApplication
      );


      const state =
        this.getWorkflowState(
          updatedApplication
        );


      /*
       * ---------------------------------------------------
       * PAGAMENTO PENDENTE
       * ---------------------------------------------------
       */

      const isPaymentPending =
        state ===
          STATES.PAYMENT_PENDING ||
        updatedApplication.result
          ?.paymentStatus ===
          "pending";


      if (
        isPaymentPending
      ) {

        if (
          state !==
          STATES.PAYMENT_PENDING
        ) {

          updatedApplication.workflowState =
            STATES.PAYMENT_PENDING;

          updatedApplication.workflow =
            updatedApplication.workflow ||
            {};

          updatedApplication.workflow.previousState =
            state;

          updatedApplication.workflow.stateChangedAt =
            new Date();

          updatedApplication.workflow.lastEvent =
            "payment_pending";

          updatedApplication.workflow.lastReason =
            "Appointment requires payment confirmation";

          updatedApplication.status =
            "review_pay";

          await updatedApplication.save();
        }


        this.stats.paymentPending++;


        logger.info(
          "ORCHESTRATOR appointment booked; payment pending",
          {
            applicationId,

            reference:
              updatedApplication.result
                ?.reference ||
              null,

            entity:
              updatedApplication.result
                ?.entity ||
              null,

            amount:
              updatedApplication.result
                ?.paymentAmount ||
              null,

            currency:
              updatedApplication.result
                ?.paymentCurrency ||
              null,

            deadline:
              updatedApplication.result
                ?.paymentDeadline ||
              null
          }
        );


        try {

          if (
            typeof this.telegram.paymentPending ===
            "function"
          ) {

            await this.telegram.paymentPending(
              updatedApplication,
              updatedApplication.client
            );
          }

        } catch (
          telegramError
        ) {

          logger.error(
            "Telegram payment-pending notification failed",
            {
              applicationId,

              error:
                telegramError.message
            }
          );
        }


        await this.closeAdapter(
          applicationId
        );

        return;
      }


      /*
       * ---------------------------------------------------
       * COMPLETED
       * ---------------------------------------------------
       */

      if (
        state ===
          STATES.COMPLETED ||
        updatedApplication.status ===
          "completed"
      ) {

        this.stats.completed++;


        logger.info(
          "ORCHESTRATOR appointment completed",
          {
            applicationId,

            reference:
              updatedApplication.result
                ?.reference ||
              null,

            entity:
              updatedApplication.result
                ?.entity ||
              null,

            transactionId:
              updatedApplication.result
                ?.transactionId ||
              null,

            paymentStatus:
              updatedApplication.result
                ?.paymentStatus ||
              null
          }
        );


        try {

          await this.telegram.completed(
            updatedApplication,
            updatedApplication.client
          );

        } catch (
          telegramError
        ) {

          logger.error(
            "Telegram completion notification failed",
            {
              applicationId,

              error:
                telegramError.message
            }
          );
        }


        await this.closeAdapter(
          applicationId
        );

        return;
      }


      logger.info(
        "ORCHESTRATOR slot processing returned intermediate state",
        {
          applicationId,

          status:
            updatedApplication.status,

          workflowState:
            updatedApplication.workflowState,

          message:
            result.message ||
            null
        }
      );


    } catch (
      error
    ) {

      this.stats.errors++;


      logger.error(
        "ORCHESTRATOR slot handler failed",
        {
          applicationId,

          error:
            error.message
        }
      );


      try {

        const application =
          await Application.findById(
            applicationId
          );


        if (
          application
        ) {

          await this.telegram.error(
            application,
            error.message
          );
        }

      } catch {
        /*
         * Falha de notificação não deve
         * derrubar o supervisor.
         */
      }
    }
  }


  /* =======================================================
   * RECOVERY DE SLOTS
   * ======================================================= */

  async recoverSlots() {

    const applications =
      await Application.find({
        status:
          "slot_received"
      })
        .sort({
          updatedAt:
            1
        })
        .limit(100);


    for (
      const application
      of applications
    ) {

      this.stats.recovered++;


      if (
        this.getWorkflowState(
          application
        ) ===
        STATES.RADAR_ACTIVE
      ) {

        application.workflowState =
          STATES.SLOT_FOUND;

        application.workflow =
          application.workflow ||
          {};

        application.workflow.stateChangedAt =
          new Date();

        application.workflow.lastEvent =
          "slot_recovery";

        application.workflow.lastReason =
          "Recovered slot_received application after process restart";

        await application.save();
      }


      logger.info(
        "ORCHESTRATOR recovering slot",
        {
          applicationId:
            application._id.toString(),

          slot:
            application.slot,

          workflowState:
            application.workflowState
        }
      );


      eventBus.emit(
        "slot_found",
        {
          applicationId:
            application._id.toString(),

          slot:
            application.slot,

          detectedAt:
            application.bot2
              ?.slotDetectedAt ||
            new Date(),

          recovered:
            true
        }
      );
    }
  }


  /* =======================================================
   * RECOVERY DE LOCKS
   * ======================================================= */

  async recoverStaleLocks() {

    const staleBefore =
      new Date();


    const result =
      await Application.updateMany(
        {
          "lock.owner": {
            $ne:
              null
          },

          "lock.expiresAt": {
            $lt:
              staleBefore
          },

          workflowState: {
            $nin: [
              STATES.COMPLETED,
              STATES.CANCELLED
            ]
          },

          status: {
            $nin: [
              "completed",
              "cancelled"
            ]
          }
        },
        {
          $set: {
            "lock.owner":
              null,

            "lock.expiresAt":
              null
          }
        }
      );


    if (
      result.modifiedCount
    ) {

      logger.warn(
        "ORCHESTRATOR released stale locks",
        {
          count:
            result.modifiedCount
        }
      );
    }
  }


  /* =======================================================
   * RECOVERY DE APLICAÇÕES À ESPERA DE SLOT
   * ======================================================= */

  async recoverWaitingApplications() {

    const result =
      await Application.updateMany(
        {
          status:
            "waiting_for_slot",

          "bot2.monitoring": {
            $ne:
              true
          }
        },
        {
          $set: {

            workflowState:
              STATES.RADAR_ACTIVE,

            "bot2.monitoring":
              true,

            "bot2.status":
              "monitoring",

            "bot2.workerId":
              null,

            "radar.enabled":
              true
          }
        }
      );


    if (
      result.modifiedCount
    ) {

      logger.info(
        "ORCHESTRATOR restored waiting applications",
        {
          count:
            result.modifiedCount
        }
      );
    }
  }


  /* =======================================================
   * RECOVERY GERAL
   * ======================================================= */

  async recover() {

    await this.recoverStaleLocks();

    await this.recoverWaitingApplications();

    await this.recoverSlots();
  }


  /* =======================================================
   * FECHAR ADAPTER
   * ======================================================= */

  async closeAdapter(
    applicationId
  ) {

    const adapter =
      this.adapters.get(
        applicationId
      );


    if (
      !adapter
    ) {

      return;
    }


    try {

      await adapter.close();

    } catch (
      error
    ) {

      logger.warn(
        "Site adapter close failed",
        {
          applicationId,

          error:
            error.message
        }
      );
    }


    this.adapters.delete(
      applicationId
    );

    this.bot1.delete(
      applicationId
    );
  }


  /* =======================================================
   * START
   * ======================================================= */

  start() {

    if (
      this.started
    ) {

      return;
    }


    this.started =
      true;

    this.stats.startedAt =
      new Date();


    eventBus.on(
      "slot_found",
      this.onSlotFound
    );


    this.bot2.start();


    this.recover()
      .catch(
        error => {

          this.stats.errors++;


          logger.error(
            "ORCHESTRATOR recovery failed",
            {
              error:
                error.message
            }
          );
        }
      );


    logger.info(
      "ORCHESTRATOR started",
      {
        workerId:
          this.workerId
      }
    );
  }


  /* =======================================================
   * STOP
   * ======================================================= */

  stop() {

    this.started =
      false;


    eventBus.off(
      "slot_found",
      this.onSlotFound
    );


    this.bot2.stop();


    for (
      const applicationId
      of this.adapters.keys()
    ) {

      this.closeAdapter(
        applicationId
      );
    }


    logger.info(
      "ORCHESTRATOR stopped",
      {
        workerId:
          this.workerId
      }
    );
  }


  /* =======================================================
   * STATUS
   * ======================================================= */

  status() {

    return {

      started:
        this.started,

      workerId:
        this.workerId,

      activeAdapters:
        this.adapters.size,

      activeBot1:
        this.bot1.size,

      bot2:
        this.bot2.status(),

      stats:
        this.stats
    };
  }
}


module.exports =
  Supervisor;
