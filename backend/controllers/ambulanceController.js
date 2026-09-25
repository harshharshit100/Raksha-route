const Ambulance = require("../models/ambulance");
const developmentFleet = require("../services/developmentFleet");
const {
  computeEta,
  heuristicMinutes,
  haversineMeters,
} = require("../lib/eta");
const {
  getIdString,
  idsEqual,
  isCastError,
  isDuplicateKeyError,
  isRecord,
  isValidCoordinateArray,
  isValidObjectId,
  isValidationError,
  normalizeName,
  normalizePhone,
  parseCoordinatePair,
  parseDistance,
  parseNamedCoordinatePair,
} = require("../lib/validation");

const AMBULANCE_TYPES = new Set(["Basic", "Advanced", "ICU"]);

// Only fields required to choose and dispatch a nearby vehicle are public.
// In particular, driver identity and phone numbers must never reach this route.
const PUBLIC_NEARBY_PROJECTION = Object.freeze({
  _id: 1,
  vehicleNumber: 1,
  type: 1,
  status: 1,
  location: 1,
  distance: 1,
});

function getRequestBody(req) {
  return isRecord(req?.body) ? req.body : {};
}

function getRequestQuery(req) {
  return isRecord(req?.query) ? req.query : {};
}

function getRequestId(req) {
  const id = req?.params?.id;
  return isValidObjectId(id) ? id : null;
}

function parseUserCoordinates(longitude, latitude) {
  return parseCoordinatePair(longitude, latitude, { allowZero: false });
}

function parseUserQueryCoordinates(query) {
  return parseNamedCoordinatePair(
    { longitude: query.longitude, latitude: query.latitude },
    { allowZero: false }
  );
}

function normalizeVehicleNumber(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > 32) return null;
  return normalized;
}

function normalizeAmbulanceType(value) {
  if (value === undefined) return "Basic";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (AMBULANCE_TYPES.has(normalized)) return normalized;

  const titleCased = normalized[0].toUpperCase() + normalized.slice(1).toLowerCase();
  return AMBULANCE_TYPES.has(titleCased) ? titleCased : null;
}

function publicLocation(location) {
  if (!isValidCoordinateArray(location?.coordinates, { allowZero: true })) return null;
  const [longitude, latitude] = location.coordinates;
  return {
    type: "Point",
    coordinates: [longitude, latitude],
  };
}

function toPublicNearbyAmbulance(ambulance) {
  const location = publicLocation(ambulance?.location);
  if (!location) return null;

  const result = {
    _id: ambulance._id,
    vehicleNumber: ambulance.vehicleNumber,
    type: ambulance.type,
    status: ambulance.status,
    location,
  };

  if (Number.isFinite(ambulance.distance)) {
    result.distance = ambulance.distance;
  }
  if (Number.isFinite(ambulance.etaMinutes) && ambulance.etaMinutes >= 0) {
    result.etaMinutes = ambulance.etaMinutes;
    if (typeof ambulance.etaSource === "string") {
      result.etaSource = ambulance.etaSource;
    }
  }

  return result;
}

function findAvailableAmbulances(coordinates, maxDistance) {
  return Ambulance.aggregate([
    {
      $geoNear: {
        near: {
          type: "Point",
          coordinates,
        },
        distanceField: "distance",
        maxDistance,
        spherical: true,
        query: {
          status: "available",
        },
      },
    },
    {
      $project: { ...PUBLIC_NEARBY_PROJECTION },
    },
  ]);
}

