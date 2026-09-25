const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const mongoose = require("mongoose");

const Ambulance = require("../models/ambulance");
const Booking = require("../models/booking");
const { recoverOrphanedAmbulances } = require("../services/bookingRecovery");

const originals = {
  ambulanceFind: Ambulance.find,
  ambulanceUpdateMany: Ambulance.updateMany,
  bookingFind: Booking.find,
};

afterEach(() => {
  Ambulance.find = originals.ambulanceFind;
  Ambulance.updateMany = originals.ambulanceUpdateMany;
  Booking.find = originals.bookingFind;
});

test("orphan recovery only releases busy ambulances without active bookings", async () => {
  const activeId = new mongoose.Types.ObjectId();
  const orphanedId = new mongoose.Types.ObjectId();

  Ambulance.find = () => ({
    select() {
      return this;
    },
    lean: async () => [{ _id: activeId }, { _id: orphanedId }],
  });
  Booking.find = () => ({
    select() {
      return this;
    },
    lean: async () => [{ ambulance: activeId }],
  });

  let updateFilter;
  let update;
  Ambulance.updateMany = async (filter, changes) => {
    updateFilter = filter;
    update = changes;
    return { modifiedCount: 1 };
  };

  const recovered = await recoverOrphanedAmbulances();

  assert.equal(recovered, 1);
  assert.deepEqual(updateFilter._id.$in, [orphanedId]);
  assert.equal(updateFilter.status, "busy");
  assert.deepEqual(update, { $set: { status: "available" } });
});
