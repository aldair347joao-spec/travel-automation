"use strict";

/*
 * ============================================================
 * TRAVEL AUTOMATION
 * SERVIÇO DE LIVENESS FACIAL
 * ============================================================
 *
 * REGRA PRINCIPAL:
 *
 * 10 posições corretamente concluídas
 * =
 * LIVENESS APROVADA
 *
 * Não existe uma segunda barreira baseada em:
 *
 * - score geral;
 * - média de scores;
 * - comparação facial com passaporte;
 * - captura de fotografia;
 * - reconhecimento facial adicional.
 *
 * O motor facial do cliente é responsável por determinar
 * se cada movimento foi corretamente executado.
 *
 * O backend valida a integridade da sessão recebida e
 * guarda a prova de vida.
 * ============================================================
 */

const REQUIRED_POSITIONS = [
  {
    position: 1,
    label: "frontal",
    instruction:
      "Olhe diretamente para a câmara. Mantenha o rosto centralizado."
  },

  {
    position: 2,
    label: "left",
    instruction:
      "Vire lentamente o rosto para a esquerda."
  },

  {
    position: 3,
    label: "right",
    instruction:
      "Vire lentamente o rosto para a direita."
  },

  {
    position: 4,
    label: "up",
    instruction:
      "Incline lentamente o rosto para cima."
  },

  {
    position: 5,
    label: "down",
    instruction:
      "Incline lentamente o rosto para baixo."
  },

  {
    position: 6,
    label: "left_up",
    instruction:
      "Vire o rosto para a esquerda e ligeiramente para cima."
  },

  {
    position: 7,
    label: "right_up",
    instruction:
      "Vire o rosto para a direita e ligeiramente para cima."
  },

  {
    position: 8,
    label: "left_down",
    instruction:
      "Vire o rosto para a esquerda e ligeiramente para baixo."
  },

  {
    position: 9,
    label: "right_down",
    instruction:
      "Vire o rosto para a direita e ligeiramente para baixo."
  },

  {
    position: 10,
    label: "smile",
    instruction:
      "Volte a olhar para a câmara e sorria naturalmente."
  }
];

/*
 * ============================================================
 * VALORES DE COMPATIBILIDADE
 * ============================================================
 *
 * Mantemos estes exports porque podem existir outros módulos
 * que os importem.
 *
 * IMPORTANTE:
 *
 * Estes valores NÃO são usados como barreira final da sessão.
 *
 * A aprovação depende da conclusão das 10 posições.
 * ============================================================
 */

const MIN_POSITION_SCORE =
  Number(
    process.env.FACIAL_PREFLIGHT_MIN_POSITION_SCORE
  ) || 0.64;

const MIN_OVERALL_SCORE =
  Number(
    process.env.FACIAL_PREFLIGHT_MIN_SCORE
  ) || 0.62;


/*
 * ============================================================
 * UTILITÁRIOS
 * ============================================================
 */

function clampScore(value) {
  const score =
    Number(value);

  if (
    !Number.isFinite(score)
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(
      1,
      score
    )
  );
}


function getExpectedPosition(
  position
) {
  return REQUIRED_POSITIONS.find(
    item =>
      item.position ===
      Number(position)
  );
}


/*
 * ============================================================
 * VALIDAR POSIÇÕES
 * ============================================================
 *
 * Esta função NÃO aplica score mínimo.
 *
 * Ela apenas confirma que o conjunto recebido representa
 * uma sessão completa e coerente de liveness.
 * ============================================================
 */

function validatePositions(
  positions
) {
  const issues = [];

  if (
    !Array.isArray(
      positions
    )
  ) {
    return {
      valid: false,

      issues: [
        "positions must be an array"
      ]
    };
  }


  /*
   * Uma sessão aprovada precisa ter exatamente
   * as dez posições.
   */

  if (
    positions.length !==
    REQUIRED_POSITIONS.length
  ) {
    issues.push(
      `Exactly ${REQUIRED_POSITIONS.length} facial positions are required`
    );
  }


  const seen =
    new Set();


  for (
    const position
    of positions
  ) {

    const number =
      Number(
        position?.position
      );


    const expected =
      getExpectedPosition(
        number
      );


    /*
     * Posição inexistente.
     */

    if (!expected) {

      issues.push(
        `Invalid facial position: ${number}`
      );

      continue;
    }


    /*
     * Posição duplicada.
     */

    if (
      seen.has(
        number
      )
    ) {

      issues.push(
        `Duplicate facial position: ${number}`
      );

      continue;
    }


    seen.add(
      number
    );


    /*
     * Cada posição precisa ter timestamp.
     */

    if (
      !position?.completedAt
    ) {

      issues.push(
        `Position ${number} has no completion timestamp`
      );
    }


    /*
     * O motor facial precisa ter marcado
     * a posição como validada.
     */

    if (
      position?.verified !==
      true
    ) {

      issues.push(
        `Position ${number} was not verified by the facial liveness engine`
      );
    }


    /*
     * É obrigatório existir uma face.
     */

    if (
      position?.faceDetected !==
      true
    ) {

      issues.push(
        `No face detected in position ${number}`
      );
    }


    /*
     * Não podem existir múltiplas faces.
     */

    if (
      position?.singleFace !==
      true
    ) {

      issues.push(
        `Position ${number} must contain exactly one face`
      );
    }


    /*
     * O score continua sendo armazenado para
     * informação/auditoria, mas NÃO bloqueia
     * a aprovação.
     */

    const qualityScore =
      clampScore(
        position?.qualityScore
      );


    const positionScore =
      clampScore(
        position?.positionScore
      );


    const score =
      clampScore(
        position?.score
      );


    if (
      qualityScore === null &&
      positionScore === null &&
      score === null
    ) {

      issues.push(
        `Position ${number} has no valid liveness score`
      );
    }


    /*
     * A décima posição é obrigatoriamente
     * a posição de sorriso.
     */

    if (
      number === 10 &&
      position?.smileDetected !==
        true
    ) {

      issues.push(
        "Position 10 requires a natural smile to be detected"
      );
    }
  }


  /*
   * Confirmar que nenhuma das dez posições
   * ficou de fora.
   */

  for (
    const expected
    of REQUIRED_POSITIONS
  ) {

    if (
      !seen.has(
        expected.position
      )
    ) {

      issues.push(
        `Missing position ${expected.position}: ${expected.label}`
      );
    }
  }


  return {
    valid:
      issues.length === 0,

    issues
  };
}


