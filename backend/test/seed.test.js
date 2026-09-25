const assert = require("node:assert/strict");
const { test } = require("node:test");

const Ambulance = require("../models/ambulance");
const { DEMO_AMBULANCES, seedDemoAmbulances } = require("../seed");

const originalCreateIndexes = Ambulance.createIndexes;
const originalBulkWrite = Ambulance.bulkWrite;

test("demo fleet seed creates the geo index before upserting ambulances", async () => {
  let indexesReady = false;
  let operations;

  Ambulance.createIndexes = async () => {
    indexesReady = true;
  };
  Ambulance.bulkWrite = async (value) => {
    assert.equal(indexesReady, true);
    operations = value;
    return { upsertedCount: DEMO_AMBULANCES.length, matchedCount: 0 };
  };

  try {
    const result = await seedDemoAmbulances();

    assert.equal(result.upsertedCount, 3);
    assert.equal(operations.length, 3);
    assert.equal(operations[0].updateOne.upsert, true);
    assert.equal(operations[0].updateOne.update.$setOnInsert.status, "available");
    assert.deepEqual(
      operations[0].updateOne.update.$setOnInsert.location.coordinates,
      [76.792, 30.7465]
    );
  } finally {
    Ambulance.createIndexes = originalCreateIndexes;
    Ambulance.bulkWrite = originalBulkWrite;
  }
});
