const { parseCoordinatePair } = require("../lib/validation");

const ARCGIS_GEOCODER_URL =
  "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";
const REQUEST_TIMEOUT_MS = 7000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 250;
const cache = new Map();

function normalizeAddress(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length < 3 ||
    normalized.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function cacheKey(address) {
  return address.toLocaleLowerCase("en");
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function getCached(key) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt > Date.now()) return cached.value;
  cache.delete(key);
  return null;
}

function setCached(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function geocodeAddress(value) {
  const address = normalizeAddress(value);
  if (!address) {
    const error = new Error("Enter a valid pickup address");
    error.statusCode = 400;
    throw error;
  }

  const key = cacheKey(address);
  const cached = getCached(key);
  if (cached) return { ...cached, cached: true };

  const params = new URLSearchParams({
    SingleLine: address,
    f: "json",
    maxLocations: "5",
    outFields: "Match_addr,Addr_type,City,Region,Postal,Country",
  });

  let data;
  try {
    data = await fetchJson(`${ARCGIS_GEOCODER_URL}?${params}`);
  } catch {
    const error = new Error("Address lookup is temporarily unavailable");
    error.statusCode = 503;
    throw error;
  }

  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const coordinates = parseCoordinatePair(
      candidate?.location?.x,
      candidate?.location?.y,
      { allowZero: false }
    );
    if (!coordinates.ok) continue;

    const result = {
      address: candidate.address || address,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      matchType: candidate.attributes?.Addr_type || "Address",
      city: candidate.attributes?.City || "",
      region: candidate.attributes?.Region || "",
      postalCode: candidate.attributes?.Postal || "",
    };
    setCached(key, result);
    return { ...result, cached: false };
  }

  return null;
}

function clearGeocodeCache() {
  cache.clear();
}

module.exports = {
  clearGeocodeCache,
  geocodeAddress,
  normalizeAddress,
};
