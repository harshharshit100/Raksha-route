const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const mongoose = require("mongoose");

const {
  isValidCoordinatePair,
  isValidObjectId,
  normalizePhone,
  parseCoordinatePair,
} = require("../lib/validation");
const Ambulance = require("../models/ambulance");
const developmentFleet = require("../services/developmentFleet");
const socketConfig = require("../config/socket");
const {
  PUBLIC_NEARBY_PROJECTION,
  getAmbulanceEta,
  getNearbyAmbulances,
  updateAmbulanceLocation,
} = require("../controllers/ambulanceController");

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

const originalAggregate = Ambulance.aggregate;
const originalFindById = Ambulance.findById;
const originalEmit = socketConfig.emit;
const originalDevelopmentFleetEnabled =
  developmentFleet.isDevelopmentFleetEnabled;
const originalEnsureDevelopmentFleetNear =
  developmentFleet.ensureDevelopmentFleetNear;

afterEach(() => {
  Ambulance.aggregate = originalAggregate;
  Ambulance.findById = originalFindById;
  socketConfig.emit = originalEmit;
  developmentFleet.isDevelopmentFleetEnabled =
    originalDevelopmentFleetEnabled;
  developmentFleet.ensureDevelopmentFleetNear =
    originalEnsureDevelopmentFleetNear;
});

test("patient phone numbers must be exactly 10 digits starting with 6, 7, 8 or 9", () => {
  for (const value of [
    "9876543210",
    "6123456789",
    "7000000000",
    "8999999999",
  ]) {
    assert.equal(normalizePhone(value), value);
  }

  for (const value of [
    "5876543210",
    "1234567890",
    "0123456789",
    "987654321",
    "98765432101",
    "98765 43210",
    "+919876543210",
    "abcdefghij",
  ]) {
    assert.equal(normalizePhone(value), null);
  }
});

test("coordinate parsing rejects null, booleans, empty values, and invalid ranges", () => {
  assert.deepEqual(parseCoordinatePair("76.7794", 30.7333).coordinates, [76.7794, 30.7333]);

  for (const value of [null, "", true, false, {}, [], " 76.7794", "Infinity", NaN]) {
    assert.equal(isValidCoordinatePair(value, 30.7333), false);
    assert.equal(isValidCoordinatePair(76.7794, value), false);
  }

  assert.equal(isValidCoordinatePair(181, 30), false);
  assert.equal(isValidCoordinatePair(76, -91), false);
  assert.equal(isValidCoordinatePair(0, 0), false);
  assert.equal(isValidCoordinatePair(0, 0, { allowZero: true }), true);
  assert.equal(isValidCoordinatePair(180, 90, { allowZero: true }), true);
});

test("ambulance endpoints reject malformed ObjectIds with 400", async () => {
  const locationResponse = responseRecorder();
  await updateAmbulanceLocation(
    {
      params: { id: "not-an-object-id" },
      body: { longitude: 76.7794, latitude: 30.7333 },
      user: { role: "admin" },
    },
    locationResponse
  );
  assert.equal(locationResponse.statusCode, 400);

  const etaResponse = responseRecorder();
  await getAmbulanceEta(
    {
      params: { id: "12" },
      query: { lat: 30.7333, lng: 76.7794 },
      user: { role: "patient" },
    },
    etaResponse
  );
  assert.equal(etaResponse.statusCode, 400);
  assert.equal(isValidObjectId("12"), false);
});

