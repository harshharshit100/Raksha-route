const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { getJwtSecret } = require("../config/env");

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

test("production rejects short JWT secrets", () => {
  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = "too-short";
  assert.throws(getJwtSecret, /at least 32 characters/);
});

test("production accepts a sufficiently long JWT secret", () => {
  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = "a".repeat(32);
  assert.equal(getJwtSecret(), "a".repeat(32));
});
