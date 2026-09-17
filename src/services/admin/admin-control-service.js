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
      control.lastAdminAction || null,

    notes:
      control.notes || "",

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


async function configureVfsCredentials({
  applicationId,
  email,
  password,
  actorId
}) {
  const normalizedEmail =
    cleanText(email);

  const normalizedPassword =
    String(password || "");

  if (!normalizedEmail) {
    throw new Error(
      "VFS email is required"
    );
  }

  if (!normalizedPassword) {
    throw new Error(
      "VFS password is required"
    );
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

    error.statusCode = 404;

    throw error;
  }

  let control =
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

    configuredAt:
      new Date(),

    configuredBy:
      actorId || null
  };

  /*
   * Configurar as credenciais NÃO libera
   * automaticamente o processo.
   *
   * A libertação é uma ação separada
   * do administrador.
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

    error.statusCode = 404;

    throw error;
  }

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

    error.statusCode = 400;

    throw error;
  }

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

    error.statusCode = 404;

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

  return true;
}


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

    await control.save();
  }

  return serialize(
    control
  );
}


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
