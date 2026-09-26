const Application =
  require("../../models/application");

const ApplicationAdminControl =
  require("../../models/application-admin-control");

const {
  encrypt,
  decrypt
} =
  require("../../utils/crypto");


function cleanText(
  value
) {
  return String(
    value || ""
  ).trim();
}


function serialize(
  control
) {
  if (!control) {
    return null;
  }

  return {
    id:
      control._id,

    accountId:
      control.accountId,

    applicationId:
      control.applicationId,

    status:
      control.status,

    vfsCredentials: {
      configured:
        Boolean(
          control.vfsCredentials &&
          control.vfsCredentials.emailEncrypted &&
          control.vfsCredentials.passwordEncrypted
        ),

      configuredAt:
        control.vfsCredentials?.configuredAt ||
        null,

      configuredBy:
        control.vfsCredentials?.configuredBy ||
        null
    },

    release: {
      enabled:
        Boolean(
          control.release?.enabled
        ),

      releasedAt:
        control.release?.releasedAt ||
        null,

      releasedBy:
        control.release?.releasedBy ||
        null
    },

    lastAdminAction:
      control.lastAdminAction ||
      null,

    notes:
      control.notes ||
      "",

    createdAt:
      control.createdAt,

    updatedAt:
      control.updatedAt
  };
}


/*
 * ============================================================
 * OBTER / CRIAR CONTROLO ADMINISTRATIVO
 * ============================================================
 */

async function getOrCreate(
  application
) {
  let control =
    await ApplicationAdminControl.findOne({
      applicationId:
        application._id
    });

  if (control) {
    return control;
  }

  control =
    await ApplicationAdminControl.create({
      accountId:
        application.accountId,

      applicationId:
        application._id,

      status:
        "PENDING_REVIEW"
    });

  return control;
}


async function getByApplicationId(
  applicationId
) {
  return ApplicationAdminControl.findOne({
    applicationId
  });
}


/*
 * ============================================================
 * CONFIGURAR CREDENCIAIS VFS
 * ============================================================
 *
 * As credenciais são específicas desta aplicação.
 *
 * Nunca ficam:
 * - no frontend;
 * - no localStorage;
 * - no sessionStorage;
 * - em resposta da API;
 * - em variáveis globais do VFS.
 *
 * São armazenadas encriptadas.
 * ============================================================
 */

async function configureVfsCredentials({
  applicationId,
  email,
  password,
  phone,
  actorId
}) {
  const normalizedEmail =
    cleanText(
      email
    );

  const normalizedPassword =
    String(
      password || ""
    );

  if (!normalizedEmail) {
    const error =
      new Error(
        "VFS email is required"
      );

    error.code =
      "VFS_EMAIL_REQUIRED";

    error.statusCode =
      400;

    throw error;
  }

  if (!normalizedPassword) {
    const error =
      new Error(
        "VFS password is required"
      );

    error.code =
      "VFS_PASSWORD_REQUIRED";

    error.statusCode =
      400;

    throw error;
  }

  const application =
    await Application.findById(
      applicationId
    );

  if (!application) {
    const error =
      new Error(
        "Application not found"
      );

    error.code =
      "APPLICATION_NOT_FOUND";

    error.statusCode =
      404;

    throw error;
  }

  const control =
    await getOrCreate(
      application
    );

  control.vfsCredentials = {
    emailEncrypted:
      encrypt(
        normalizedEmail
      ),

    passwordEncrypted:
      encrypt(
        normalizedPassword
      ),

    phoneEncrypted:
      phone
        ? encrypt(
            phone
          )
        : null,

    configuredAt:
      new Date(),

    configuredBy:
      actorId || null
  };

  /*
   * Configurar credenciais NÃO libera
   * a aplicação.
   */

  if (
    control.status ===
    "PAUSED"
  ) {
    control.status =
      "PENDING_REVIEW";
  }

  control.lastAdminAction = {
    action:
      "VFS_CREDENTIALS_CONFIGURED",

    actorId:
      actorId || null,

    at:
      new Date()
  };

  await control.save();

  return serialize(
    control
  );
}


/*
 * ============================================================
 * GUARD DE PROPRIEDADE DA APLICAÇÃO
 * ============================================================
 */

async function assertApplicationAccount(
  applicationId,
  accountId
) {
  const application =
    await Application.findOne({
      _id:
        applicationId,

      accountId
    });

  if (!application) {
    const error =
      new Error(
        "Application not found"
      );

    error.code =
      "APPLICATION_NOT_FOUND";

    error.statusCode =
      404;

    throw error;
  }

  return application;
}