/*
 * ============================================================
 * SCORE INFORMATIVO
 * ============================================================
 *
 * O score pode continuar a ser calculado e enviado para
 * Administração para informação/auditoria.
 *
 * ELE NÃO DECIDE SE A LIVENESS FOI APROVADA.
 * ============================================================
 */

function calculateAverageScore(
  positions
) {

  if (
    !Array.isArray(
      positions
    )
  ) {
    return 0;
  }


  const scores =
    positions
      .map(
        position => {

          const quality =
            clampScore(
              position?.qualityScore
            );

          if (
            quality !== null
          ) {
            return quality;
          }


          const positionScore =
            clampScore(
              position?.positionScore
            );

          if (
            positionScore !== null
          ) {
            return positionScore;
          }


          return clampScore(
            position?.score
          );
        }
      )
      .filter(
        score =>
          score !== null
      );


  if (
    !scores.length
  ) {
    return 0;
  }


  return (
    scores.reduce(
      (
        total,
        score
      ) =>
        total + score,
      0
    ) /
    scores.length
  );
}


/*
 * ============================================================
 * AVALIAÇÃO FINAL
 * ============================================================
 *
 * REGRA:
 *
 * Consentimento válido
 * +
 * 10 posições completas
 * +
 * todas verificadas
 * +
 * uma única face em cada posição
 * +
 * sorriso na posição 10
 *
 * =
 * LIVENESS APROVADA
 *
 * Não existe segunda barreira de score.
 * ============================================================
 */

function evaluate({
  positions,
  passportMatch = null,
  consentAccepted = false
}) {

  const issues = [];


  /*
   * Consentimento continua sendo obrigatório.
   */

  if (
    consentAccepted !==
    true
  ) {

    issues.push(
      "Biometric consent has not been accepted"
    );
  }


  /*
   * Validar estrutura e integridade
   * das dez posições.
   */

  const positionResult =
    validatePositions(
      positions
    );


  issues.push(
    ...positionResult.issues
  );


  /*
   * Score apenas informativo.
   */

  const averageScore =
    calculateAverageScore(
      positions
    );


  /*
   * Não existe aqui:
   *
   * averageScore < MIN_OVERALL_SCORE
   *
   * nem:
   *
   * positionScore < MIN_POSITION_SCORE
   *
   * porque isso criaria uma segunda barreira
   * depois das dez posições.
   */


  /*
   * ==========================================================
   * IMPORTANTE
   * ==========================================================
   *
   * passportMatch pode continuar a ser recebido para
   * compatibilidade com chamadas antigas.
   *
   * Mas a comparação com passaporte NÃO decide a aprovação
   * da liveness.
   *
   * O passaporte é uma etapa própria do processo.
   */

  void passportMatch;


  /*
   * Localizar a posição 10.
   */

  const smilePosition =
    Array.isArray(
      positions
    )
      ? positions.find(
          position =>
            Number(
              position?.position
            ) === 10
        )
      : null;


  const positionsComplete =
    Array.isArray(
      positions
    ) &&
    positions.length ===
      REQUIRED_POSITIONS.length;


  /*
   * A aprovação depende somente da ausência
   * de problemas estruturais e da conclusão
   * das dez posições.
   */

  const passed =
    positionsComplete &&
    issues.length === 0;


  return {

    passed,

    status:
      passed
        ? "passed"
        : "requires_user",

    score:
      Number(
        averageScore.toFixed(4)
      ),

    /*
     * Mantidos apenas para compatibilidade
     * e informação.
     *
     * Não são usados para bloquear.
     */

    minimumScore:
      MIN_OVERALL_SCORE,

    minimumPositionScore:
      MIN_POSITION_SCORE,

    positionsRequired:
      REQUIRED_POSITIONS.length,

    positionsCompleted:
      Array.isArray(
        positions
      )
        ? positions.length
        : 0,

    smileDetected:
      smilePosition
        ?.smileDetected ===
      true,

    issues,

    checkedAt:
      new Date()
  };
}


/*
 * ============================================================
 * INSTRUÇÕES
 * ============================================================
 */

function getInstructions() {

  return {

    positions:
      REQUIRED_POSITIONS,

    requirements: [

      "Use a well-lit environment",

      "Keep the entire face visible",

      "Do not use sunglasses",

      "Remove masks or objects covering the face",

      "Keep only one face inside the frame",

      "Keep the camera stable",

      "Follow each movement slowly",

      "For position 10, smile naturally while facing the camera",

      "Keep the passport information accurate"
    ]
  };
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {

  REQUIRED_POSITIONS,

  MIN_POSITION_SCORE,

  MIN_OVERALL_SCORE,

  validatePositions,

  calculateAverageScore,

  evaluate,

  getInstructions

};
