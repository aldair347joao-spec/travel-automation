const express =
require("express");

const Client =
require("../models/client");

const AuditLog =
require("../models/audit-log");

const {
requireAuth,
requireRole
} =
require("../middleware/auth");

const PassportStorageService =
require("../services/passport/passport-storage-service");

const passportStorage =
new PassportStorageService();

const FacialService =
require("../services/facial/facial-service");

const preflight =
require("../services/facial/preflight-service");

const router =
express.Router();

const facial =
new FacialService();

router.use(
requireAuth
);

/*

* =========================================================
* ACCESS HELPERS
* =========================================================
* 
* IMPORTANTE:
* 
* role "client" NÃO representa um único viajante.
* 
* Um utilizador "client" é um colaborador de uma conta
* e pode criar/gerir vários documentos Client.
* 
* A separação é feita por:
* 
* accountId
* + 
* createdBy
* 
* Portanto:
* 
* colaborador A
* -> vários Client
* 
* colaborador B
* -> vários Client
* 
* e nenhum deles pode entrar nos Client do outro.
  */

function isClientUser(req) {
return (
req.user &&
req.user.role === "client"
);
}

function isAdministrativeUser(req) {
return (
req.user &&
[
"owner",
"admin",
"operator",
"viewer"
].includes(
req.user.role
)
);
}

function clientOwnershipQuery(
req
) {
const query = {
accountId:
req.user.accountId
};

if (
isClientUser(req)
) {
query.createdBy =
req.user._id;
}

return query;
}

async function findAccessibleClient(
req,
clientId,
options = {}
) {
const query = {
_id:
clientId,

...clientOwnershipQuery(
  req
)

};

if (
options.activeOnly
) {
query.active =
true;
}

return Client.findOne(
query
);
}

/*

* =========================================================
* CREATE CLIENT
* =========================================================
* 
* owner/admin/operator:
* podem criar Client.
* 
* client:
* também pode criar Client.
* 
* viewer:
* não pode criar.
  */

router.post(
"/",
requireRole(
"owner",
"admin",
"operator",
"client"
),
async (
req,
res,
next
) => {
try {
const {
fullName,
email,
phone,
dateOfBirth,
nationality,
gender,
passportNumber,
passportIssueDate,
passportExpiryDate,
passportCountry,
passportType
} =
req.body;

  if (
    !fullName ||
    !String(
      fullName
    ).trim()
  ) {
    return res
      .status(400)
      .json({
        success: false,

        error:
          "Full name is required"
      });
  }

  if (
    !email ||
    !String(
      email
    ).trim()
  ) {
    return res
      .status(400)
      .json({
        success: false,

        error:
          "Email is required"
      });
  }

  const client =
    await Client.create({
      accountId:
        req.user.accountId,

      /*
       * O utilizador que criou o viajante fica
       * registado aqui.
       *
       * Para role "client", isto é o que permite
       * posteriormente gerir vários Client sem
       * limitar a conta a um único viajante.
       */
      createdBy:
        req.user._id,

      fullName:
        String(
          fullName
        )
          .trim()
          .slice(
            0,
            160
          ),

      email:
        String(
          email
        )
          .trim()
          .toLowerCase()
          .slice(
            0,
            254
          ),

      phone:
        phone ||
        null,

      dateOfBirth:
        dateOfBirth ||
        null,

      nationality:
        nationality ||
        null,

      gender:
        gender ||
        null,

      passportNumber:
        passportNumber ||
        null,

      passportIssueDate:
        passportIssueDate ||
        null,

      passportExpiryDate:
        passportExpiryDate ||
        null,

      passportCountry:
        passportCountry ||
        null,

      passportType:
        [
          "legacy",
          "electronic",
          "unknown"
        ].includes(
          passportType
        )
          ? passportType
          : "unknown"
    });

  await AuditLog.create({
    actorId:
      req.user._id,

    action:
      "client.create",

    resource:
      "client",

    resourceId:
      client._id.toString(),

    ip:
      req.ip
  });

  return res
    .status(201)
    .json({
      success: true,

      client
    });
} catch (
  error
) {
  next(error);
}

}
);

