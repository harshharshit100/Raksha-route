const mongoose = require("mongoose");
const Booking = require("../models/booking");
const Ambulance = require("../models/ambulance");
const { computeEta, heuristicMinutes, haversineMeters } = require("../lib/eta");
const {
  isCastError,
  isValidationError,
  normalizeName,
  normalizePhone,
  parseCoordinatePair,
} = require("../lib/validation");
const { emitToRooms, roleRoom, userRoom } = require("../config/socket");

const FLEET_SOCKET_ROLES = ["driver", "admin"];
const TRANSITIONS = {
  confirmed: ["ongoing", "cancelled"],
  ongoing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function runInTransaction(callback) {
  return mongoose.connection.transaction(callback);
}

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

function getPopulatedId(value) {
  return value?._id ?? value?.id ?? value ?? null;
}

function redactBookingForFleet(booking) {
  if (!booking || typeof booking !== "object") return booking;

  const {
    user,
    patientPhone,
    pickupLocation,
    ...fleetBooking
  } = booking;
  return fleetBooking;
}

// Patients receive full trip events only in their private room. The assigned
// driver gets that same private event. Other fleet staff receive a separate,
// redacted activity event so patient contact and exact pickup data are not
// broadcast to every driver socket.
function emitBookingEvent(event, payload, booking) {
  const ownerId = getPopulatedId(booking?.user);
  const driverId = getPopulatedId(booking?.ambulance?.driver);

  emitToRooms(event, payload, [userRoom(ownerId), userRoom(driverId)]);

  const fleetPayload = payload?.booking
    ? { ...payload, booking: redactBookingForFleet(booking) }
    : redactBookingForFleet(payload);
  emitToRooms(
    `${event}:fleet`,
    fleetPayload,
    FLEET_SOCKET_ROLES.map(roleRoom)
  );
}

// Attach a straight-line ETA to a booking (ambulance → pickup) — instant,
// used for the booking confirmation card
function attachInstantEta(booking) {
  const amb = booking?.ambulance?.location?.coordinates;
  const pick = booking?.pickupLocation?.coordinates;
  if (!booking || !amb || !pick) return;
  const minutes = heuristicMinutes(
    haversineMeters(
      { lng: amb[0], lat: amb[1] },
      { lng: pick[0], lat: pick[1] }
    )
  );
  if (minutes != null) {
    booking.etaMinutes = minutes;
    booking.etaSource = "estimated";
  }
}

// BOOK AMBULANCE
const bookAmbulance = async (req, res) => {
  try {
    const {
      ambulanceId,
      latitude,
      longitude,
      destination,
      patientName,
      patientPhone,
      pickupAddress,
    } = req.body || {};

    const normalizedPickupAddress =
      typeof pickupAddress === "string"
        ? pickupAddress.trim().replace(/\s+/g, " ")
        : "";
    const normalizedDestination =
      typeof destination === "string"
        ? destination.trim().replace(/\s+/g, " ")
        : "";
    const normalizedPatientName = normalizeName(patientName);
    const normalizedPatientPhone = normalizePhone(patientPhone);
    const coordinates = parseCoordinatePair(longitude, latitude, {
      allowZero: false,
    });

    if (
      (pickupAddress !== undefined && normalizedPickupAddress.length > 300) ||
      (pickupAddress != null && typeof pickupAddress !== "string")
    ) {
      return res.status(400).json({
        message: "Pickup address is invalid",
      });
    }

    if (
      !ambulanceId ||
      !normalizedDestination ||
      !normalizedPatientName
    ) {
      return res.status(400).json({
        message: "All booking details are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(ambulanceId)) {
      return res.status(400).json({ message: "Invalid ambulance id" });
    }

    if (!coordinates.ok) {
      return res.status(400).json({ message: "Invalid pickup coordinates" });
    }

    if (!normalizedPatientPhone) {
      return res.status(400).json({
        message:
          "Enter a valid 10-digit patient phone number starting with 6, 7, 8 or 9.",
      });
    }

    if (normalizedDestination.length > 300 || !normalizedPatientName) {
      return res.status(400).json({
        message: "Patient name or destination is invalid",
      });
    }

    // Claiming the ambulance and creating its booking must commit together.
    // If either write fails, MongoDB rolls the entire transaction back, so a
    // process crash cannot strand a busy vehicle without a booking.
    const result = await runInTransaction(async (session) => {
      const ambulance = await Ambulance.findOneAndUpdate(
        { _id: ambulanceId, status: "available" },
        { $set: { status: "busy" } },
        { returnDocument: "after", session }
      );

      if (!ambulance) {
        const exists = await Ambulance.findById(ambulanceId).session(session);
        return {
          status: exists ? 400 : 404,
          body: {
            message: exists ? "Ambulance is not available" : "Ambulance not found",
          },
        };
      }

      const [booking] = await Booking.create(
        [
          {
            user: req.user._id || req.user.id,
            ambulance: ambulanceId,
            pickupLocation: {
              type: "Point",
              coordinates: coordinates.coordinates,
            },
            ...(normalizedPickupAddress
              ? { pickupAddress: normalizedPickupAddress }
              : {}),
            destination: normalizedDestination,
            patientName: normalizedPatientName,
            patientPhone: normalizedPatientPhone,
            status: "confirmed",
          },
        ],
        { session }
      );

      const populatedBooking = await Booking.findById(booking._id)
        .session(session)
        .populate("ambulance")
        .populate("user", "-password")
        .lean();

      if (!populatedBooking) {
        throw new Error("Booking could not be read after creation");
      }

      attachInstantEta(populatedBooking);
      return { status: 201, booking: populatedBooking };
    });

    if (result.status !== 201) {
      return res.status(result.status).json(result.body);
    }

    // Notify only the customer, assigned driver, and authorized fleet rooms.
    emitBookingEvent("booking:created", result.booking, result.booking);

    return res.status(201).json({
      message: "Ambulance booked successfully",
      booking: result.booking,
    });
  } catch (error) {
    console.error("Booking creation failed:", error);

    if (isDuplicateKeyError(error)) {
      return res.status(409).json({
        message: "This ambulance already has an active booking",
      });
    }

    if (
      error?.code === 20 ||
      /transaction numbers are only allowed|replica set/i.test(error?.message || "")
    ) {
      return res.status(503).json({
        message: "Booking service requires a MongoDB replica set",
      });
    }

    return res.status(500).json({
      message: "Unable to book ambulance",
    });
  }
};


// GET MY BOOKINGS
const getMyBookings = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    const bookings = await Booking.find({
      user: userId,
    })
      .populate("ambulance")
      .sort({ createdAt: -1 });

    res.status(200).json({
      bookings,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Unable to process booking request",
    });
  }
};


// GET SINGLE BOOKING
const getBooking = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid booking id" });
    }

    const booking = await Booking.findById(id)
      .populate("ambulance")
      .populate("user", "-password")
      .lean();

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const userId = req.user._id?.toString() || req.user.id;
    const ownerId = String(booking.user?._id ?? booking.user ?? "");

    let authorized = ownerId === userId || req.user.role === "admin";

    // Drivers assigned to this ambulance may also track the trip
    if (!authorized && req.user.role === "driver") {
      const ambulanceId = booking.ambulance?._id ?? booking.ambulance;
      const ambulance = await Ambulance.findById(ambulanceId);
      authorized = ambulance?.driver?.toString() === userId;
    }

    if (!authorized) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Road ETA (with straight-line fallback) for this trip's pickup point
    const ambCoords = booking.ambulance?.location?.coordinates;
    const pickCoords = booking.pickupLocation?.coordinates;
    if (ambCoords && pickCoords) {
      const eta = await computeEta({
        from: { lng: ambCoords[0], lat: ambCoords[1] },
        to: { lng: pickCoords[0], lat: pickCoords[1] },
      });
      if (eta) {
        booking.etaMinutes = eta.minutes;
        booking.etaSource = eta.source;
      }
    }

    res.status(200).json({ booking });

  } catch (error) {
    return res.status(500).json({
      message: "Unable to process booking request",
    });
  }
};


