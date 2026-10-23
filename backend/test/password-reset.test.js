const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { afterEach, beforeEach, test } = require("node:test");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/raksharoute-reset-test";
process.env.JWT_SECRET ||= "password-reset-test-secret";

const User = require("../models/User");
const {
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");

const originalFindOne = User.findOne;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
let originalReadyStateDescriptor;

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

function setDatabaseReady(readyState) {
  originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(
    mongoose.connection,
    "readyState"
  );
  Object.defineProperty(mongoose.connection, "readyState", {
    configurable: true,
    enumerable: false,
    get: () => readyState,
  });
}

function restoreDatabaseReady() {
  if (originalReadyStateDescriptor) {
    Object.defineProperty(
      mongoose.connection,
      "readyState",
      originalReadyStateDescriptor
    );
  } else {
    delete mongoose.connection.readyState;
  }
}

function createUser(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    name: "Asha Verma",
    email: "asha@example.com",
    role: "patient",
    password: "old-password-hash",
    passwordResetToken: null,
    passwordResetExpires: null,
    save: async () => {},
    ...overrides,
  };
}

// Mimics the two query shapes used by the controller.
function fakeUserLookup(user) {
  return async (filter = {}) => {
    if (filter.email) return filter.email === user.email ? user : null;

    if (filter.passwordResetToken) {
      const matchesToken = filter.passwordResetToken === user.passwordResetToken;
      const notExpired =
        user.passwordResetExpires instanceof Date &&
        user.passwordResetExpires > new Date();
      return matchesToken && notExpired ? user : null;
    }

    return null;
  };
}

beforeEach(() => {
  delete process.env.SMTP_URL;
  delete process.env.SMTP_HOST;
  console.log = () => {};
  console.error = () => {};
  setDatabaseReady(mongoose.ConnectionStates.connected);
});

afterEach(() => {
  User.findOne = originalFindOne;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  restoreDatabaseReady();
  delete process.env.SMTP_URL;
  delete process.env.SMTP_HOST;
});

test("unknown emails get the same response as known emails", async () => {
  const unknownUser = createUser({ email: "nobody@example.com" });
  User.findOne = fakeUserLookup(unknownUser);

  const res = responseRecorder();
  await forgotPassword({ body: { email: "missing@example.com" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    message:
      "If an account exists for that email, password reset instructions have been sent.",
  });
});

test("forgot password stores a hashed token and exposes a dev link", async () => {
  const user = createUser();
  User.findOne = fakeUserLookup(user);

  const res = responseRecorder();
  await forgotPassword({ body: { email: user.email } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.devResetUrl, /\/reset-password\?token=[a-f0-9]{64}$/);

  const token = new URL(res.body.devResetUrl).searchParams.get("token");
  const expectedHash = crypto.createHash("sha256").update(token).digest("hex");

  assert.equal(user.passwordResetToken, expectedHash);
  assert.ok(user.passwordResetExpires > new Date());
});

test("reset password rejects malformed tokens", async () => {
  const user = createUser();
  User.findOne = fakeUserLookup(user);

  const res = responseRecorder();
  await resetPassword({ body: { token: "not-a-token", password: "newpass123" } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /invalid or has expired/i);
});

test("reset password rejects an expired token", async () => {
  const token = crypto.randomBytes(32).toString("hex");
  const user = createUser({
    passwordResetToken: crypto.createHash("sha256").update(token).digest("hex"),
    passwordResetExpires: new Date(Date.now() - 60_000),
  });
  User.findOne = fakeUserLookup(user);

  const res = responseRecorder();
  await resetPassword({ body: { token, password: "newpass123" } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /invalid or has expired/i);
});

test("reset password updates the password, clears the token, and signs in", async () => {
  const user = createUser();
  User.findOne = fakeUserLookup(user);

  const forgotRes = responseRecorder();
  await forgotPassword({ body: { email: user.email } }, forgotRes);
  const token = new URL(forgotRes.body.devResetUrl).searchParams.get("token");

  let saved = false;
  user.save = async () => {
    saved = true;
  };

  const res = responseRecorder();
  await resetPassword({ body: { token, password: "brand-new-pass" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, "Password reset successfully");
  assert.equal(typeof res.body.token, "string");
  assert.equal(res.body.user.email, user.email);
  assert.ok(saved);
  assert.equal(user.passwordResetToken, null);
  assert.equal(user.passwordResetExpires, null);
  assert.equal(await bcrypt.compare("brand-new-pass", user.password), true);
});