test("nearby projection and response omit driver and personal fields", async () => {
  let pipeline;
  Ambulance.aggregate = async (value) => {
    pipeline = value;
    return [
      {
        _id: new mongoose.Types.ObjectId(),
        vehicleNumber: "CH-01",
        driverName: "Private Driver",
        driverPhone: "+91 99999 99999",
        driver: new mongoose.Types.ObjectId(),
        type: "Basic",
        status: "available",
        location: { type: "Point", coordinates: [76.7794, 30.7333] },
        distance: 100,
        patientPhone: "patient-secret",
      },
    ];
  };

  const res = responseRecorder();
  await getNearbyAmbulances(
    { query: { latitude: "30.7333", longitude: "76.7794", distance: "5000" } },
    res
  );

  assert.equal(res.statusCode, 200);
  const result = res.body.ambulances[0];
  assert.deepEqual(Object.keys(result).sort(), [
    "_id",
    "distance",
    "etaMinutes",
    "etaSource",
    "location",
    "status",
    "type",
    "vehicleNumber",
  ].sort());
  assert.equal(result.driverPhone, undefined);
  assert.equal(result.driver, undefined);
  assert.equal(result.driverName, undefined);
  assert.equal(JSON.stringify(res.body).includes("99999"), false);
  assert.equal(JSON.stringify(pipeline).includes("driverPhone"), false);
  assert.equal(JSON.stringify(pipeline).includes("driverName"), false);
  assert.deepEqual(pipeline[1].$project, PUBLIC_NEARBY_PROJECTION);
});

test("development nearby search provisions a three-vehicle local fleet when none is nearby", async () => {
  let aggregateCalls = 0;
  let provisionedAt;
  Ambulance.aggregate = async () => {
    aggregateCalls += 1;
    if (aggregateCalls === 1) return [];
    return [0, 1, 2].map((index) => ({
      _id: new mongoose.Types.ObjectId(),
      vehicleNumber: `RR-0${index + 1}-AB-100${index + 1}`,
      type: ["Basic", "Advanced", "ICU"][index],
      status: "available",
      location: { type: "Point", coordinates: [72.8776, 19.076] },
      distance: 2000 + index * 1000,
    }));
  };
  developmentFleet.isDevelopmentFleetEnabled = () => true;
  developmentFleet.ensureDevelopmentFleetNear = async (
    longitude,
    latitude,
    requestedCount
  ) => {
    provisionedAt = { longitude, latitude, requestedCount };
    return [0, 1, 2].map(() => ({ _id: new mongoose.Types.ObjectId() }));
  };

  const res = responseRecorder();
  await getNearbyAmbulances(
    { query: { latitude: "19.076", longitude: "72.8776", distance: "5000" } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 3);
  assert.equal(res.body.developmentFleetAdded, true);
  assert.deepEqual(provisionedAt, {
    longitude: 72.8776,
    latitude: 19.076,
    requestedCount: 3,
  });
  assert.equal(aggregateCalls, 2);
});

test("drivers can update only their own ambulance and broadcasts no personal data", async () => {
  const driverId = new mongoose.Types.ObjectId();
  const otherDriverId = new mongoose.Types.ObjectId();
  const ambulanceId = new mongoose.Types.ObjectId();
  let saveCalls = 0;
  const ambulance = {
    _id: ambulanceId,
    driver: otherDriverId,
    driverPhone: "secret-phone",
    location: { type: "Point", coordinates: [76.7794, 30.7333] },
    save: async () => {
      saveCalls += 1;
    },
  };

  Ambulance.findById = async () => ambulance;
  const forbidden = responseRecorder();
  await updateAmbulanceLocation(
    {
      params: { id: ambulanceId },
      body: { longitude: 76.7795, latitude: 30.7334 },
      user: { _id: driverId, role: "driver" },
    },
    forbidden
  );
  assert.equal(forbidden.statusCode, 403);
  assert.equal(saveCalls, 0);

  ambulance.driver = driverId;
  let broadcast;
  socketConfig.emit = (event, payload) => {
    broadcast = { event, payload };
  };
  const allowed = responseRecorder();
  await updateAmbulanceLocation(
    {
      params: { id: ambulanceId },
      body: { longitude: 76.7795, latitude: 30.7334 },
      user: { _id: driverId, role: "driver" },
    },
    allowed
  );

  assert.equal(allowed.statusCode, 200);
  assert.equal(saveCalls, 1);
  assert.equal(broadcast.event, "ambulance:location");
  assert.deepEqual(Object.keys(broadcast.payload).sort(), ["_id", "location"]);
  assert.equal(JSON.stringify(broadcast.payload).includes("secret-phone"), false);
});
