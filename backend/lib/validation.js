const mongoose = require("mongoose");

const COORDINATE_LIMITS = Object.freeze({
  longitude: Object.freeze({ min: -180, max: 180 }),
  latitude: Object.freeze({ min: -90, max: 90 }),
});

const MAX_DISTANCE_METERS = 20_000_000;
const STRICT_NUMBER_PATTERN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^\+?[0-9](?:[0-9\s().-]*[0-9])?$/;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse a number without JavaScript's permissive Number() coercion.
 * Only finite primitive numbers and strict decimal/exponent strings are accepted.
 */
function parseStrictNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || value.length === 0) return null;
  if (value !== value.trim() || !STRICT_NUMBER_PATTERN.test(value)) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinateFailure(reason) {
  return { ok: false, reason };
}

/**
 * Validate and normalize a GeoJSON pair. The first value is longitude and the
 * second value is latitude; callers should pass them in that order.
 */
function parseCoordinatePair(longitude, latitude, options = {}) {
  const { allowZero = false } = options;
  const lng = parseStrictNumber(longitude);
  const lat = parseStrictNumber(latitude);

  if (lng === null || lat === null) return coordinateFailure("coordinates must be finite numbers or strict numeric strings");
  if (lng < COORDINATE_LIMITS.longitude.min || lng > COORDINATE_LIMITS.longitude.max) {
    return coordinateFailure("longitude must be between -180 and 180");
  }
  if (lat < COORDINATE_LIMITS.latitude.min || lat > COORDINATE_LIMITS.latitude.max) {
    return coordinateFailure("latitude must be between -90 and 90");
  }
  if (!allowZero && lng === 0 && lat === 0) {
    return coordinateFailure("[0, 0] is not a valid user location");
  }

  return {
    ok: true,
    longitude: lng,
    latitude: lat,
    lng,
    lat,
    coordinates: [lng, lat],
  };
}

/**
 * Parse named coordinate fields while enforcing that both halves are present.
 * Both `longitude`/`latitude` and the frontend's `lng`/`lat` aliases are
 * supported, but supplying both aliases for one axis is rejected.
 */
function parseNamedCoordinatePair(input, options = {}) {
  if (!isRecord(input)) return coordinateFailure("coordinates must be an object with longitude and latitude");

  const longitudeKeys = ["longitude", "lng"].filter((key) => hasOwn(input, key));
  const latitudeKeys = ["latitude", "lat"].filter((key) => hasOwn(input, key));

  if (longitudeKeys.length !== 1 || latitudeKeys.length !== 1) {
    return coordinateFailure("both longitude and latitude are required");
  }

  return parseCoordinatePair(input[longitudeKeys[0]], input[latitudeKeys[0]], options);
}

function isValidCoordinatePair(longitude, latitude, options = {}) {
  return parseCoordinatePair(longitude, latitude, options).ok;
}

/**
 * Validate a coordinate array already materialized by Mongoose. Model values
 * must be actual numbers; the request-level parser handles numeric strings.
 */
function isValidCoordinateArray(value, options = {}) {
  const { allowZero = true } = options;
  if (!Array.isArray(value) || value.length !== 2) return false;
  if (typeof value[0] !== "number" || typeof value[1] !== "number") return false;

  return parseCoordinatePair(value[0], value[1], { allowZero }).ok;
}

function validateCoordinateArray(value, options = {}) {
  return isValidCoordinateArray(value, options);
}

function parseDistance(value, options = {}) {
  const {
    defaultValue = 10_000,
    max = MAX_DISTANCE_METERS,
  } = options;

  if (value === undefined) return { ok: true, value: defaultValue };
  const distance = parseStrictNumber(value);
  if (distance === null || distance <= 0 || distance > max) {
    return { ok: false, reason: `distance must be a finite number between 0 and ${max} meters` };
  }
  return { ok: true, value: distance };
}

function normalizeName(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 100 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) return null;
  return normalized;
}

function normalizePhone(value) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  // Must be exactly 10 digits and start with 6, 7, 8, or 9
  if (!/^[6-9][0-9]{9}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function isValidEmail(value) {
  return normalizeEmail(value) !== null;
}

function isValidPhone(value) {
  return normalizePhone(value) !== null;
}

function isValidObjectId(value) {
  if (value !== null && typeof value === "object") {
    if (value._bsontype === "ObjectId" || typeof value.toHexString === "function") {
      return true;
    }
  }
  return typeof value === "string" && /^[0-9a-f]{24}$/i.test(value);
}

function getIdString(value) {
  if (value === undefined || value === null || value === "") return null;

  const candidate =
    typeof value === "object"
      ? value._id ?? value.id ?? (value._bsontype === "ObjectId" || typeof value.toHexString === "function" ? value : null)
      : value;

  if (candidate === undefined || candidate === null || candidate === "") return null;
  if (typeof candidate !== "string" && typeof candidate !== "number" && typeof candidate !== "object") {
    return null;
  }

  const result = String(candidate);
  return result && result !== "[object Object]" ? result : null;
}

function idsEqual(left, right) {
  const leftId = getIdString(left);
  const rightId = getIdString(right);
  return leftId !== null && rightId !== null && leftId === rightId;
}

function isDuplicateKeyError(error) {
  if (!error) return false;
  if (error.code === 11000 || error.code === 11001 || error.code === "11000" || error.code === "11001") {
    return true;
  }
  if (error.keyPattern || error.keyValue) return true;
  return isDuplicateKeyError(error.cause);
}

function isCastError(error) {
  return Boolean(
    error &&
      (error.name === "CastError" ||
        error.name === "BSONError" ||
        (error.kind === "ObjectId" && /cast|invalid/i.test(String(error.message || ""))))
  );
}

function isValidationError(error) {
  return Boolean(error && error.name === "ValidationError");
}

class StrictCoordinateNumber extends mongoose.Schema.Types.Number {
  cast(value) {
    const parsed = parseStrictNumber(value);
    if (parsed === null) {
      throw new mongoose.Error.CastError("StrictNumber", value, "coordinates");
    }
    return parsed;
  }
}

/** Shared Mongoose definition for a finite [longitude, latitude] pair. */
function coordinateField(options = {}) {
  const { required = true, allowZero = true } = options;
  return {
    type: [StrictCoordinateNumber],
    required,
    validate: {
      validator: (value) => isValidCoordinateArray(value, { allowZero }),
      message: "coordinates must be a [longitude, latitude] pair within valid ranges",
    },
  };
}

/** Shared Mongoose GeoJSON point definition without a [0, 0] default. */
function pointField(options = {}) {
  const { required = true, allowZero = true } = options;
  const pointSchema = new mongoose.Schema(
    {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: coordinateField({ required: true, allowZero }),
    },
    { _id: false }
  );

  return {
    type: pointSchema,
    required,
  };
}

module.exports = {
  COORDINATE_LIMITS,
  MAX_DISTANCE_METERS,
  coordinateField,
  getIdString,
  idsEqual,
  isCastError,
  isDuplicateKeyError,
  isRecord,
  isValidCoordinateArray,
  isValidCoordinatePair,
  isValidEmail,
  isValidObjectId,
  isValidPhone,
  isValidationError,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseCoordinatePair,
  parseDistance,
  parseNamedCoordinatePair,
  parseStrictNumber,
  pointField,
  validateCoordinateArray,
};
