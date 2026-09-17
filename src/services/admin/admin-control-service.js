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


async function getOrCreate(
  application
) {
  let control =
    await ApplicationAdminControl.findOne(
      {
        applicationId:
          application._id
      }
    );

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
 * Nunca ficam em:
 * - frontend
 * - localStorage
 * - sessionStorage
 * - resposta da API
 * - variáveis globais do VFS
 *
 * São guardadas encriptadas através do
 * DATA_ENCRYPTION_KEY existente.
 */

async function configureVfsCredentials({
  applicationId,
  email,
  password,
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


  let control =
    await getOrCreate(
      application
    );


  /*
   * Guardamos apenas os valores
   * encriptados.
   */

  control.vfsCredentials = {
    emailEncrypted:
      encrypt(
        normalizedEmail
      ),

    passwordEncrypted:
      encrypt(
        normalizedPassword
      ),

    configuredAt:
      new Date(),

    configuredBy:
      actorId || null
  };


  /*
   * Configurar credenciais NÃO libera
   * a aplicação.
   *
   * O administrador ainda precisa
   * executar explicitamente:
   *
   * LIBERAR PARA AUTOMAÇÃO
   */

  if (
    control.status ===
    "PENDING_REVIEW"
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
 * LIBERAR PARA AUTOMAÇÃO
 * ============================================================
 *
 * Esta é a barreira administrativa principal.
 *
 * A aplicação só é liberada se:
 *
 * 1. existir;
 * 2. estiver pronta;
 * 3. tiver passaporte válido;
 * 4. tiver as 10 posições faciais;
 * 5. tiver preferências completas;
 * 6. tiver credenciais VFS configuradas;
 * 7. o administrador executar esta ação.
 */

async function releaseForAutomation({
  applicationId,
  actorId
}) {

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


  let control =
    await getOrCreate(
      application
    );


  /*
   * ----------------------------------------------------------
   * CREDENCIAIS
   * ----------------------------------------------------------
   */

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
   * PREPARAÇÃO / READINESS
   * ----------------------------------------------------------
   *
   * Não basta existir o botão.
   * O backend verifica novamente os dados.
   *
   * Isso impede que alguém chame diretamente
   * a API de release ignorando o frontend.
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
   * PREPARAR WORKFLOW
   * ----------------------------------------------------------
   *
   * A aplicação pode ter sido criada em CREATED.
   *
   * Antes desta alteração, o AdminControl podia ficar
   * READY_FOR_AUTOMATION enquanto a Application continuava
   * em CREATED.
   *
   * Isso deixava as duas fontes de estado incompatíveis.
   *
   * Agora usamos o ApplicationService para levar a aplicação
   * ao estado READY_FOR_AUTOMATION antes de liberar.
   */

  const prepared =
    await ApplicationService.prepare(
      application._id,
      application.accountId
    );


  /*
   * prepare() pode devolver um objeto indicando que
   * a aplicação ainda não ficou pronta.
   */

  if (
    prepared &&
    prepared.ready === false
  ) {

    const error =
      new Error(
        prepared.message ||
        "Application could not be prepared for automation"
      );

    error.code =
      prepared.code ||
      "APPLICATION_NOT_READY";

    error.statusCode =
      400;

    error.details = {
      passportErrors:
        prepared.passportErrors ||
        [],

      facialErrors:
        prepared.facialErrors ||
        [],

      preferenceErrors:
        prepared.preferenceErrors ||
        []
    };

    throw error;
  }


  /*
   * Recarregamos a aplicação depois da preparação
   * para confirmar o estado persistido.
   */

  const refreshedApplication =
    await Application.findById(
      applicationId
    );


  if (!refreshedApplication) {
    const error =
      new Error(
        "Application disappeared during preparation"
      );

    error.code =
      "APPLICATION_PREPARATION_FAILED";

    error.statusCode =
      500;

    throw error;
  }


  const workflowState =
    typeof refreshedApplication.getWorkflowState ===
    "function"
      ? refreshedApplication.getWorkflowState()
      : refreshedApplication.workflowState;


  /*
   * A libertação administrativa só pode ocorrer quando
   * o workflow também estiver pronto.
   */

  if (
    workflowState !==
    "READY_FOR_AUTOMATION"
  ) {

    const error =
      new Error(
        `Application preparation finished in state ${workflowState || "UNKNOWN"} instead of READY_FOR_AUTOMATION`
      );

    error.code =
      "APPLICATION_WORKFLOW_NOT_READY";

    error.statusCode =
      400;

    throw error;
  }


  /*
   * ----------------------------------------------------------
   * LIBERTAÇÃO
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
  actorId
}) {

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


  return serialize(
    control
  );
}


/*
 * ============================================================
 * VERIFICAR SE PODE AUTOMATIZAR
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
 *
 * Esta função deve ser chamada pelos bots e serviços internos.
 *
 * Não depende do frontend.
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


  /*
   * Segunda barreira:
   * a aplicação também precisa estar no estado
   * correto do workflow.
   */

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
 * OBTER CREDENCIAIS PARA AUTOMAÇÃO
 * ============================================================
 *
 * O email/password só são desencriptados no backend,
 * imediatamente antes de serem utilizados pelo adapter.
 *
 * Nunca são devolvidos ao frontend.
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
      )
  };
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


  return serialize(
    control
  );
}


module.exports = {
  getOrCreate,

  getByApplicationId,

  configureVfsCredentials,

  releaseForAutomation,

  pauseAutomation,

  canAutomate,

  assertAutomationReleased,

  getCredentialsForAutomation,

  markAutomationActive,

  markCompleted,

  serialize
};
