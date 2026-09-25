const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET ||= "auth-middleware-test-secret";

const User = require("../models/User");
const protect = require("../middleware/authMiddleware");

const originalFindById = User.findById;
const originalConsoleError = console.error;

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function token(id = "user-id") {
  return jwt.sign({ id }, process.env.JWT_SECRET);
}

afterEach(() => {
  User.findById = originalFindById;
  console.error = originalConsoleError;
});

test("database outages return 503 instead of logging out a valid token", async () => {
  console.error = () => {};
  User.findById = () => ({
    select: async () => {
      const error = new Error("database unavailable");
      error.name = "MongoNetworkError";
      throw error;
    },
  });

  const res = responseRecorder();
  let nextCalled = false;
  await protect(
    { headers: { authorization: `Bearer ${token()}` } },
    res,
    () => { nextCalled = true; }
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.message, "Authentication service temporarily unavailable");
});

test("database cast failures from a signed malformed id return 401", async () => {
  User.findById = () => ({
    select: async () => {
      const error = new Error("bad id");
      error.name = "CastError";
      throw error;
    },
  });

  const res = responseRecorder();
  await protect(
    { headers: { authorization: `Bearer ${token("not-an-id")}` } },
    res,
    () => {}
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, "Invalid or expired token");
});