// UPDATE BOOKING STATUS
const updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    const allowedStatuses = ["confirmed", "ongoing", "completed", "cancelled"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid booking status",
      });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid booking id" });
    }

    // Authorization, transition validation, booking update, and ambulance
    // release share one transaction. The status predicate makes the update
    // conditional even if a caller races another status request.
    const result = await runInTransaction(async (session) => {
      const booking = await Booking.findById(id).session(session);
      if (!booking) {
        return { status: 404, body: { message: "Booking not found" } };
      }

      const userId = req.user._id?.toString() || req.user.id;
      const isOwner = booking.user.toString() === userId;
      let canManage = req.user.role === "admin";

      if (!canManage && status === "cancelled" && isOwner) {
        canManage = true;
      } else if (!canManage && req.user.role === "driver") {
        const ambulance = await Ambulance.findById(booking.ambulance).session(session);
        canManage = ambulance?.driver?.toString() === userId;
      }

      if (!canManage) {
        return { status: 403, body: { message: "Not authorized" } };
      }

      const currentStatus = booking.status;
      if (!(TRANSITIONS[currentStatus] || []).includes(status)) {
        return {
          status: 400,
          body: { message: `Cannot change status from ${currentStatus} to ${status}` },
        };
      }

      const updated = await Booking.findOneAndUpdate(
        { _id: id, status: currentStatus },
        { $set: { status } },
        { returnDocument: "after", session }
      );

      if (!updated) {
        return {
          status: 409,
          body: { message: "Booking status changed concurrently; retry the request" },
        };
      }

      if (status === "completed" || status === "cancelled") {
        await Ambulance.findOneAndUpdate(
          { _id: booking.ambulance, status: "busy" },
          { $set: { status: "available" } },
          { session }
        );
      }

      const updatedBooking = await Booking.findById(id)
        .session(session)
        .populate("ambulance")
        .lean();

      if (!updatedBooking) {
        throw new Error("Updated booking could not be read");
      }

      return { status: 200, booking: updatedBooking };
    });

    if (result.status !== 200) {
      return res.status(result.status).json(result.body);
    }

    // Keep live tracking scoped to the trip's authorized audience.
    emitBookingEvent("booking:status", {
      bookingId: result.booking._id,
      status,
      booking: result.booking,
    }, result.booking);

    return res.status(200).json({
      message: "Booking status updated",
      booking: result.booking,
    });
  } catch (error) {
    console.error("Booking status update failed:", error);

    if (
      error?.code === 20 ||
      /transaction numbers are only allowed|replica set/i.test(error?.message || "")
    ) {
      return res.status(503).json({
        message: "Booking service requires a MongoDB replica set",
      });
    }

    return res.status(500).json({
      message: "Unable to update booking status",
    });
  }
};


// GET ALL BOOKINGS (fleet activity feed)
const getAllBookings = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate("ambulance")
      .populate("user", "name email phone")
      .sort({ createdAt: -1 })
      .limit(15);

    res.status(200).json({
      bookings,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Unable to process booking request",
    });
  }
};


module.exports = {
  bookAmbulance,
  getMyBookings,
  getBooking,
  updateBookingStatus,
  getAllBookings,
};