/*

* =========================================================
* LIST CLIENTS
* =========================================================
* 
* owner/admin/operator/viewer:
* vêem os Client activos da própria conta.
* 
* client:
* vê apenas os Client criados pela própria conta
* colaboradora.
* 
* Um client pode ter dezenas, centenas ou mais Client.
  */

router.get(
"/",
async (
req,
res,
next
) => {
try {
const query =
clientOwnershipQuery(
req
);

  query.active =
    true;

  const clients =
    await Client.find(
      query
    )
      .sort({
        createdAt:
          -1
      })
      .limit(200);

  return res.json({
    success: true,

    clients
  });
} catch (
  error
) {
  next(error);
}

}
);

/*

* =========================================================
* GET CLIENT
* =========================================================
* 
* owner/admin/operator/viewer:
* qualquer Client da própria conta.
* 
* client:
* somente Client criado pelo próprio colaborador.
  */

router.get(
"/:id",
async (
req,
res,
next
) => {
try {
const client =
await findAccessibleClient(
req,
req.params.id
);

  if (!client) {
    return res
      .status(404)
      .json({
        success: false,

        error:
          "Client not found"
      });
  }

  return res.json({
    success: true,

    client
  });
} catch (
  error
) {
  next(error);
}

}
);

/*

* =========================================================
* UPDATE CLIENT
* =========================================================
* 
* owner/admin/operator:
* podem atualizar qualquer Client da conta.
* 
* client:
* pode actualizar qualquer Client criado por si.
* 
* viewer:
* não pode actualizar.
  */

router.patch(
"/:id",
requireRole(
"owner",
"admin",
"operator",
"client"
),
async (
req,
res,
next
) => {
try {
const allowed =
[
"fullName",
"email",
"phone",
"dateOfBirth",
"nationality",
"gender",
"passportNumber",
"passportIssueDate",
"passportExpiryDate",
"passportCountry",
"passportType"
];

  const update = {};

  for (
    const field
    of allowed
  ) {
    if (
      req.body[field] !==
      undefined
    ) {
      update[field] =
        req.body[field];
    }
  }

  if (
    update.email !==
    undefined
  ) {
    update.email =
      String(
        update.email
      )
        .trim()
        .toLowerCase()
        .slice(
          0,
          254
        );
  }

  if (
    update.fullName !==
    undefined
  ) {
    update.fullName =
      String(
        update.fullName
      )
        .trim()
        .slice(
          0,
          160
        );
  }

  if (
    update.passportType !==
    undefined
  ) {
    if (
      ![
        "legacy",
        "electronic",
        "unknown"
      ].includes(
        update.passportType
      )
    ) {
      return res
        .status(400)
        .json({
          success: false,

          error:
            "Invalid passport type"
        });
    }
  }

  /*
   * accountId, createdBy e active nunca podem ser
   * alterados pelo body.
   */

  delete update.accountId;
  delete update.createdBy;
  delete update.active;

  const client =
    await Client.findOneAndUpdate(
      {
        _id:
          req.params.id,

        ...clientOwnershipQuery(
          req
        )
      },

      {
        $set:
          update
      },

      {
        new: true,

        runValidators:
          true
      }
    );

  if (!client) {
    return res
      .status(404)
      .json({
        success: false,

        error:
          "Client not found"
      });
  }

  await AuditLog.create({
    actorId:
      req.user._id,

    action:
      "client.update",

    resource:
      "client",

    resourceId:
      client._id.toString(),

    ip:
      req.ip
  });

  return res.json({
    success: true,

    client
  });
} catch (
  error
) {
  next(error);
}

}
);

/*

* =========================================================
* SAVE OFFICIAL FACIAL PROFILE
* =========================================================
* 
* owner/admin/operator:
* podem concluir o perfil oficial.
* 
* client:
* pode enviar o perfil facial do viajante que criou.
* 
* viewer:
* não pode.
  */

