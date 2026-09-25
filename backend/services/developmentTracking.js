const Booking = require("../models/booking");
const Ambulance = require("../models/ambulance");
const database = require("../config/db");
const socket = require("../config/socket");
const {
  getIdString,
  isValidCoordinateArray,
} = require("../lib/validation");

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_STEP_RATIO = 0.18;
const ACTIVE_BOOKING_STATUSES = ["confirmed", "ongoing"];

let intervalTimer = null;
let tickInProgress = false;

function isEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.USE_MEMORY_DB === "true" &&
    process.env.ENABLE_DEVELOPMENT_FLEET === "true"
  );
}

function getPositiveNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getId(value) {
  return getIdString(value);
}

function moveCoordinateToward(current, target, ratio) {
  return Number((current + (target - current) * ratio).toFixed(6));
}

function nextPosition(currentCoordinates, targetCoordinates, ratio) {
  if (
    !isValidCoordinateArray(currentCoordinates, { allowZero: false }) ||
    !isValidCoordinateArray(targetCoordinates, { allowZero: false })
  ) {
    return null;
  }

  const [currentLongitude, currentLatitude] = currentCoordinates;
  const [targetLongitude, targetLatitude] = targetCoordinates;
  return [
    moveCoordinateToward(currentLongitude, targetLongitude, ratio),
    moveCoordinateToward(currentLatitude, targetLatitude, ratio),
  ];
}

async function runDevelopmentTrackingTick() {
  if (!isEnabled() || !database.isDatabaseReady() || tickInProgress) return;

  tickInProgress = true;
  try {
    const bookings = await Booking.find({
      status: { $in: ACTIVE_BOOKING_STATUSES },
    })
      .populate("ambulance")
      .lean();

    const processedAmbulances = new Set();
    const stepRatio = Math.min(
      0.5,
      getPositiveNumber("DEVELOPMENT_TRACKING_STEP_RATIO", DEFAULT_STEP_RATIO)
    );

    for (const booking of bookings) {
      const ambulance = booking.ambulance;
      const ambulanceId = getId(ambulance);
      const targetCoordinates = booking.pickupLocation?.coordinates;
      const currentCoordinates = ambulance?.location?.coordinates;
      if (
        !ambulanceId ||
        processedAmbulances.has(ambulanceId) ||
        ambulance.status !== "busy"
      ) {
        continue;
      }
      processedAmbulances.add(ambulanceId);

      const nextCoordinates = nextPosition(
        currentCoordinates,
        targetCoordinates,
        stepRatio
      );
      if (!nextCoordinates) continue;

      const location = { type: "Point", coordinates: nextCoordinates };
      const updated = await Ambulance.findOneAndUpdate(
        { _id: ambulanceId, status: "busy" },
        { $set: { location } },
        { returnDocument: "after" }
      );
      if (!updated) continue;

      socket.emit("ambulance:location", {
        _id: ambulanceId,
        location,
      });
    }
  } catch (error) {
    console.error("Development trip tracking tick failed:", error);
  } finally {
    tickInProgress = false;
  }
}

function startDevelopmentTracking() {
  if (!isEnabled() || intervalTimer) return () => {};

  const intervalMs = getPositiveNumber(
    "DEVELOPMENT_TRACKING_INTERVAL_MS",
    DEFAULT_INTERVAL_MS
  );
  intervalTimer = setInterval(() => {
    void runDevelopmentTrackingTick();
  }, intervalMs);
  intervalTimer.unref?.();

  console.log("Development live-trip tracking enabled");
  return stopDevelopmentTracking;
}

function stopDevelopmentTracking() {
  if (!intervalTimer) return;
  clearInterval(intervalTimer);
  intervalTimer = null;
}

module.exports = {
  nextPosition,
  runDevelopmentTrackingTick,
  startDevelopmentTracking,
  stopDevelopmentTracking,
};
