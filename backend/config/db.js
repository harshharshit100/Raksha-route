const mongoose = require("mongoose");
const { getMongoUri } = require("./env");

async function connectDB() {
  // Keep initial connection as one explicit attempt. The supported server
  // entrypoint handles failure; retry loops here would leave startup hanging.
  await mongoose.connect(getMongoUri());
}

function isDatabaseReady() {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}

module.exports = connectDB;
module.exports.isDatabaseReady = isDatabaseReady;
