require("dotenv").config();

if (
  process.env.NODE_ENV !==
  "test"
) {
  console.error(
    "Simulation requires NODE_ENV=test"
  );

  process.exit(1);
}

if (
  !process.env.MONGODB_URI ||
  !/test/i.test(
    process.env.MONGODB_URI
  )
) {
  console.error(
    "Refusing to run simulation unless MONGODB_URI points to a test database."
  );

  process.exit(1);
}

const crypto =
  require("crypto");

const {
  connectDatabase
} = require("../src/config/database");

const User =
  require("../src/models/user");

const Client =
  require("../src/models/client");

const Application =
  require("../src/models/application");

const Supervisor =
  require("../src/bots/supervisor");

const {
  createSiteAdapter
} = require("../src/services/site/site-factory");

async function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

async function main() {
  process.env.SITE_ADAPTER =
    "mock";

  process.env.MOCK_SLOT_AFTER_MS =
    "1500";

  await connectDatabase();

  const accountId =
    crypto.randomUUID();

  const user =
    await User.create({
      accountId,
      name:
        "Simulation Owner",
      email:
        `simulation-${Date.now()}@test.local`,
      passwordHash:
        "simulation-only",
      role: "owner"
    });

  const client =
    await Client.create({
      accountId,
      createdBy:
        user._id,
      fullName:
        "Cliente Simulation",
      email:
        "client@test.local",
      phone:
        "+244900000000",
      nationality:
        "Angolana",
      passportNumber:
        "TEST123456",
      passportCountry:
        "AO"
    });

  const application =
    await Application.create({
      accountId,
      createdBy:
        user._id,
      client:
        client._id,
      preferredDates: {
        start:
          "2026-10-01",
        end:
          "2026-12-01"
      },
      preferredTime:
        "09:00",
      status:
        "waiting_for_slot",

      "bot2.monitoring":
        true
    });

  const supervisor =
    new Supervisor({
      siteFactory:
        createSiteAdapter,

      intervalMs:
        250
    });

  /*
   * Preparar o adapter e simular que
   * Bot 1 já deixou a aplicação pronta
   * para o calendário.
   */
  await supervisor.getAdapter(
    application._id.toString()
  );

  supervisor.start();

  let finalApplication = null;

  for (
    let i = 0;
    i < 30;
    i++
  ) {
    await sleep(500);

    finalApplication =
      await Application.findById(
        application._id
      ).populate("client");

    if (
      finalApplication.status ===
      "completed"
    ) {
      break;
    }
  }

  supervisor.stop();

  if (
    !finalApplication ||
    finalApplication.status !==
      "completed"
  ) {
    throw new Error(
      `Simulation failed. Final status: ${finalApplication?.status}`
    );
  }

  console.log("");
  console.log(
    "================================"
  );
  console.log(
    "SIMULATION SUCCESS"
  );
  console.log(
    "================================"
  );

  console.log(
    "Status:",
    finalApplication.status
  );

  console.log(
    "Reference:",
    finalApplication.result.reference
  );

  console.log(
    "Entity:",
    finalApplication.result.entity
  );

  console.log(
    "Slot:",
    finalApplication.slot
  );

  console.log(
    "Completion:",
    finalApplication.metrics.completionMs,
    "ms"
  );

  await Application.deleteOne({
    _id:
      application._id
  });

  await Client.deleteOne({
    _id:
      client._id
  });

  await User.deleteOne({
    _id:
      user._id
  });

  process.exit(0);
}

main().catch(error => {
  console.error(
    "SIMULATION FAILED:",
    error
  );

  process.exit(1);
});
