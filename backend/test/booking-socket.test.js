const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const mongoose = require("mongoose");

process.env.JWT_SECRET ||= "booking-socket-test-secret";

const Ambulance = require("../models/ambulance");
const Booking = require("../models/booking");
const socketConfig = require("../config/socket");

const scopedEmits = [];
const originalEmitToRooms = socketConfig.emitToRooms;
const originalModelMethods = {
  ambulanceFindById: Ambulance.findById,
  ambulanceFindOneAndUpdate: Ambulance.findOneAndUpdate,
  bookingCreate: Booking.create,
  bookingFindById: Booking.findById,
  bookingFindOneAndUpdate: Booking.findOneAndUpdate,
};
const originalTransaction = mongoose.connection.transaction;

socketConfig.emitToRooms = (event, payload, rooms) => {
  scopedEmits.push({ event, payload, rooms });
};

const {
  bookAmbulance,
  updateBookingStatus,
} = require("../controllers/bookingcontroller");

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

beforeEach(() => {
  scopedEmits.length = 0;
  mongoose.connection.transaction = async (callback) => callback({ id: "test-session" });
});

after(() => {
  socketConfig.emitToRooms = originalEmitToRooms;
  Ambulance.findById = originalModelMethods.ambulanceFindById;
  Ambulance.findOneAndUpdate = originalModelMethods.ambulanceFindOneAndUpdate;
  Booking.create = originalModelMethods.bookingCreate;
  Booking.findById = originalModelMethods.bookingFindById;
  Booking.findOneAndUpdate = originalModelMethods.bookingFindOneAndUpdate;
  mongoose.connection.transaction = originalTransaction;
});

test("booking creation is emitted only to owner, assigned driver, and fleet roles", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const driverId = new mongoose.Types.ObjectId();
  const ambulanceId = new mongoose.Types.ObjectId();
  const bookingId = new mongoose.Types.ObjectId();
  const populatedBooking = {
    _id: bookingId,
    user: { _id: ownerId, name: "Patient" },
    ambulance: { _id: ambulanceId, driver: driverId },
    patientPhone: "555-0100",
    pickupLocation: { type: "Point", coordinates: [76.7794, 30.7333] },
    status: "confirmed",
  };

  Ambulance.findOneAndUpdate = async (filter, update, options) => {
    assert.equal(filter.status, "available");
    assert.deepEqual(update, { $set: { status: "busy" } });
    assert.equal(options.session.id, "test-session");
    return { _id: ambulanceId };
  };
  Booking.create = async (documents, options) => {
    assert.equal(documents.length, 1);
    assert.equal(options.session.id, "test-session");
    return [{ _id: bookingId }];
  };
  Booking.findById = () => ({
    session() {
      return this;
    },
    populate() {
      return this;
    },
    lean: async () => populatedBooking,
  });

  const req = {
    user: { _id: ownerId },
    body: {
      ambulanceId: ambulanceId.toString(),
      latitude: 30.7333,
      longitude: 76.7794,
      destination: "City Hospital",
      patientName: "Patient",
      patientPhone: "555-0100",
    },
  };
  const res = responseRecorder();

  await bookAmbulance(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.booking, populatedBooking);
  assert.equal(scopedEmits.length, 2);
  assert.equal(scopedEmits[0].event, "booking:created");
  assert.equal(scopedEmits[0].payload, populatedBooking);
  assert.deepEqual(scopedEmits[0].rooms, [
    `user:${ownerId}`,
    `user:${driverId}`,
  ]);
  assert.equal(scopedEmits[1].event, "booking:created:fleet");
  assert.deepEqual(scopedEmits[1].rooms, ["role:driver", "role:admin"]);
  assert.equal(scopedEmits[1].payload.user, undefined);
  assert.equal(scopedEmits[1].payload.patientPhone, undefined);
  assert.equal(scopedEmits[1].payload.pickupLocation, undefined);
  assert.equal(scopedEmits[1].rooms.includes("role:patient"), false);
});

