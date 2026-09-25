const { geocodeAddress } = require("../services/geocoding");

const geocodeLocation = async (req, res) => {
  try {
    const result = await geocodeAddress(req.query.address);
    if (!result) {
      return res.status(404).json({
        message: "We could not find that address. Add a city, area, or PIN code.",
      });
    }

    return res.json(result);
  } catch (error) {
    if (error?.statusCode === 400 || error?.statusCode === 503) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    console.error("Address lookup failed:", error);
    return res.status(503).json({
      message: "Address lookup is temporarily unavailable",
    });
  }
};

module.exports = { geocodeLocation };
