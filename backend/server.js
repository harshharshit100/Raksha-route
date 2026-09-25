const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");

const { getCorsOrigins } = require("./config/cors");
const connectDB = require("./config/db");
const { isDatabaseReady } = connectDB;
const {
  errorHandler,
  notFoundHandler,
} = require("./middleware/errorHandler");

const app = express();

app.disable("x-powered-by");

// Conservative headers for a JSON API. They do not affect Socket.IO or CORS.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(cors({
  origin: getCorsOrigins(),
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Render uses this endpoint as a readiness check. It is intentionally not a
// process-only health check: an HTTP listener without MongoDB is not ready.
app.get("/health", (req, res) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ status: "unavailable" });
  }

  return res.status(200).json({ status: "ok" });
});

app.use(express.json({ limit: "100kb" }));

// Routes
const authRoutes = require("./routes/authRoutes");
const ambulanceRoutes = require("./routes/ambulanceRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const locationRoutes = require("./routes/locationRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/ambulances", ambulanceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/locations", locationRoutes);

app.get("/", (req, res) => {
  res.json({ message: "RakshaRoute API is running" });
});

app.use(notFoundHandler);
app.use(errorHandler);

function getPort() {
  const port = Number(process.env.PORT || 5001);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port);
  });
}

function closeHttpServer(server) {
  if (!server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
  });
}

function registerShutdownHandlers(io, stopBackgroundWork = () => {}) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`${signal} received; shutting down gracefully`);

    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();

    try {
      stopBackgroundWork();
    } catch (error) {
      console.error("Background worker shutdown failed:", error);
    }

    try {
      const results = await Promise.allSettled([
        mongoose.disconnect(),
        io.close(),
      ]);
      const failed = results.some((result) => result.status === "rejected");

      if (failed) {
        process.exitCode = 1;
        console.error("Graceful shutdown did not complete cleanly");
      }
    } catch {
      process.exitCode = 1;
      console.error("Graceful shutdown failed");
    } finally {
      clearTimeout(forceExit);
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

async function startServer() {
  const port = getPort();
  const server = http.createServer(app);

  server.on("error", (error) => {
    console.error("HTTP server error:", error);
    console.error("FULL ERROR:", error.stack);
});

  try {
    await listen(server, port);
    console.log(
      `HTTP server listening on port ${port}; waiting for MongoDB`
    );

    await connectDB();

    try {
      const { recoverOrphanedAmbulances } = require("./services/bookingRecovery");
      const recovered = await recoverOrphanedAmbulances();
      if (recovered > 0) {
        console.log(`Recovered ${recovered} orphaned ambulance record(s)`);
      }
    } catch (error) {
      // Recovery is a repair task and should not make an otherwise healthy API
      // unavailable; the transaction-backed booking path remains safe.
      console.error("Orphaned ambulance recovery failed:", error?.name);
    }

    // Keep Socket.IO initialization on the supported long-running Node
    // entrypoint. Requiring this module does not connect or open a listener.
    const { init } = require("./config/socket");
    const io = init(server);
    const { startDevelopmentTracking } = require("./services/developmentTracking");
    const stopDevelopmentTracking = startDevelopmentTracking();
    registerShutdownHandlers(io, stopDevelopmentTracking);

    console.log(
      `Server ready on port ${port} (MongoDB connected, Socket.IO initialized)`
    );

    return { server, io };
  } catch (error) {
    await mongoose.disconnect().catch(() => {});
    await closeHttpServer(server).catch(() => {});
    throw error;
  }
}

// Supported entrypoint: node server.js. Importing server.js is side-effect free
// with respect to MongoDB, Socket.IO, and the HTTP listener.
if (require.main === module) {
    startServer().catch((error) => {
        console.error("Backend startup failed:", error);
        console.error("FULL ERROR:", error.stack);
        process.exit(1);
    });
}

module.exports = app;
module.exports.startServer = startServer;
