const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const Ambulance = require("../models/ambulance");
const {
  ensureDevelopmentFleetNear,
  isDevelopmentFleetEnabled,
} = require("../services/developmentFleet");

const originalCreateIndexes = Ambulance.createIndexes;
const originalCountDocuments = Ambulance.countDocuments;
const originalCreate = Ambulance.create;
const originalNodeEnv = process.env.NODE_ENV;
const originalUseMemoryDb = process.env.USE_MEMORY_DB;
const originalEnableDevelopmentFleet = process.env.ENABLE_DEVELOPMENT_FLEET;

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  Ambulance.createIndexes = originalCreateIndexes;
  Ambulance.countDocuments = originalCountDocuments;
  Ambulance.create = originalCreate;
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("USE_MEMORY_DB", originalUseMemoryDb);
  restoreEnv("ENABLE_DEVELOPMENT_FLEET", originalEnableDevelopmentFleet);
});

test("development fleet provisioning is disabled in production", async () => {
  process.env.NODE_ENV = "production";
  process.env.USE_MEMORY_DB = "true";
  process.env.ENABLE_DEVELOPMENT_FLEET = "true";

  assert.equal(isDevelopmentFleetEnabled(), false);
  assert.deepEqual(await ensureDevelopmentFleetNear(72.8776, 19.076), []);
});

test("development fleet creates three uniquely numbered vehicles at realistic offsets", async () => {
  process.env.NODE_ENV = "development";
  process.env.USE_MEMORY_DB = "true";
  process.env.ENABLE_DEVELOPMENT_FLEET = "true";

  const created = [];
  Ambulance.createIndexes = async () => {};
  Ambulance.countDocuments = async () => 0;
  Ambulance.create = async (document) => {
    created.push(document);
    return document;
  };

  const fleet = await ensureDevelopmentFleetNear(72.8776, 19.076);

  assert.equal(fleet.length, 3);
  assert.equal(new Set(fleet.map((item) => item.vehicleNumber)).size, 3);
  for (const ambulance of fleet) {
    assert.match(ambulance.vehicleNumber, /^RR-\d{2}-AB-[A-F0-9]{4}$/);
    assert.doesNotMatch(ambulance.vehicleNumber, /DEMO/i);
    assert.equal(ambulance.status, "available");
    assert.notDeepEqual(ambulance.location.coordinates, [72.8776, 19.076]);
  }
});