/*
 * ============================================================
 * LIBERAR PARA AUTOMAÇÃO
 * ============================================================
 *
 * IMPORTANTE:
 *
 * Esta função NÃO executa mais
 * ApplicationService.prepare().
 *
 * A responsabilidade desta função é somente:
 *
 * 1. confirmar que a aplicação pertence à conta;
 * 2. confirmar que as credenciais VFS existem;
 * 3. confirmar que passaporte, liveness e preferências
 *    estão prontos;
 * 4. registrar a autorização administrativa.
 *
 * Depois desta função retornar, o fluxo é:
 *
 * ADMIN
 *   ↓
 * RELEASE
 *   ↓
 * SUPERVISOR
 *   ↓
 * BOT 1
 *   ↓
 * VFS
 *
 * Assim o Bot 1 recebe a candidatura ainda em
 * estado "created" e consegue fazer o claim.
 * ============================================================
 */

async function releaseForAutomation({
  applicationId,
  accountId,
  actorId
}) {
  const application =
    await assertApplicationAccount(
      applicationId,
      accountId
    );

  const control =
    await getOrCreate(
      application
    );

  const hasCredentials =
    Boolean(
      control.vfsCredentials &&
      control.vfsCredentials.emailEncrypted &&
      control.vfsCredentials.passwordEncrypted
    );

  if (!hasCredentials) {
    const error =
      new Error(
        "Configure VFS email and password before releasing the application"
      );

    error.code =
      "VFS_CREDENTIALS_REQUIRED";

    error.statusCode =
      400;

    throw error;
  }

  /*
   * ----------------------------------------------------------
   * VALIDAR PRONTIDÃO
   * ----------------------------------------------------------
   *
   * A validação continua sendo feita aqui.
   *
   * O que foi removido é somente a chamada
   * ApplicationService.prepare().
   *
   * Portanto o administrador continua impedido
   * de liberar uma candidatura incompleta.
   */

  const ApplicationService =
    require(
      "../application/application-service"
    );

  const readiness =
    await ApplicationService.validateReadiness(
      application
    );

  if (!readiness.ready) {
    const error =
      new Error(
        readiness.message ||
        "Application is not ready for automation"
      );

    error.code =
      readiness.code ||
      "APPLICATION_NOT_READY";

    error.statusCode =
      400;

    error.details = {
      passportErrors:
        readiness.passportErrors ||
        [],

      facialErrors:
        readiness.facialErrors ||
        [],

      preferenceErrors:
        readiness.preferenceErrors ||
        []
    };

    throw error;
  }

  /*
   * ----------------------------------------------------------
   * IMPORTANTE
   * ----------------------------------------------------------
   *
   * NÃO chamar:
   *
   * ApplicationService.prepare(...)
   *
   * aqui.
   *
   * O Bot 1 precisa ser o responsável pela
   * preparação operacional.
   *
   * A aplicação deve permanecer no estado em
   * que o Bot 1 consegue reivindicá-la.
   */

  const workflowState =
    typeof application.getWorkflowState ===
    "function"
      ? application.getWorkflowState()
      : application.workflowState;

  /*
   * Uma candidatura nova deve continuar
   * disponível para o Bot 1.
   *
   * Se já estiver sendo processada por outro
   * fluxo, não vamos sobrescrever o estado.
   */

  const allowedReleaseStates = [
    "CREATED",
    "created",
    "PASSPORT_PENDING",
    "PASSPORT_VERIFIED",
    "IDENTITY_PREPARATION",
    "IDENTITY_READY",
    "PREFERENCES_PENDING",
    "READY_FOR_AUTOMATION",
    "RADAR_ACTIVE"
  ];

  if (
    workflowState &&
    !allowedReleaseStates.includes(
      workflowState
    )
  ) {
    const error =
      new Error(
        `Application cannot be released from workflow state ${workflowState}`
      );

    error.code =
      "APPLICATION_WORKFLOW_NOT_RELEASEABLE";

    error.statusCode =
      400;

    throw error;
  }

  /*
   * ----------------------------------------------------------
   * LIBERTAÇÃO ADMINISTRATIVA
   * ----------------------------------------------------------
   */

  control.release = {
    enabled:
      true,

    releasedAt:
      new Date(),

    releasedBy:
      actorId || null
  };

  control.status =
    "READY_FOR_AUTOMATION";

  control.lastAdminAction = {
    action:
      "RELEASED_FOR_AUTOMATION",

    actorId:
      actorId || null,

    at:
      new Date()
  };

  await control.save();

  return serialize(
    control
  );
}


