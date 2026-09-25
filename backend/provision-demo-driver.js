// Creates a demo driver account so /api/ambulances/register can be used.
// Credentials are intentionally supplied through the environment and are
// never printed. Run with: DEMO_DRIVER_PASSWORD=... node provision-demo-driver.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const { getMongoUri, requireEnv } = require("./config/env");

const DEMO_DRIVER = {
  email: (process.env.DEMO_DRIVER_EMAIL || "driver@raksharoute.demo").trim().toLowerCase(),
  password: requireEnv("DEMO_DRIVER_PASSWORD"),
  name: (process.env.DEMO_DRIVER_NAME || "Demo Driver").trim(),
  phone: (process.env.DEMO_DRIVER_PHONE || "9999999999").trim(),
};

async function run() {
  await mongoose.connect(getMongoUri());

  try {
    // One atomic upsert makes concurrent provisioning safe and preserves any
    // existing account rather than resetting its password or role.
    const result = await User.updateOne(
      { email: DEMO_DRIVER.email },
      {
        $setOnInsert: {
          name: DEMO_DRIVER.name,
          email: DEMO_DRIVER.email,
          password: await bcrypt.hash(DEMO_DRIVER.password, 10),
          phone: DEMO_DRIVER.phone,
          role: "driver",
        },
      },
      { upsert: true }
    );

    if (result.upsertedCount) {
      console.log(`Created driver account: ${DEMO_DRIVER.email}`);
    } else {
      console.log(`Driver account already exists: ${DEMO_DRIVER.email}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
