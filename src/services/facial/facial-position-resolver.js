"use strict";

/*

* Resolve a descrição textual apresentada pela VFS
* para UMA das posições faciais já armazenadas no Client.
* 
* IMPORTANTE:
* - Não cria posições novas.
* - Não altera as 10 posições existentes.
* - Não assume que a VFS pede 1 -> 10.
* - Não envia imagens.
* - Em caso de ambiguidade, retorna unresolved.
    */

const MAX_POSITIONS = 10;

const STOP_WORDS = new Set([
"a",
"o",
"as",
"os",
"de",
"da",
"do",
"das",
"dos",
"em",
"no",
"na",
"nos",
"nas",
"para",
"por",
"com",
"sem",
"uma",
"um",
"the",
"a",
"an",
"of",
"to",
"in",
"on",
"your",
"please",
"now",
"look",
"camera",
"face",
"facial",
"verification"
]);

/*

* Termos semanticamente equivalentes.
* 
* Não representam posições numeradas.
* São apenas normalizações linguísticas.
  */
  const SYNONYMS = {
  esquerda: [
  "esquerda",
  "lado esquerdo",
  "left",
  "left side"
  ],

direita: [
"direita",
"lado direito",
"right",
"right side"
],

frente: [
"frente",
"frontal",
"olhe em frente",
"olhar em frente",
"straight",
"straight ahead",
"look straight",
"face forward",
"facing forward"
],

cima: [
"cima",
"para cima",
"olhe para cima",
"up",
"upward",
"look up"
],

baixo: [
"baixo",
"para baixo",
"olhe para baixo",
"down",
"downward",
"look down"
],

sorrir: [
"sorriso",
"sorria",
"sorrir",
"smile",
"smiling"
],

boca: [
"boca",
"mouth"
],

olhos: [
"olhos",
"olho",
"eyes",
"eye"
],

perfil: [
"perfil",
"profile",
"side profile"
],

virar: [
"virar",
"vire",
"turn",
"turn your head",
"turn head"
],

inclinar: [
"incline",
"inclinar",
"incline a cabeça",
"tilt",
"tilt your head"
],

cabeça: [
"cabeça",
"head"
]
};

