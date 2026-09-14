const Tesseract = require("tesseract.js");

const MAX_IMAGE_BYTES =
  8 * 1024 * 1024;

const DEFAULT_LANGUAGE =
  process.env.OCR_LANGUAGE || "eng";

function normalizeOcrLine(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[«»‹›≤≥]/g, "<")
    .replace(/[—–−_]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[^A-Z0-9< ]/g, "")
    .trim();
}

function compactMrzCandidate(value) {
  return normalizeOcrLine(value)
    .replace(/\s+/g, "")
    .replace(/-/g, "<");
}

function scoreMrzCandidate(line) {
  if (!line) {
    return -1;
  }

  let score = 0;

  if (line.length >= 40) {
    score += 2;
  }

  if (line.length >= 44) {
    score += 4;
  }

  if (line[0] === "P") {
    score += 6;
  }

  if (line[1] === "<") {
    score += 3;
  }

  if (/^[A-Z0-9<]+$/.test(line)) {
    score += 2;
  }

  if (/[0-9]/.test(line)) {
    score += 1;
  }

  if (/<{2,}/.test(line)) {
    score += 1;
  }

  return score;
}

function generateCandidates(text) {
  const rawLines =
    String(text || "")
      .split(/\r?\n/)
      .map(normalizeOcrLine)
      .filter(Boolean);

  const candidates = [];

  for (const line of rawLines) {
    const compact =
      compactMrzCandidate(line);

    if (compact.length >= 40) {
      candidates.push(compact);
    }
  }

  /*
   * OCR pode dividir uma linha MRZ
   * em duas linhas visuais.
   */
  for (
    let i = 0;
    i < rawLines.length - 1;
    i += 1
  ) {
    const joined =
      compactMrzCandidate(
        `${rawLines[i]} ${rawLines[i + 1]}`
      );

    if (joined.length >= 40) {
      candidates.push(joined);
    }
  }

  return [
    ...new Set(candidates)
  ].sort(
    (a, b) =>
      scoreMrzCandidate(b) -
      scoreMrzCandidate(a)
  );
}

function normalizeTo44(value) {
  if (!value) {
    return null;
  }

  const line =
    compactMrzCandidate(value);

  if (line.length === 44) {
    return line;
  }

  /*
   * Só fazemos trimming quando a linha
   * já está muito próxima dos 44 caracteres.
   *
   * Nunca inventamos caracteres ausentes.
   */
  if (
    line.length > 44 &&
    line.length <= 47
  ) {
    const firstP =
      line.indexOf("P");

    if (
      firstP >= 0 &&
      firstP <= 2
    ) {
      const trimmed =
        line.slice(
          firstP,
          firstP + 44
        );

      if (
        trimmed.length === 44
      ) {
        return trimmed;
      }
    }
  }

  return null;
}

function findMrzLines(text) {
  const candidates =
    generateCandidates(text);

  const normalized =
    candidates
      .map(normalizeTo44)
      .filter(Boolean);

  const unique = [
    ...new Set(normalized)
  ];

  const firstLines =
    unique.filter(
      line =>
        line.startsWith("P")
    );

  const secondLines =
    unique.filter(
      line =>
        !line.startsWith("P")
    );

  const pairs = [];

  for (
    const line1 of firstLines
  ) {
    for (
      const line2 of secondLines
    ) {
      pairs.push({
        line1,
        line2,

        score:
          scoreMrzCandidate(line1) +
          scoreMrzCandidate(line2)
      });
    }
  }

  pairs.sort(
    (a, b) =>
      b.score - a.score
  );

  return {
    candidates: unique,
    pairs
  };
}

function extractOcrFields(text) {
  const lines =
    String(text || "")
      .split(/\r?\n/)
      .map(normalizeOcrLine)
      .filter(Boolean);

  return {
    rawLines: lines,

    text:
      lines.join(" ")
  };
}

class PassportOcrService {
  constructor(options = {}) {
    this.language =
      options.language ||
      DEFAULT_LANGUAGE;

    this.logger =
      options.logger ||
      null;
  }

  async recognize(buffer) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError(
        "Passport image must be provided as a Buffer"
      );
    }

    if (buffer.length === 0) {
      throw new Error(
        "Passport image is empty"
      );
    }

    if (
      buffer.length >
      MAX_IMAGE_BYTES
    ) {
      throw new Error(
        "Passport image exceeds the 8 MB limit"
      );
    }

    const result =
      await Tesseract.recognize(
        buffer,
        this.language,
        {
          logger: message => {
            if (this.logger) {
              this.logger(message);
            }
          }
        }
      );

    const text =
      result?.data?.text ||
      "";

    const confidence =
      Number.isFinite(
        result?.data?.confidence
      )
        ? result.data.confidence
        : null;

    const fields =
      extractOcrFields(text);

    const mrz =
      findMrzLines(text);

    return {
      text,

      confidence,

      lines:
        fields.rawLines,

      mrzCandidates:
        mrz.candidates,

      mrzPairs:
        mrz.pairs
    };
  }

  async extract(buffer) {
    const result =
      await this.recognize(
        buffer
      );

    const bestPair =
      result.mrzPairs[0] ||
      null;

    return {
      ...result,

      mrz:
        bestPair
          ? {
              line1:
                bestPair.line1,

              line2:
                bestPair.line2,

              score:
                bestPair.score
            }
          : null
    };
  }
}

module.exports =
  PassportOcrService;

module.exports.MAX_IMAGE_BYTES =
  MAX_IMAGE_BYTES;

module.exports.findMrzLines =
  findMrzLines;

module.exports.normalizeTo44 =
  normalizeTo44;