// Register ambulance
const registerAmbulance = async (req, res) => {
  try {
    const body = getRequestBody(req);
    const vehicleNumber = normalizeVehicleNumber(body.vehicleNumber);
    const driverName = normalizeName(body.driverName);
    const driverPhone = normalizePhone(body.driverPhone);
    const type = normalizeAmbulanceType(body.type);
    const coordinates = parseUserCoordinates(body.longitude, body.latitude);
    const driverId = req.user?._id ?? req.user?.id;

    if (
      !vehicleNumber ||
      !driverName ||
      !driverPhone ||
      !type ||
      !coordinates.ok ||
      !driverId
    ) {
      return res.status(400).json({
        message: "Please provide valid ambulance details",
      });
    }

    // Normalized (uppercase) duplicate check. The create error is handled below
    // as well, because another request can win the race after this check.
    const existingAmbulance = await Ambulance.findOne({ vehicleNumber });
    if (existingAmbulance) {
      return res.status(409).json({ message: "Ambulance already registered" });
    }

    const ambulance = await Ambulance.create({
      vehicleNumber,
      driverName,
      driverPhone,
      type,
      status: "available",
      driver: driverId,
      location: {
        type: "Point",
        coordinates: coordinates.coordinates,
      },
    });

    res.status(201).json({
      message: "Ambulance registered successfully",
      ambulance,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({ message: "Ambulance already registered" });
    }
    if (isCastError(error) || isValidationError(error)) {
      return res.status(400).json({ message: "Invalid ambulance details" });
    }

    console.error("Ambulance registration failed", error);
    return res.status(500).json({ message: "Ambulance registration failed" });
  }
};

// Find nearby ambulances
const getNearbyAmbulances = async (req, res) => {
  try {
    const query = getRequestQuery(req);
    const coordinates = parseUserQueryCoordinates(query);
    if (!coordinates.ok) {
      return res.status(400).json({ message: "Valid latitude and longitude are required" });
    }

    const distance = parseDistance(query.distance);
    if (!distance.ok) {
      return res.status(400).json({ message: "Invalid search distance" });
    }

    let rawAmbulances = await findAvailableAmbulances(
      coordinates.coordinates,
      distance.value
    );

    if (!Array.isArray(rawAmbulances)) {
      return res.status(500).json({ message: "Unable to find nearby ambulances" });
    }

    let developmentFleetAdded = false;
    const missingFleetCount = Math.max(
      0,
      developmentFleet.DEFAULT_DEVELOPMENT_FLEET_SIZE - rawAmbulances.length
    );
    if (
      missingFleetCount > 0 &&
      developmentFleet.isDevelopmentFleetEnabled()
    ) {
      try {
        const createdAmbulances =
          await developmentFleet.ensureDevelopmentFleetNear(
            coordinates.longitude,
            coordinates.latitude,
            missingFleetCount
          );
        if (createdAmbulances.length > 0) {
          developmentFleetAdded = true;
          rawAmbulances = await findAvailableAmbulances(
            coordinates.coordinates,
            distance.value
          );
        }
      } catch (error) {
        // Local fleet provisioning must never turn an otherwise valid search
        // into an API error. The normal result is still useful.
        console.error("Development fleet provisioning failed:", error);
      }
    }

    if (!Array.isArray(rawAmbulances)) {
      return res.status(500).json({ message: "Unable to find nearby ambulances" });
    }

    // ETA for every result. Road routing for the nearest few (concurrent,
    // cached, never fails), straight-line heuristic for the rest.
    const etaTarget = { lng: coordinates.longitude, lat: coordinates.latitude };

    await Promise.allSettled(
      rawAmbulances.slice(0, 5).map(async (ambulance) => {
        if (!isValidCoordinateArray(ambulance?.location?.coordinates, { allowZero: true })) return;
        const [longitude, latitude] = ambulance.location.coordinates;
        const eta = await computeEta({
          from: { lng: longitude, lat: latitude },
          to: etaTarget,
        });
        if (eta && Number.isFinite(eta.minutes) && eta.minutes >= 0) {
          ambulance.etaMinutes = eta.minutes;
          ambulance.etaSource = eta.source;
        }
      })
    );

    for (const ambulance of rawAmbulances) {
      if (ambulance.etaMinutes != null) continue;
      if (!isValidCoordinateArray(ambulance?.location?.coordinates, { allowZero: true })) continue;
      const [longitude, latitude] = ambulance.location.coordinates;
      const minutes = heuristicMinutes(
        haversineMeters({ lng: longitude, lat: latitude }, etaTarget)
      );
      if (minutes != null && Number.isFinite(minutes) && minutes >= 0) {
        ambulance.etaMinutes = minutes;
        ambulance.etaSource = "estimated";
      }
    }

    // Rebuild each result from an allow-list. This protects the endpoint even
    // if a mocked/legacy aggregate accidentally returns extra fields.
    const ambulances = rawAmbulances
      .map(toPublicNearbyAmbulance)
      .filter(Boolean);

    res.json({
      count: ambulances.length,
      ambulances,
      ...(developmentFleetAdded
        ? { developmentFleetAdded: true }
        : {}),
    });
  } catch (error) {
    if (isCastError(error) || isValidationError(error)) {
      return res.status(400).json({ message: "Invalid nearby search" });
    }

    console.error("Nearby ambulance search failed", error);
    return res.status(500).json({ message: "Unable to find nearby ambulances" });
  }
};

// GET ALL AMBULANCES (fleet view)
const getAllAmbulances = async (req, res) => {
  try {
    const ambulances = await Ambulance.find().sort({ createdAt: -1 });
    res.json({ ambulances });
  } catch (error) {
    if (isCastError(error) || isValidationError(error)) {
      return res.status(400).json({ message: "Invalid ambulance fleet request" });
    }

    console.error("Ambulance fleet lookup failed", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// UPDATE AMBULANCE LOCATION (live tracking / simulate)
const updateAmbulanceLocation = async (req, res) => {
  try {
    const id = getRequestId(req);
    if (!id) {
      return res.status(400).json({ message: "Invalid ambulance id" });
    }

    const body = getRequestBody(req);
    const coordinates = parseUserCoordinates(body.longitude, body.latitude);
    if (!coordinates.ok) {
      return res.status(400).json({ message: "Valid latitude and longitude are required" });
    }

    const ambulance = await Ambulance.findById(id);
    if (!ambulance) {
      return res.status(404).json({ message: "Ambulance not found" });
    }

    const role = req.user?.role;
    if (role !== "admin" && role !== "driver") {
      return res.status(403).json({ message: "Not authorized" });
    }
    if (role === "driver" && !idsEqual(ambulance.driver, getIdString(req.user))) {
      return res.status(403).json({ message: "Not authorized to update this ambulance" });
    }

    const location = {
      type: "Point",
      coordinates: coordinates.coordinates,
    };
    ambulance.location = location;
    await ambulance.save();

    // This is intentionally a minimal, non-personal fleet event. Never add
    // driver/user linkage or phone fields to the broadcast payload.
    const { emit } = require("../config/socket");
    emit("ambulance:location", {
      _id: ambulance._id,
      location: { type: "Point", coordinates: coordinates.coordinates },
    });

    res.status(200).json({
      message: "Location updated",
      ambulance,
    });
  } catch (error) {
    if (isCastError(error) || isValidationError(error)) {
      return res.status(400).json({ message: "Invalid location or ambulance id" });
    }

    console.error("Ambulance location update failed", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// ETA for a single ambulance → a destination point (road, with fallback)
const getAmbulanceEta = async (req, res) => {
  try {
    const id = getRequestId(req);
    if (!id) {
      return res.status(400).json({ message: "Invalid ambulance id" });
    }

    const query = getRequestQuery(req);
    const coordinates = parseNamedCoordinatePair(
      { lng: query.lng, lat: query.lat },
      { allowZero: false }
    );
    if (!coordinates.ok) {
      return res.status(400).json({ message: "Valid destination latitude and longitude are required" });
    }

    const ambulance = await Ambulance.findById(id);
    if (!ambulance) {
      return res.status(404).json({ message: "Ambulance not found" });
    }
    if (!isValidCoordinateArray(ambulance.location?.coordinates, { allowZero: true })) {
      return res.status(400).json({ message: "Ambulance location is invalid" });
    }

    const [ambulanceLongitude, ambulanceLatitude] = ambulance.location.coordinates;
    const eta = await computeEta({
      from: { lng: ambulanceLongitude, lat: ambulanceLatitude },
      to: { lng: coordinates.longitude, lat: coordinates.latitude },
    });

    res.json({ ambulance: ambulance._id, eta });
  } catch (error) {
    if (isCastError(error) || isValidationError(error)) {
      return res.status(400).json({ message: "Invalid ambulance ETA request" });
    }

    console.error("Ambulance ETA lookup failed", error);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  PUBLIC_NEARBY_PROJECTION,
  getAllAmbulances,
  getAmbulanceEta,
  getNearbyAmbulances,
  registerAmbulance,
  toPublicNearbyAmbulance,
  updateAmbulanceLocation,
};