router.post(
"/:id/facial-profile",
requireRole(
"owner",
"admin",
"operator",
"client"
),
async (
req,
res,
next
) => {
try {
const {
consentAccepted,
positions,
videoReference,
templateReference
} =
req.body;

  if (
    consentAccepted !==
    true
  ) {
    return res
      .status(400)
      .json({
        success: false,

        error:
          "Biometric consent is required"
      });
  }

  if (
    !Array.isArray(
      positions
    )
  ) {
    return res
      .status(400)
      .json({
        success: false,

        error:
          "Facial positions are required"
      });
  }

  facial.validatePositions(
    positions
  );

  if (
    positions.some(
      position =>
        !position ||
        !position.storageReference ||
        String(
          position.storageReference
        ).startsWith(
          "data:"
        )
    )
  ) {
    return res
      .status(400)
      .json({
        success: false,

        error:
          "Facial media must use secure storage references"
      });
  }

  const client =
    await findAccessibleClient(
      req,
      req.params.id,
      {
        activeOnly:
          true
      }
    );

  if (!client) {
    return res
      .status(404)
      .json({
        success: false,

        error:
          "Client not found"
      });
  }

  const profile =
    await facial.createProfile({
      clientId:
        client._id,

      positions,

      videoReference
    });

  client.facialConsent =
    {
      accepted:
        true,

      acceptedAt:
        new Date()
    };

  client.facialProfile =
    {
      provider:
        profile.provider,

      templateReference:
        templateReference ||
        null,

      positions,

      videoReference:
        videoReference ||
        null,

      verificationStatus:
        "pending"
    };

  await client.save();

  await AuditLog.create({
    actorId:
      req.user._id,

    action:
      "client.facial_profile",

    resource:
      "client",

    resourceId:
      client._id.toString(),

    ip:
      req.ip,

    metadata: {
      positions:
        positions.length
    }
  });

  return res.json({
    success: true,

    status:
      "pending",

    positions:
      positions.length
  });
} catch (
  error
) {
  next(error);
}

}
);

/*

* =========================================================
* GET PASSPORT IMAGE FOR LOCAL FACIAL MATCH
* =========================================================
* 
* O cliente pode consultar a imagem do passaporte
* validado dos viajantes que criou.
  */

router.get(
"/:id/facial-preflight/passport-image",
requireRole(
"owner",
"admin",
"operator",
"client"
),
async (
req,
res,
next
) => {
try {
const client =
await findAccessibleClient(
req,
req.params.id,
{
activeOnly:
true
}
);

  if (!client) {
    return res
      .status(404)
      .json({
        success: false,

        error:
          "Client not found"
      });
  }

  const document =
    await passportStorage.getForBot({
      accountId:
        req.user.accountId,

      clientId:
        client._id
    });

  if (!document) {
    return res
      .status(404)
      .json({
        success: false,

        error:
          "No validated passport image is available for this client"
      });
  }

  const allowedMimeTypes =
    [
      "image/jpeg",
      "image/png"
    ];

  const mimeType =
    allowedMimeTypes.includes(
      document.mimeType
    )
      ? document.mimeType
      : "image/jpeg";

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );

  res.setHeader(
    "Pragma",
    "no-cache"
  );

  res.setHeader(
    "Expires",
    "0"
  );

  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  res.setHeader(
    "Content-Type",
    mimeType
  );

  res.setHeader(
    "Content-Disposition",
    "inline"
  );

  return res.end(
    document.buffer
  );
} catch (
  error
) {
  next(error);
}

}
);

/*

* =========================================================
* FACIAL PREFLIGHT INSTRUCTIONS
* =========================================================
  */

