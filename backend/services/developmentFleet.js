const { randomBytes } = require("node:crypto");
const Ambulance = require("../models/ambulance");
const { parseCoordinatePair } = require("../lib/validation");

const DEFAULT_DEVELOPMENT_FLEET_SIZE = 3;
const DEFAULT_FLEET_LIMIT = 60;
const DEVELOPMENT_VEHICLE_PATTERN = /^RR-/;
const VEHICLE_TYPES = ["Basic", "Advanced", "ICU"];
// Three distinct points between roughly 1.5 and 4 km from the pickup. They
// remain inside the smallest radius offered by the dashboard (5 km).
const VEHICLE_OFFSETS = [
  [0.01, 0.012],
  [-0.018, 0.016],
  [0.024, -0.02],
];

function getFleetLimit() {
  const parsed = Number(process.env.DEVELOPMENT_FLEET_LIMIT);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, 200)
    : DEFAULT_FLEET_LIMIT;
}

function isDevelopmentFleetEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.USE_MEMORY_DB === "true" &&
    process.env.ENABLE_DEVELOPMENT_FLEET === "true"
  );
}

function createVehicleNumber(index) {
  const suffix = randomBytes(2).toString("hex").toUpperCase();
  return `RR-${String(index + 1).padStart(2, "0")}-AB-${suffix}`;
}

function offsetPoint(longitude, latitude, offsetIndex) {
  const [latitudeOffset, longitudeOffset] =
    VEHICLE_OFFSETS[offsetIndex % VEHICLE_OFFSETS.length];
  const adjustedLatitude = Math.max(
    -89.999,
    Math.min(89.999, latitude + latitudeOffset)
  );
  const adjustedLongitude =
    ((((longitude + longitudeOffset + 180) % 360) + 360) % 360) - 180;

  return [adjustedLongitude, adjustedLatitude];
}

async function ensureDevelopmentFleetNear(
  longitude,
  latitude,
  requestedCount = DEFAULT_DEVELOPMENT_FLEET_SIZE
) {
  if (!isDevelopmentFleetEnabled()) return [];

  const coordinates = parseCoordinatePair(longitude, latitude, {
    allowZero: false,
  });
  if (!coordinates.ok) return [];

  const count = Math.max(
    0,
    Math.min(DEFAULT_DEVELOPMENT_FLEET_SIZE, Math.trunc(requestedCount))
  );
  if (!count) return [];

  await Ambulance.createIndexes();

  const existingCount = await Ambulance.countDocuments({
    vehicleNumber: DEVELOPMENT_VEHICLE_PATTERN,
  });
  const createCount = Math.min(count, Math.max(0, getFleetLimit() - existingCount));
  const created = [];

  for (let index = 0; index < createCount; index += 1) {
    const [vehicleLongitude, vehicleLatitude] = offsetPoint(
      coordinates.longitude,
      coordinates.latitude,
      index
    );
    created.push(
      await Ambulance.create({
        vehicleNumber: createVehicleNumber(index),
        driverName: `Response Driver ${index + 1}`,
        driverPhone: "9812345678",
        type: VEHICLE_TYPES[index % VEHICLE_TYPES.length],
        status: "available",
        location: {
          type: "Point",
          coordinates: [vehicleLongitude, vehicleLatitude],
        },
      })
    );
  }

  return created;
}

module.exports = {
  DEFAULT_DEVELOPMENT_FLEET_SIZE,
  ensureDevelopmentFleetNear,
  isDevelopmentFleetEnabled,
};