/*
 * ============================================================
 * PAUSAR AUTOMAÇÃO
 * ============================================================
 */

async function pauseAutomation({
  applicationId,
  accountId,
  actorId
}) {
  await assertApplicationAccount(
    applicationId,
    accountId
  );

  const control =
    await getByApplicationId(
      applicationId
    );

  if (!control) {
    const error =
      new Error(
        "Administrative control not found"
      );

    error.code =
      "ADMIN_CONTROL_NOT_FOUND";

    error.statusCode =
      404;

    throw error;
  }

  control.release.enabled =
    false;

  control.status =
    "PAUSED";

  control.lastAdminAction = {
    action:
      "AUTOMATION_PAUSED",

    actorId:
      actorId || null,

    at:
      new Date()
  };

  await control.save();

  await Application.updateOne(
    {
      _id:
        applicationId,

      accountId
    },
    {
      $set: {
        "bot2.monitoring":
          false,

        "bot2.status":
          "stopped",

        "radar.enabled":
          false
      }
    }
  );

  return serialize(
    control
  );
}


/*
 * ============================================================
 * GUARD ADMINISTRATIVO
 * ============================================================
 */

async function canAutomate(
  applicationId
) {
  const control =
    await getByApplicationId(
      applicationId
    );

  if (!control) {
    return false;
  }

  const hasCredentials =
    Boolean(
      control.vfsCredentials &&
      control.vfsCredentials.emailEncrypted &&
      control.vfsCredentials.passwordEncrypted
    );

  return Boolean(
    control.release?.enabled &&
    hasCredentials &&
    (
      control.status ===
        "READY_FOR_AUTOMATION" ||

      control.status ===
        "AUTOMATION_ACTIVE"
    )
  );
}


/*
 * ============================================================
 * BARREIRA SERVER-SIDE
 * ============================================================
 */

async function assertAutomationReleased(
  applicationId
) {
  const control =
    await getByApplicationId(
      applicationId
    );

  if (!control) {
    const error =
      new Error(
        "Application is awaiting administrator review"
      );

    error.code =
      "ADMIN_RELEASE_REQUIRED";

    error.statusCode =
      403;

    throw error;
  }

  const hasCredentials =
    Boolean(
      control.vfsCredentials &&
      control.vfsCredentials.emailEncrypted &&
      control.vfsCredentials.passwordEncrypted
    );

  if (!hasCredentials) {
    const error =
      new Error(
        "VFS credentials have not been configured by the administrator"
      );

    error.code =
      "VFS_CREDENTIALS_REQUIRED";

    error.statusCode =
      403;

    throw error;
  }

  if (
    !control.release?.enabled
  ) {
    const error =
      new Error(
        "Application has not been released for automation"
      );

    error.code =
      "ADMIN_RELEASE_REQUIRED";

    error.statusCode =
      403;

    throw error;
  }

  if (
    ![
      "READY_FOR_AUTOMATION",
      "AUTOMATION_ACTIVE"
    ].includes(
      control.status
    )
  ) {
    const error =
      new Error(
        `Application cannot be automated in status ${control.status}`
      );

    error.code =
      "AUTOMATION_NOT_READY";

    error.statusCode =
      403;

    throw error;
  }

  const application =
    await Application.findById(
      applicationId
    );

  if (!application) {
    const error =
      new Error(
        "Application not found"
      );

    error.code =
      "APPLICATION_NOT_FOUND";

    error.statusCode =
      404;

    throw error;
  }

  const workflowState =
    typeof application.getWorkflowState ===
    "function"
      ? application.getWorkflowState()
      : application.workflowState;

  const allowedStates = [
    "READY_FOR_AUTOMATION",

    "VFS_SESSION",
    "VFS_AUTHENTICATING",
    "VFS_AUTHENTICATED",

    "CAPTCHA_REQUIRED",
    "CAPTCHA_PROCESSING",
    "CAPTCHA_COMPLETED",

    "RADAR_ACTIVE",

    "SLOT_FOUND",
    "SLOT_LOCKED",
    "SLOT_REVALIDATED",

    "BOOKING",

    "DOCUMENT_UPLOAD",
    "PASSPORT_UPLOAD_REQUIRED",
    "PASSPORT_UPLOADING",
    "PASSPORT_UPLOADED",

    "FACIAL_SESSION_STARTING",
    "FACIAL_LIVENESS_REQUIRED",
    "FACIAL_LIVENESS_PROCESSING",
    "FACIAL_POSITION_REQUESTED",
    "FACIAL_POSITION_RESOLVING",
    "FACIAL_POSITION_SUBMITTING",
    "FACIAL_POSITIONS",
    "FACIAL_VERIFICATION_COMPLETED",

    "OTP_REQUIRED",
    "OTP_RECEIVING",
    "OTP_RECEIVED",
    "OTP_SUBMITTING",
    "OTP_VERIFIED",

    "REVIEW",

    "APPOINTMENT_BOOKED",

    "PAYMENT_PENDING",
    "PAYMENT_CONFIRMED"
  ];

  if (
    !allowedStates.includes(
      workflowState
    )
  ) {
    const error =
      new Error(
        `Application workflow state ${workflowState || "UNKNOWN"} is not allowed for automation`
      );

    error.code =
      "APPLICATION_WORKFLOW_NOT_AUTOMATABLE";

    error.statusCode =
      403;

    throw error;
  }

  return true;
}


