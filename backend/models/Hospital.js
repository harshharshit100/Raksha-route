const mongoose = require("mongoose");
const {
  isValidPhone,
  pointField,
} = require("../lib/validation");

const hospitalSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 150,
    },

    address: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 300,
    },

    phone: {
      type: String,
      trim: true,
      maxlength: 32,
      validate: {
        validator: isValidPhone,
        message: "Please provide a valid hospital phone number",
      },
    },

    location: pointField({ required: true, allowZero: true }),
  },
  {
    timestamps: true,
  }
);

hospitalSchema.index({
  location: "2dsphere",
});

module.exports = mongoose.model("Hospital", hospitalSchema);
