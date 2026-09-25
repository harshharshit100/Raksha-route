const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const {
  clearGeocodeCache,
  geocodeAddress,
  normalizeAddress,
} = require("../services/geocoding");

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  clearGeocodeCache();
});

test("address normalization requires a usable free-text address", () => {
  assert.equal(normalizeAddress("  Sector 17,   Chandigarh  "), "Sector 17, Chandigarh");
  assert.equal(normalizeAddress(""), null);
  assert.equal(normalizeAddress("xy"), null);
  assert.equal(normalizeAddress(123), null);
});

test("address lookup returns coordinates and caches repeated searches", async () => {
  let requests = 0;
  let requestedUrl = "";
  global.fetch = async (url) => {
    requests += 1;
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            address: "Sector 17, Chandigarh, Punjab, India",
            location: { x: 76.7794, y: 30.7333 },
            score: 98,
            attributes: {
              Addr_type: "Locality",
              City: "Chandigarh",
              Region: "Punjab",
              Postal: "160017",
            },
          },
        ],
      }),
    };
  };

  const result = await geocodeAddress("Sector 17, Chandigarh");
  assert.equal(result.address, "Sector 17, Chandigarh, Punjab, India");
  assert.equal(result.latitude, 30.7333);
  assert.equal(result.longitude, 76.7794);
  assert.equal(result.cached, false);
  assert.match(requestedUrl, /SingleLine=Sector\+17%2C\+Chandigarh/);

  const cached = await geocodeAddress("sector 17,   chandigarh");
  assert.equal(cached.cached, true);
  assert.equal(requests, 1);
});

test("address lookup returns null when no candidate matches", async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [] }),
  });

  assert.equal(await geocodeAddress("Unknown place"), null);
});
