const mongoose = require("mongoose");
const config = require("./environment");

let connected = false;

async function connectDatabase() {
  if (connected) {
    return mongoose.connection;
  }

  if (!config.mongoUri) {
    throw new Error(
      "MONGODB_URI is not configured"
    );
  }

  mongoose.set(
    "strictQuery",
    true
  );

  mongoose.connection.on(
    "connected",
    () => {
      console.log(
        "[DATABASE] MongoDB connected"
      );
    }
  );

  mongoose.connection.on(
    "error",
    error => {
      console.error(
        "[DATABASE] MongoDB error:",
        error.message
      );
    }
  );

  mongoose.connection.on(
    "disconnected",
    () => {
      connected = false;

      console.warn(
        "[DATABASE] MongoDB disconnected"
      );
    }
  );

  await mongoose.connect(
    config.mongoUri,
    {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 1
    }
  );

  connected = true;

  return mongoose.connection;
}

module.exports = {
  connectDatabase
};
