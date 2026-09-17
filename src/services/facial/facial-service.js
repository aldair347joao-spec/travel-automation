"use strict";

const FacialPositionResolver =
require("./facial-position-resolver");

class FacialService {
constructor() {
this.provider =
process.env.FACIAL_PROVIDER ||
null;

this.apiUrl =
  process.env.FACIAL_API_URL ||
  null;

this.apiKey =
  process.env.FACIAL_API_KEY ||
  null;

this.enabled =
  process.env.BIOID_ENABLED === "true" ||
  process.env.FACIAL_ENABLED === "true";

this.testMode =
  process.env.FACIAL_TEST_MODE === "true";

this.positionResolver =
  new FacialPositionResolver({
    minimumScore:
      Number(
        process.env.FACIAL_POSITION_MIN_SCORE
      ) || 0.62,

    minimumMargin:
      Number(
        process.env.FACIAL_POSITION_MIN_MARGIN
      ) || 0.12
  });

}

isConfigured() {
return Boolean(
this.provider &&
this.apiUrl &&
this.apiKey
);
}

validatePositions(positions) {
if (!Array.isArray(positions)) {
throw new Error(
"Facial positions must be an array"
);
}

if (positions.length === 0) {
  throw new Error(
    "At least one facial position is required"
  );
}

if (positions.length > 10) {
  throw new Error(
    "Maximum of 10 facial positions"
  );
}

for (const position of positions) {
  const number =
    Number(position?.position);

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 10
  ) {
    throw new Error(
      "Facial positions must use position numbers from 1 to 10"
    );
  }

  if (
    !position?.label ||
    !String(position.label).trim()
  ) {
    throw new Error(
      "Each facial position requires a label"
    );
  }

  if (
    !position?.storageReference ||
    !String(position.storageReference).trim()
  ) {
    throw new Error(
      "Each facial position requires a storage reference"
    );
  }
}

return true;

}

/**

* Resolve a descrição apresentada pela VFS
* contra as posições já armazenadas do cliente.
* 
* Este método NÃO:
* - cria novas posições;
* - altera as 10 posições;
* - simula liveness;
* - envia imagens;
* - contorna mecanismos de segurança.
* 
* Apenas identifica a posição armazenada
* correspondente e devolve a sua referência.
  */
  resolvePositionRequest({
  request,
  positions
  }) {
  this.validatePositions(
  positions
  );

return this.positionResolver.resolve({
  request,
  positions
});

}

async createProfile({
clientId,
positions,
videoReference
}) {
if (!clientId) {
throw new Error(
"clientId required"
);
}

this.validatePositions(
  positions
);

return {
  success: true,

  clientId,

  provider:
    this.provider ||
    "pending",

  positions:
    positions.length,

  videoReference:
    videoReference ||
    null,

  status:
    this.isConfigured()
      ? "pending_provider"
      : "pending_provider_configuration"
};

}

async verify({
clientId,
templateReference
}) {
if (!clientId) {
throw new Error(
"clientId required"
);
}

if (!templateReference) {
  throw new Error(
    "Facial template reference required"
  );
}

if (this.testMode) {
  return {
    success: true,
    verified: true,
    clientId,
    templateReference,
    provider:
      this.provider ||
      "test",
    status: "verified"
  };
}

if (!this.enabled) {
  throw new Error(
    "Facial verification is disabled"
  );
}

if (!this.isConfigured()) {
  throw new Error(
    "Facial provider is not configured"
  );
}

throw new Error(
  `Facial provider adapter not implemented: ${this.provider}`
);

}
}

module.exports =
FacialService;
