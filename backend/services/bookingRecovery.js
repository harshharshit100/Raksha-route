const Ambulance = require("../models/ambulance");
const Booking = require("../models/booking");

const ACTIVE_BOOKING_STATUSES = ["confirmed", "ongoing"];

// Repairs legacy crash-orphaned ambulances. Current booking writes use a
// transaction, but upgrading an existing database may contain busy vehicles
// with no active booking from an older interrupted request.
async function recoverOrphanedAmbulances() {
  const busyAmbulances = await Ambulance.find({ status: "busy" })
    .select("_id")
    .lean();
  const busyIds = busyAmbulances
    .map((ambulance) => ambulance._id)
    .filter(Boolean);

  if (!busyIds.length) return 0;

  const activeBookings = await Booking.find({
    ambulance: { $in: busyIds },
    status: { $in: ACTIVE_BOOKING_STATUSES },
  })
    .select("ambulance")
    .lean();
  const activeAmbulanceIds = new Set(
    activeBookings.map((booking) => String(booking.ambulance?._id ?? booking.ambulance))
  );
  const orphanedIds = busyIds.filter((id) => !activeAmbulanceIds.has(String(id)));

  if (!orphanedIds.length) return 0;

  const result = await Ambulance.updateMany(
    { _id: { $in: orphanedIds }, status: "busy" },
    { $set: { status: "available" } }
  );

  return result.modifiedCount || 0;
}

module.exports = { recoverOrphanedAmbulances };
