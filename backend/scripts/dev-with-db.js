require("dotenv").config({ quiet: true });

const path = require("node:path");
const { spawn } = require("node:child_process");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { seed } = require("../seed");

const useMemoryDatabase =
  process.env.NODE_ENV !== "production" && process.env.USE_MEMORY_DB !== "false";

let mongoServer;
let backendProcess;
let stopping = false;

async function stopMongoServer() {
  if (!mongoServer) return;
  const server = mongoServer;
  mongoServer = undefined;
  await server.stop();
}

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  if (backendProcess && backendProcess.exitCode === null) {
    backendProcess.kill("SIGTERM");
  }

  try {
    await stopMongoServer();
  } catch (error) {
    console.error("Failed to stop the development MongoDB instance:", error);
    process.exitCode = 1;
  }

  process.exitCode = exitCode;
}

function forwardSignal(signal) {
  if (backendProcess && backendProcess.exitCode === null) {
    backendProcess.kill(signal);
  } else {
    void shutdown(signal === "SIGINT" ? 130 : 143);
  }
}

async function main() {
  if (useMemoryDatabase) {
    mongoServer = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        dbName: "raksharoute",
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGO_URI = mongoServer.getUri("raksharoute");
    process.env.USE_MEMORY_DB = "true";
    if (process.env.ENABLE_DEVELOPMENT_FLEET !== "false") {
      process.env.ENABLE_DEVELOPMENT_FLEET = "true";
    }
    console.log("Development MongoDB started (data is temporary).");

    const seedResult = await seed();
    console.log(
      `Development fleet ready: ${seedResult.upsertedCount} added, ` +
        `${seedResult.matchedCount} already present.`
    );
  } else {
    console.log("Using the MONGO_URI configured for the backend.");
  }

  backendProcess = spawn(
    process.execPath,
    [
      require.resolve("nodemon/bin/nodemon.js"),
      path.join(__dirname, "..", "server.js"),
    ],
    {
      cwd: path.join(__dirname, ".."),
      env: process.env,
      stdio: "inherit",
    }
  );

  backendProcess.once("error", (error) => {
    console.error("Failed to start the backend:", error);
    void shutdown(1);
  });

  backendProcess.once("exit", (code, signal) => {
    void shutdown(signal ? 1 : code ?? 0);
  });
}

process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));

main().catch((error) => {
  console.error("Failed to start the development environment:", error);
  void shutdown(1);
});
