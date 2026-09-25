const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const mongoose = require("mongoose");

const Ambulance = require("../models/ambulance");
const Booking = require("../models/booking");
const database = require("../config/db");
const socket = require("../config/socket");
const {
  nextPosition,
  runDevelopmentTrackingTick,
} = require("../services/developmentTracking");

const originalBookingFind = Booking.find;
const originalAmbulanceUpdate = Ambulance.findOneAndUpdate;
const originalDatabaseReady = database.isDatabaseReady;
const originalSocketEmit = socket.emit;
const originalNodeEnv = process.env.NODE_ENV;
const originalUseMemoryDb = process.env.USE_MEMORY_DB;
const originalEnableFleet = process.env.ENABLE_DEVELOPMENT_FLEET;
const originalStepRatio = process.env.DEVELOPMENT_TRACKING_STEP_RATIO;

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  Booking.find = originalBookingFind;
  Ambulance.findOneAndUpdate = originalAmbulanceUpdate;
  database.isDatabaseReady = originalDatabaseReady;
  socket.emit = originalSocketEmit;
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("USE_MEMORY_DB", originalUseMemoryDb);
  restoreEnv("ENABLE_DEVELOPMENT_FLEET", originalEnableFleet);
  restoreEnv("DEVELOPMENT_TRACKING_STEP_RATIO", originalStepRatio);
});

test("position interpolation moves an ambulance toward pickup", () => {
  assert.deepEqual(nextPosition([77.21, 28.61], [77.23, 28.63], 0.5), [
    77.22,
    28.62,
  ]);
});

test("development tracking moves a busy booked ambulance and broadcasts its location", async () => {
  process.env.NODE_ENV = "development";
  process.env.USE_MEMORY_DB = "true";
  process.env.ENABLE_DEVELOPMENT_FLEET = "true";
  process.env.DEVELOPMENT_TRACKING_STEP_RATIO = "0.2";

  const ambulanceId = new mongoose.Types.ObjectId();
  let update;
  let event;
  Booking.find = () => ({
    populate: () => ({
      lean: async () => [
        {
          status: "confirmed",
          pickupLocation: {
            type: "Point",
            coordinates: [77.21, 28.61],
          },
          ambulance: {
            _id: ambulanceId,
            status: "busy",
            location: { type: "Point", coordinates: [77.23, 28.63] },
          },
        },
      ],
    }),
  });
  Ambulance.findOneAndUpdate = async (filter, value) => {
    update = { filter, value };
    return { _id: ambulanceId, status: "busy", ...value.$set };
  };
  database.isDatabaseReady = () => true;
  socket.emit = (name, payload) => {
    event = { name, payload };
  };

  await runDevelopmentTrackingTick();

  assert.deepEqual(update.value.$set.location.coordinates, [77.226, 28.626]);
  assert.equal(event.name, "ambulance:location");
  assert.equal(event.payload._id, String(ambulanceId));
  assert.deepEqual(event.payload.location.coordinates, [77.226, 28.626]);
});
