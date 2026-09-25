const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getJwtSecret } = require("../config/env");

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const [scheme, token, extra] = String(authHeader || "").trim().split(/\s+/);

  if (scheme?.toLowerCase() !== "bearer" || !token || extra) {
    return res.status(401).json({
      message: "Not authorized. Please login.",
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret());
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }

  if (!decoded?.id) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }

  let user;
  try {
    user = await User.findById(decoded.id).select("-password");
  } catch (error) {
    // A malformed signed identifier is still an invalid credential. Other
    // lookup failures are infrastructure errors and must not log users out.
    if (error?.name === "CastError") {
      return res.status(401).json({
        message: "Invalid or expired token",
      });
    }

    console.error("Authentication database lookup failed:", error);
    return res.status(503).json({
      message: "Authentication service temporarily unavailable",
    });
  }

  if (!user) {
    return res.status(401).json({
      message: "User no longer exists",
    });
  }

  req.user = user;
  return next();
};

// Restrict a route to specific roles
const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      message: "Not authorized",
    });
  }
  return next();
};

module.exports = protect;
module.exports.authorize = authorize;