router.get(
"/:id/facial-preflight/instructions",
requireRole(
"owner",
"admin",
"operator",
"client"
),
async (
req,
res,
next
) => {
try {
const client =
await findAccessibleClient(
req,
req.params.id,
{
activeOnly:
true
}
);

  if (!client) {
    return res
      .status(404)
      .json({
        success: false,

        error:
          "Client not found"
      });
  }

  return res.json({
    success: true,

    clientId:
      client._id,

    instructions:
      preflight.getInstructions(),

    preflightStatus:
      client
        .facialPreflight
        ?.status ||
      "not_started"
  });
} catch (
  error
) {
  next(error);
}

}
);

/*

* =========================================================
* FACIAL PREFLIGHT EVALUATION
* =========================================================
  */

router.post(
"/:id/facial-preflight",
requireRole(
"owner",
"admin",
"operator",
"client"
),
async (
req,
res,
next
) => {
try {
const client =
await findAccessibleClient(
req,
req.params.id,
{
activeOnly:
true
}
);

  if (!client) {
    return res
      .status(404)
      .json({
        success: false,

        error:
          "Client not found"
      });
  }

  const {
    consentAccepted,
    positions,
    passportMatch
  } =
    req.body;

  const result =
    preflight.evaluate({
      positions,

      passportMatch,

      consentAccepted
    });

  client.facialConsent =
    {
      accepted:
        consentAccepted ===
        true,

      acceptedAt:
        consentAccepted ===
        true
          ? new Date()
          : client
              .facialConsent
              ?.acceptedAt ||
            null
    };

  client.facialPreflight =
    {
      status:
        result.passed
          ? "passed"
          : "requires_user",

      score:
        result.score,

      minimumScore:
        result.minimumScore,

      minimumPositionScore:
        result.minimumPositionScore,

      positionsCompleted:
        result.positionsCompleted,

      positionsRequired:
        result.positionsRequired,

      smileDetected:
        result.smileDetected,

      passportMatch:
        {
          name:
            passportMatch?.name ??
            null,

          dateOfBirth:
            passportMatch
              ?.dateOfBirth ??
            null,

          passportNumber:
            passportMatch
              ?.passportNumber ??
            null,

          nationality:
            passportMatch
              ?.nationality ??
            null
        },

      issues:
        result.issues,

      checkedAt:
        result.checkedAt,

      consentAcceptedAt:
        consentAccepted ===
        true
          ? new Date()
          : client
              .facialPreflight
              ?.consentAcceptedAt ||
            null
    };

  /*
   * O preflight não significa que a verificação
   * oficial VFS foi concluída.
   */

  await client.save();

  await AuditLog.create({
    actorId:
      req.user._id,

    action:
      "client.facial_preflight",

    resource:
      "client",

    resourceId:
      client._id.toString(),

    ip:
      req.ip,

    metadata: {
      passed:
        result.passed,

      score:
        result.score,

      positionsCompleted:
        result.positionsCompleted,

      positionsRequired:
        result.positionsRequired,

      smileDetected:
        result.smileDetected,

      issues:
        result.issues
    }
  });

  return res.json({
    success: true,

    clientId:
      client._id,

    preflight:
      result,

    vfsVerification:
      "not_completed"
  });
} catch (
  error
) {
  next(error);
}

}
);

/*

* =========================================================
* DELETE / DEACTIVATE CLIENT
* =========================================================
* 
* Apenas owner/admin.
* 
* Um colaborador "client" não pode apagar/deactivar
* directamente os viajantes enviados para administração.
  */

router.delete(
"/:id",
requireRole(
"owner",
"admin"
),
async (
req,
res,
next
) => {
try {
const client =
await Client.findOneAndUpdate(
{
_id:
req.params.id,

        accountId:
          req.user.accountId
      },

      {
        $set: {
          active:
            false
        }
      },

      {
        new: true
      }
    );

  if (!client) {
    return res
      .status(404)
      .json({
        success: false,

        error:
          "Client not found"
      });
  }

  await AuditLog.create({
    actorId:
      req.user._id,

    action:
      "client.deactivate",

    resource:
      "client",

    resourceId:
      client._id.toString(),

    ip:
      req.ip
  });

  return res.json({
    success: true
  });
} catch (
  error
) {
  next(error);
}

}
);

module.exports =
router;
