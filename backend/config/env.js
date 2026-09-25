require("dotenv").config({ quiet: true });

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        "Copy backend/.env.example to backend/.env and set it before starting the backend."
    );
  }

  return value;
}

function getMongoUri() {
  return requireEnv("MONGO_URI");
}

function getJwtSecret() {
  const secret = requireEnv("JWT_SECRET");
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long in production');
  }
  return secret;
}

function getServerEnv() {
  return {
    MONGO_URI: getMongoUri(),
    JWT_SECRET: getJwtSecret(),
  };
}

module.exports = { getJwtSecret, getMongoUri, getServerEnv, requireEnv };