test("booking status updates use the same scoped audience", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const driverId = new mongoose.Types.ObjectId();
  const ambulanceId = new mongoose.Types.ObjectId();
  const bookingId = new mongoose.Types.ObjectId();
  let updateCalls = 0;
  const storedBooking = {
    _id: bookingId,
    user: ownerId,
    ambulance: ambulanceId,
    status: "confirmed",
  };
  const updatedBooking = {
    _id: bookingId,
    user: ownerId,
    ambulance: { _id: ambulanceId, driver: driverId },
    patientPhone: "555-0100",
    pickupLocation: { type: "Point", coordinates: [76.7794, 30.7333] },
    status: "ongoing",
  };
  let findByIdCalls = 0;

  Booking.findById = () => {
    findByIdCalls += 1;
    if (findByIdCalls === 1) {
      return {
        session: async () => storedBooking,
      };
    }
    return {
      session() {
        return this;
      },
      populate() {
        return this;
      },
      lean: async () => updatedBooking,
    };
  };
  Booking.findOneAndUpdate = async (filter, update, options) => {
    updateCalls += 1;
    assert.equal(filter.status, "confirmed");
    assert.deepEqual(update, { $set: { status: "ongoing" } });
    assert.equal(options.session.id, "test-session");
    return { _id: bookingId, ...updatedBooking };
  };

  const req = {
    user: { _id: new mongoose.Types.ObjectId(), role: "admin" },
    params: { id: bookingId.toString() },
    body: { status: "ongoing" },
  };
  const res = responseRecorder();

  await updateBookingStatus(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updateCalls, 1);
  assert.equal(res.body.booking, updatedBooking);
  assert.equal(scopedEmits.length, 2);
  assert.equal(scopedEmits[0].event, "booking:status");
  assert.equal(scopedEmits[0].payload.bookingId, bookingId);
  assert.equal(scopedEmits[0].payload.status, "ongoing");
  assert.equal(scopedEmits[0].payload.booking, updatedBooking);
  assert.deepEqual(scopedEmits[0].rooms, [
    `user:${ownerId}`,
    `user:${driverId}`,
  ]);
  assert.equal(scopedEmits[1].event, "booking:status:fleet");
  assert.deepEqual(scopedEmits[1].rooms, ["role:driver", "role:admin"]);
  assert.equal(scopedEmits[1].payload.booking.user, undefined);
  assert.equal(scopedEmits[1].payload.booking.patientPhone, undefined);
  assert.equal(scopedEmits[1].payload.booking.pickupLocation, undefined);
});

test("booking status conditional update rejects a concurrent transition", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const bookingId = new mongoose.Types.ObjectId();
  const storedBooking = {
    _id: bookingId,
    user: ownerId,
    ambulance: new mongoose.Types.ObjectId(),
    status: "confirmed",
  };

  Booking.findById = () => ({
    session: async () => storedBooking,
  });
  Booking.findOneAndUpdate = async () => null;

  const res = responseRecorder();
  await updateBookingStatus(
    {
      user: { _id: new mongoose.Types.ObjectId(), role: "admin" },
      params: { id: bookingId.toString() },
      body: { status: "ongoing" },
    },
    res
  );

  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /changed concurrently/);
  assert.equal(scopedEmits.length, 0);
});

test("terminal booking status releases its ambulance in the same transaction", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const driverId = new mongoose.Types.ObjectId();
  const ambulanceId = new mongoose.Types.ObjectId();
  const bookingId = new mongoose.Types.ObjectId();
  const storedBooking = {
    _id: bookingId,
    user: ownerId,
    ambulance: ambulanceId,
    status: "ongoing",
  };
  const updatedBooking = {
    _id: bookingId,
    user: ownerId,
    ambulance: { _id: ambulanceId, driver: driverId },
    status: "completed",
  };
  let findByIdCalls = 0;
  let ambulanceReleaseCalls = 0;

  Booking.findById = () => {
    findByIdCalls += 1;
    if (findByIdCalls === 1) {
      return { session: async () => storedBooking };
    }
    return {
      session() {
        return this;
      },
      populate() {
        return this;
      },
      lean: async () => updatedBooking,
    };
  };
  Booking.findOneAndUpdate = async () => ({ _id: bookingId, status: "completed" });
  Ambulance.findOneAndUpdate = async (filter, update, options) => {
    ambulanceReleaseCalls += 1;
    assert.deepEqual(filter, { _id: ambulanceId, status: "busy" });
    assert.deepEqual(update, { $set: { status: "available" } });
    assert.equal(options.session.id, "test-session");
  };

  const res = responseRecorder();
  await updateBookingStatus(
    {
      user: { _id: new mongoose.Types.ObjectId(), role: "admin" },
      params: { id: bookingId.toString() },
      body: { status: "completed" },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(ambulanceReleaseCalls, 1);
  assert.equal(res.body.booking.status, "completed");
});
