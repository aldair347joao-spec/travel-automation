"use strict";

const {
  assertAutomationReleased
} = require("./admin-control-service");


/*
 * =========================================================
 * AUTOMATION GUARD
 * =========================================================
 *
 * Esta função é a barreira server-side entre:
 *
 * CLIENTE
 *    ↓
 * ADMIN
 *    ↓
 * LIBERAR PARA AUTOMAÇÃO
 *    ↓
 * BOT 1 / BOT 2
 *
 * Nunca confiar apenas no frontend.
 */

async function requireAutomationRelease(
  applicationId
) {
  if (!applicationId) {
    const error =
      new Error(
        "Application ID is required"
      );

    error.code =
      "APPLICATION_ID_REQUIRED";

    error.statusCode =
      400;

    throw error;
  }

  await assertAutomationReleased(
    applicationId
  );

  return true;
}


module.exports = {
  requireAutomationRelease
};
