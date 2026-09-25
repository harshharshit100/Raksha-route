const mongoose = require("mongoose");
const {
  isValidPhone,
  pointField,
} = require("../lib/validation");

const bookingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    ambulance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ambulance",
      required: true,
    },

    pickupLocation: pointField({ required: true, allowZero: true }),

    pickupAddress: {
      type: String,
      trim: true,
      maxlength: 300,
    },

    destination: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 300,
    },

    patientName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },

    patientPhone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 32,
      validate: {
        validator: isValidPhone,
        message: "Please provide a valid patient phone number",
      },
    },

    status: {
      type: String,
      enum: ["confirmed", "ongoing", "completed", "cancelled"],
      default: "confirmed",
    },
  },
  {
    timestamps: true,
  }
);

bookingSchema.index({
  pickupLocation: "2dsphere",
});

module.exports = mongoose.model("Booking", bookingSchema);