/*
 * ============================================================
 * CREDENCIAIS PARA AUTOMAÇÃO
 * ============================================================
 */

async function getCredentialsForAutomation(
  applicationId
) {
  await assertAutomationReleased(
    applicationId
  );

  const control =
    await getByApplicationId(
      applicationId
    );

  if (!control) {
    const error =
      new Error(
        "Administrative control not found"
      );

    error.code =
      "ADMIN_CONTROL_NOT_FOUND";

    error.statusCode =
      404;

    throw error;
  }

  return {
    email:
      decrypt(
        control.vfsCredentials
          .emailEncrypted
      ),

    password:
      decrypt(
        control.vfsCredentials
          .passwordEncrypted
      ),

    phone:
      control.vfsCredentials
        .phoneEncrypted
        ? decrypt(
            control.vfsCredentials
              .phoneEncrypted
          )
        : null
  };
}


/*
 * ============================================================
 * GUARDAR OBSERVAÇÕES ADMINISTRATIVAS
 * ============================================================
 */

async function updateNotes({
  applicationId,
  accountId,
  notes,
  actorId
}) {
  const application =
    await assertApplicationAccount(
      applicationId,
      accountId
    );

  const control =
    await getOrCreate(
      application
    );

  const normalizedNotes =
    String(
      notes || ""
    )
      .trim()
      .slice(
        0,
        5000
      );

  control.notes =
    normalizedNotes;

  control.lastAdminAction = {
    action:
      "ADMIN_NOTES_UPDATED",

    actorId:
      actorId || null,

    at:
      new Date()
  };

  await control.save();

  return serialize(
    control
  );
}


/*
 * ============================================================
 * MARCAR AUTOMAÇÃO COMO ATIVA
 * ============================================================
 */

async function markAutomationActive(
  applicationId
) {
  const control =
    await getByApplicationId(
      applicationId
    );

  if (!control) {
    return null;
  }

  if (
    control.release?.enabled
  ) {
    control.status =
      "AUTOMATION_ACTIVE";

    control.lastAdminAction = {
      action:
        "AUTOMATION_STARTED",

      actorId:
        null,

      at:
        new Date()
    };

    await control.save();
  }

  return serialize(
    control
  );
}


/*
 * ============================================================
 * MARCAR COMO CONCLUÍDA
 * ============================================================
 */

async function markCompleted(
  applicationId
) {
  const control =
    await getByApplicationId(
      applicationId
    );

  if (!control) {
    return null;
  }

  control.status =
    "COMPLETED";

  control.release.enabled =
    false;

  control.lastAdminAction = {
    action:
      "APPLICATION_COMPLETED",

    actorId:
      null,

    at:
      new Date()
  };

  await control.save();

  await Application.updateOne(
    {
      _id:
        applicationId
    },
    {
      $set: {
        "bot2.monitoring":
          false,

        "bot2.status":
          "stopped",

        "radar.enabled":
          false
      }
    }
  );

  return serialize(
    control
  );
}


module.exports = {
  getOrCreate,

  getByApplicationId,

  assertApplicationAccount,

  configureVfsCredentials,

  releaseForAutomation,

  pauseAutomation,

  canAutomate,

  assertAutomationReleased,

  getCredentialsForAutomation,

  updateNotes,

  markAutomationActive,

  markCompleted,

  serialize
};