class FacialPositionResolver {
constructor(options = {}) {
this.minimumScore =
Number(
options.minimumScore
) || 0.62;

this.minimumMargin =
  Number(
    options.minimumMargin
  ) || 0.12;

}

/*

* ============================================================
* API PRINCIPAL
* ============================================================
  */

resolve({
request,
positions
}) {
if (
!request ||
!String(request).trim()
) {
return this.unresolved(
"Facial request is empty."
);
}

if (
  !Array.isArray(positions) ||
  positions.length === 0
) {
  return this.unresolved(
    "No stored facial positions are available."
  );
}

if (
  positions.length >
  MAX_POSITIONS
) {
  return this.unresolved(
    "More than 10 facial positions were supplied."
  );
}

const normalizedRequest =
  this.normalize(request);

if (!normalizedRequest) {
  return this.unresolved(
    "Facial request could not be normalized."
  );
}

const candidates =
  positions
    .filter(
      position =>
        position &&
        Number(position.position) >= 1 &&
        Number(position.position) <= MAX_POSITIONS &&
        position.label
    )
    .map(
      position =>
        this.scorePosition(
          normalizedRequest,
          position
        )
    )
    .sort(
      (a, b) =>
        b.score - a.score
    );

if (!candidates.length) {
  return this.unresolved(
    "No valid stored facial positions were found."
  );
}

const best =
  candidates[0];

const second =
  candidates[1] || null;

/*
 * Segurança principal:
 *
 * Uma posição só é escolhida se:
 * 1. tiver score suficiente;
 * 2. estiver suficientemente distante
 *    da segunda candidata.
 */
if (
  best.score <
  this.minimumScore
) {
  return this.unresolved(
    "No stored facial position matched the VFS request with sufficient confidence.",
    candidates
  );
}

if (
  second &&
  (
    best.score -
    second.score
  ) <
  this.minimumMargin
) {
  return this.unresolved(
    "More than one stored facial position matches the VFS request.",
    candidates
  );
}

return {
  resolved: true,
  unresolved: false,

  position:
    Number(
      best.position.position
    ),

  label:
    best.position.label,

  storageReference:
    best.position.storageReference,

  score:
    Number(
      best.score.toFixed(4)
    ),

  matchedTerms:
    best.matchedTerms,

  request:
    String(request).trim(),

  candidates:
    candidates.slice(0, 3)
      .map(
        candidate => ({
          position:
            Number(
              candidate.position.position
            ),

          label:
            candidate.position.label,

          score:
            Number(
              candidate.score.toFixed(4)
            ),

          matchedTerms:
            candidate.matchedTerms
        })
      )
};

}

/*

* ============================================================
* SCORE
* ============================================================
  */

scorePosition(
normalizedRequest,
position
) {
const normalizedLabel =
this.normalize(
position.label
);

const requestTokens =
  this.tokens(
    normalizedRequest
  );

const labelTokens =
  this.tokens(
    normalizedLabel
  );

const requestExpanded =
  this.expandTokens(
    normalizedRequest
  );

const labelExpanded =
  this.expandTokens(
    normalizedLabel
  );

const matchedTerms = [];

/*
 * Correspondência exata da descrição.
 */
if (
  normalizedRequest ===
  normalizedLabel
) {
  return {
    position,
    score: 1,
    matchedTerms: [
      "exact_label"
    ]
  };
}

/*
 * Uma descrição contém diretamente
 * a etiqueta armazenada.
 */
if (
  normalizedRequest.includes(
    normalizedLabel
  ) ||
  normalizedLabel.includes(
    normalizedRequest
  )
) {
  matchedTerms.push(
    "direct_label_match"
  );
}

/*
 * Tokens comuns.
 */
const common =
  requestExpanded.filter(
    token =>
      labelExpanded.includes(
        token
      )
  );

for (
  const token of common
) {
  if (
    !matchedTerms.includes(
      token
    )
  ) {
    matchedTerms.push(
      token
    );
  }
}

const uniqueCommon =
  [
    ...new Set(
      common
    )
  ];

const tokenScore =
  this.calculateTokenScore(
    requestTokens,
    labelTokens
  );

const semanticScore =
  this.calculateSemanticScore(
    normalizedRequest,
    normalizedLabel
  );

let score =
  (
    tokenScore * 0.40
  ) +
  (
    semanticScore * 0.60
  );

if (
  matchedTerms.includes(
    "direct_label_match"
  )
) {
  score += 0.18;
}

if (
  uniqueCommon.length >= 2
) {
  score += 0.10;
}

score =
  Math.min(
    1,
    score
  );

return {
  position,
  score,
  matchedTerms
};

}

calculateTokenScore(
requestTokens,
labelTokens
) {
if (
!requestTokens.length ||
!labelTokens.length
) {
return 0;
}

const common =
  requestTokens.filter(
    token =>
      labelTokens.includes(
        token
      )
  );

return (
  common.length /
  Math.max(
    requestTokens.length,
    labelTokens.length
  )
);

}

calculateSemanticScore(
request,
label
) {
if (
request === label
) {
return 1;
}

const requestGroups =
  this.semanticGroups(
    request
  );

const labelGroups =
  this.semanticGroups(
    label
  );

if (
  !requestGroups.length ||
  !labelGroups.length
) {
  return 0;
}

let matches = 0;

for (
  const requestGroup of
  requestGroups
) {
  if (
    labelGroups.includes(
      requestGroup
    )
  ) {
    matches++;
  }
}

return (
  matches /
  Math.max(
    requestGroups.length,
    labelGroups.length
  )
);

}

semanticGroups(
text
) {
const normalized =
this.normalize(
text
);

const groups = [];

for (
  const [group, terms] of
  Object.entries(
    SYNONYMS
  )
) {
  if (
    terms.some(
      term =>
        normalized.includes(
          this.normalize(
            term
          )
        )
    )
  ) {
    groups.push(
      group
    );
  }
}

return groups;

}

/*

* ============================================================
* NORMALIZATION
* ============================================================
  */

normalize(value) {
return String(
value || ""
)
.normalize("NFD")
.replace(
/[\u0300-\u036f]/g,
""
)
.toLowerCase()
.replace(
/[^a-z0-9\s]/g,
" "
)
.replace(
/\s+/g,
" "
)
.trim();
}

tokens(value) {
return this.normalize(
value
)
.split(" ")
.filter(
token =>
token.length > 1 &&
!STOP_WORDS.has(
token
)
);
}

expandTokens(value) {
const tokens =
this.tokens(
value
);

const expanded = [
  ...tokens
];

for (
  const [group, terms] of
  Object.entries(
    SYNONYMS
  )
) {
  const normalizedTerms =
    terms.map(
      term =>
        this.normalize(
          term
        )
    );

  const found =
    normalizedTerms.some(
      term =>
        this.normalize(
          value
        ).includes(
          term
        )
    );

  if (found) {
    expanded.push(
      group
    );
  }
}

return [
  ...new Set(
    expanded
  )
];

}

/*

* ============================================================
* UNRESOLVED
* ============================================================
  */

unresolved(
reason,
candidates = []
) {
return {
resolved: false,
unresolved: true,

  reason,

  candidates:
    candidates
      .slice(0, 5)
      .map(
        candidate => ({
          position:
            Number(
              candidate.position.position
            ),

          label:
            candidate.position.label,

          score:
            Number(
              candidate.score.toFixed(4)
            ),

          matchedTerms:
            candidate.matchedTerms
        })
      )
};

}
}

module.exports =
FacialPositionResolver;
