// Shared CORS origin policy for the Express HTTP layer and Socket.IO.
//
// CORS_ORIGIN can be a single origin or a comma-separated list, e.g.
//   CORS_ORIGIN=https://raksha-route-odfi.vercel.app,https://preview.vercel.app
// Development defaults to "*" for convenience. Production must explicitly
// allow one or more concrete origins.

function getCorsOrigins() {
  const raw = process.env.CORS_ORIGIN?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!raw && isProduction) {
    throw new Error(
      "CORS_ORIGIN is required in production and must list allowed frontend origins"
    );
  }

  const origins = (raw || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (isProduction && (!origins.length || origins.includes("*"))) {
    throw new Error("CORS_ORIGIN must not contain '*' in production");
  }

  if (!origins.length) return "*";
  return origins.includes("*") ? "*" : origins;
}

module.exports = { getCorsOrigins };
