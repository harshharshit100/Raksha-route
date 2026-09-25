const express = require("express");
const { geocodeLocation } = require("../controllers/locationController");
const protect = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/geocode", protect, geocodeLocation);

module.exports = router;
