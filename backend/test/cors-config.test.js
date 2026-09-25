const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { getCorsOrigins } = require("../config/cors");

const originalNodeEnv = process.env.NODE_ENV;
const originalCorsOrigin = process.env.CORS_ORIGIN;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = originalCorsOrigin;
});

test("development CORS remains convenient when unset", () => {
  delete process.env.NODE_ENV;
  delete process.env.CORS_ORIGIN;
  assert.equal(getCorsOrigins(), "*");
});

test("production rejects missing or wildcard CORS origins", () => {
  process.env.NODE_ENV = "production";
  delete process.env.CORS_ORIGIN;
  assert.throws(getCorsOrigins, /CORS_ORIGIN is required/);

  process.env.CORS_ORIGIN = "*";
  assert.throws(getCorsOrigins, /must not contain/);
});

test("production accepts an explicit origin list", () => {
  process.env.NODE_ENV = "production";
  process.env.CORS_ORIGIN = "https://app.example, https://preview.example";
  assert.deepEqual(getCorsOrigins(), [
    "https://app.example",
    "https://preview.example",
  ]);
});
