const assert = require("node:assert/strict");
const { test } = require("node:test");

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/raksharoute-test";
process.env.JWT_SECRET ||= "test-only-jwt-secret";

const { getServerEnv, requireEnv } = require("../config/env");

test("getServerEnv returns validated server configuration", () => {
  const env = getServerEnv();

  assert.equal(env.MONGO_URI, process.env.MONGO_URI);
  assert.equal(env.JWT_SECRET, process.env.JWT_SECRET);
});

test("requireEnv gives an actionable error for missing values", () => {
  const name = "RAKSHA_ROUTE_MISSING_TEST_VALUE";
  delete process.env[name];

  assert.throws(
    () => requireEnv(name),
    new RegExp(`Missing required environment variable "${name}"`)
  );
});

test("requireEnv trims configured values", () => {
  const name = "RAKSHA_ROUTE_TEST_VALUE";
  process.env[name] = "  configured-value  ";

  assert.equal(requireEnv(name), "configured-value");
  delete process.env[name];
});
