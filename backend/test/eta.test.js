const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const {
  computeEta,
  heuristicMinutes,
  isRoadRoutingEnabled,
  roadMinutes,
} = require("../lib/eta");

const originalFetch = global.fetch;
const originalRoadRoutingEnabled = process.env.ROAD_ROUTING_ENABLED;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalRoadRoutingEnabled === undefined) {
    delete process.env.ROAD_ROUTING_ENABLED;
  } else {
    process.env.ROAD_ROUTING_ENABLED = originalRoadRoutingEnabled;
  }
});

test("zero-distance ETA is an immediate arrival", async () => {
  delete process.env.ROAD_ROUTING_ENABLED;
  const point = { lng: 76.7794, lat: 30.7333 };

  assert.equal(heuristicMinutes(0), 0);
  assert.deepEqual(await computeEta({ from: point, to: point }), {
    minutes: 0,
    source: "estimated",
  });
});

test("third-party road routing is disabled by default", async () => {
  delete process.env.ROAD_ROUTING_ENABLED;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error("network should not be called");
  };

  const eta = await roadMinutes(
    { lng: 76.7794, lat: 30.7333 },
    { lng: 76.7894, lat: 30.7433 }
  );

  assert.equal(eta, null);
  assert.equal(calls, 0);
  assert.equal(isRoadRoutingEnabled(), false);
});

test("enabled road routing shares concurrent identical requests", async () => {
  process.env.ROAD_ROUTING_ENABLED = "true";
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {
      ok: true,
      async json() {
        return { routes: [{ duration: 600 }] };
      },
    };
  };

  const from = { lng: 72.5791, lat: 23.0198 };
  const to = { lng: 72.5891, lat: 23.0298 };
  const [first, second] = await Promise.all([
    roadMinutes(from, to),
    roadMinutes(from, to),
  ]);

  assert.equal(first, 10);
  assert.equal(second, 10);
  assert.equal(calls, 1);
});
