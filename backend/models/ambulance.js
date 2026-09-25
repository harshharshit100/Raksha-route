const mongoose = require("mongoose");
const {
  isValidPhone,
  pointField,
} = require("../lib/validation");

const ambulanceSchema = new mongoose.Schema(
  {
    vehicleNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 1,
      maxlength: 32,
    },

    driverName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },

    driverPhone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 32,
      validate: {
        validator: isValidPhone,
        message: "Please provide a valid driver phone number",
      },
    },

    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    type: {
      type: String,
      enum: ["Basic", "Advanced", "ICU"],
      default: "Basic",
    },

    status: {
      type: String,
      enum: ["available", "busy", "offline"],
      default: "available",
    },

    location: pointField({ required: true, allowZero: true }),
  },
  {
    timestamps: true,
  }
);

ambulanceSchema.index({
  location: "2dsphere",
});

module.exports = mongoose.model("Ambulance", ambulanceSchema);
