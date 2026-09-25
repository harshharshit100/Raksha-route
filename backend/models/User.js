const mongoose = require("mongoose");
const {
  isValidEmail,
  isValidPhone,
  pointField,
} = require("../lib/validation");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      validate: {
        validator: isValidEmail,
        message: "Please provide a valid email address",
      },
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      maxlength: 128,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 32,
      validate: {
        validator: isValidPhone,
        message: "Please provide a valid phone number",
      },
    },

    role: {
      type: String,
      enum: ["patient", "driver", "admin"],
      default: "patient",
    },

    // A user does not have a location until one is explicitly supplied. In
    // particular, do not create a misleading [0, 0] placeholder.
    location: pointField({ required: false, allowZero: true }),
  },
  {
    timestamps: true,
  }
);

userSchema.index({
  location: "2dsphere",
});

module.exports = mongoose.model("User", userSchema);
