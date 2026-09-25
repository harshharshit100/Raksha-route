// Seeds demo ambulances near Chandigarh so "Find Nearby Ambulance" has data.
// Safe to re-run. Run with: node seed.js
const mongoose = require("mongoose");
const Ambulance = require("./models/ambulance");
const { getMongoUri } = require("./config/env");

const DEMO_AMBULANCES = [
  { vehicleNumber: "CH-01-AB-1234", driverName: "Raj Kumar", driverPhone: "9812345678", type: "Basic", lat: 30.7465, lng: 76.792 },
  { vehicleNumber: "CH-02-AB-5678", driverName: "Aman Singh", driverPhone: "9812345098", type: "Advanced", lat: 30.7218, lng: 76.8019 },
  { vehicleNumber: "CH-03-AB-9012", driverName: "Naveen Sharma", driverPhone: "9812345566", type: "ICU", lat: 30.7455, lng: 76.7577 },
];

async function seedDemoAmbulances() {
  // $geoNear requires the 2dsphere index. Model index creation is asynchronous
  // by default, so wait for it before the first seeded search can run.
  await Ambulance.createIndexes();

  // Atomic upserts avoid the check-then-create race in concurrent seed runs.
  return Ambulance.bulkWrite(
    DEMO_AMBULANCES.map((ambulance) => ({
      updateOne: {
        filter: { vehicleNumber: ambulance.vehicleNumber },
        update: {
          $setOnInsert: {
            vehicleNumber: ambulance.vehicleNumber,
            driverName: ambulance.driverName,
            driverPhone: ambulance.driverPhone,
            type: ambulance.type,
            status: "available",
            location: { type: "Point", coordinates: [ambulance.lng, ambulance.lat] },
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

async function seed() {
  await mongoose.connect(getMongoUri());

  try {
    const result = await seedDemoAmbulances();
    console.log(`Done. ${result.upsertedCount} ambulance(s) added.`);
    return result;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  seed().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEMO_AMBULANCES,
  seed,
  seedDemoAmbulances,
};
