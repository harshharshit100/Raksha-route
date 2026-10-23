const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/raksharoute-test";
process.env.JWT_SECRET ||= "test-only-jwt-secret";

const Ambulance = require("../models/ambulance");
const User = require("../models/User");
const { errorHandler } = require("../middleware/errorHandler");
const app = require("../server");

let server;
let baseUrl;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

function authToken(userId, role) {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );
}

async function withFakeCurrentUser(userId, role, run) {
  const originalFindById = User.findById;
  User.findById = () => ({
    select: async () => ({ _id: userId, role }),
  });

  try {
    return await run(authToken(userId, role));
  } finally {
    User.findById = originalFindById;
  }
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("GET /health tracks database readiness", async () => {
  const unavailable = await request("/health");
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.body, { status: "unavailable" });

  const originalDescriptor = Object.getOwnPropertyDescriptor(
    mongoose.connection,
    "readyState"
  );
  const setReadyState = (readyState) => {
    Object.defineProperty(mongoose.connection, "readyState", {
      configurable: true,
      enumerable: false,
      get: () => readyState,
    });
  };

  try {
    setReadyState(mongoose.ConnectionStates.connected);
    const ready = await request("/health");
    assert.equal(ready.status, 200);
    assert.deepEqual(ready.body, { status: "ok" });

    setReadyState(mongoose.ConnectionStates.connecting);
    const reconnecting = await request("/health");
    assert.equal(reconnecting.status, 503);
    assert.deepEqual(reconnecting.body, { status: "unavailable" });
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(
        mongoose.connection,
        "readyState",
        originalDescriptor
      );
    } else {
      delete mongoose.connection.readyState;
    }
  }
});

test("unknown routes return JSON 404 responses", async () => {
  const response = await request("/api/does-not-exist");

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { message: "Route not found" });
});

test("malformed JSON returns a sanitized 400 response", async () => {
  const response = await request("/api/auth/register", {
    method: "POST",
    body: '{"name":',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { message: "Invalid JSON body" });
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /stack|position|unexpected/i
  );
});

test("oversized JSON returns a sanitized 413 response", async () => {
  const response = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ padding: "x".repeat(100 * 1024) }),
  });

  assert.equal(response.status, 413);
  assert.deepEqual(response.body, { message: "Request body too large" });
});

test("central error middleware does not expose internal errors", async () => {
  const isolatedApp = express();
  isolatedApp.get("/boom", () => {
    throw new Error("sensitive database connection details");
  });
  isolatedApp.use(errorHandler);

  const isolatedServer = await new Promise((resolve) => {
    const instance = isolatedApp.listen(0, () => resolve(instance));
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${isolatedServer.address().port}/boom`
    );
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { message: "Internal server error" });
    assert.doesNotMatch(
      JSON.stringify(body),
      /sensitive|database|stack|error:/i
    );
  } finally {
    await new Promise((resolve, reject) => {
      isolatedServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("registration validates required fields before database access", async () => {
  const response = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Please fill all required fields");
});

test("registration returns an actionable response while MongoDB is unavailable", async () => {
  const startedAt = Date.now();
  const response = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Database Offline",
      email: "offline@example.invalid",
      password: "Test123!",
      phone: "9876543210",
    }),
  });

  assert.equal(response.status, 503);
  assert.equal(
    response.body.message,
    "Registration service temporarily unavailable. Please try again shortly."
  );
  assert.ok(Date.now() - startedAt < 1000, "database failure should fail fast");
});

test("protected routes reject requests without a token", async () => {
  const response = await request("/api/bookings/my");

  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Not authorized. Please login.");
});

test("patients cannot list the fleet or update ambulance locations", async () => {
  await withFakeCurrentUser("patient-user", "patient", async (token) => {
    const headers = { Authorization: `Bearer ${token}` };

    const listResponse = await request("/api/ambulances", { headers });
    const locationResponse = await request(
      "/api/ambulances/ambulance-test-id/location",
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ latitude: 30.7333, longitude: 76.7794 }),
      }
    );

    assert.equal(listResponse.status, 403);
    assert.equal(listResponse.body.message, "Not authorized");
    assert.equal(locationResponse.status, 403);
    assert.equal(locationResponse.body.message, "Not authorized");
  });
});

test("drivers retain fleet-list and ambulance-location update access", async () => {
  const originalFind = Ambulance.find;
  const originalFindById = Ambulance.findById;
  const driverId = new mongoose.Types.ObjectId();
  const ambulanceId = new mongoose.Types.ObjectId();
  const ambulance = {
    _id: ambulanceId,
    driver: driverId,
    location: { type: "Point", coordinates: [76.7794, 30.7333] },
    save: async () => {},
  };

  Ambulance.find = () => ({ sort: async () => [ambulance] });
  Ambulance.findById = async () => ambulance;

  try {
    await withFakeCurrentUser(driverId, "driver", async (token) => {
      const headers = { Authorization: `Bearer ${token}` };

      const listResponse = await request("/api/ambulances", { headers });
      assert.equal(listResponse.status, 200);
      assert.equal(listResponse.body.ambulances.length, 1);
      assert.equal(
        String(listResponse.body.ambulances[0]._id),
        String(ambulance._id)
      );

      const locationResponse = await request(
        `/api/ambulances/${ambulanceId}/location`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ latitude: 30.7334, longitude: 76.7795 }),
        }
      );

      assert.equal(locationResponse.status, 200);
      assert.equal(locationResponse.body.message, "Location updated");
    });
  } finally {
    Ambulance.find = originalFind;
    Ambulance.findById = originalFindById;
  }
});
