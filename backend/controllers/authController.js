const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { isDatabaseReady } = require("../config/db");
const { getJwtSecret } = require("../config/env");
const {
  isDuplicateKeyError,
  isRecord,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} = require("../lib/validation");

const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;

function isDatabaseUnavailableError(error) {
  if (!isDatabaseReady()) return true;

  return (
    error?.name === "MongoNetworkError" ||
    error?.name === "MongoServerSelectionError" ||
    (error?.name === "MongooseError" &&
      /buffering timed out/i.test(error?.message || ""))
  );
}

function getRequestBody(req) {
  return isRecord(req?.body) ? req.body : {};
}

function issueToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    getJwtSecret(),
    {
      expiresIn: "7d",
    }
  );
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

// REGISTER
const registerUser = async (req, res) => {
  try {
    const body = getRequestBody(req);
    const name = normalizeName(body.name);
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone);
    const password = body.password;

    // Keep the established required-fields response while making missing or
    // malformed body values safe to handle.
    if (
      !name ||
      !email ||
      !phone ||
      typeof password !== "string" ||
      password.length < PASSWORD_MIN_LENGTH ||
      password.length > PASSWORD_MAX_LENGTH
    ) {
      if (
        body.name === undefined &&
        body.email === undefined &&
        body.password === undefined &&
        body.phone === undefined
      ) {
        return res.status(400).json({
          message: "Please fill all required fields",
        });
      }

      return res.status(400).json({ message: "Invalid registration details" });
    }

    if (!isDatabaseReady()) {
      return res.status(503).json({
        message: "Registration service temporarily unavailable. Please try again shortly.",
      });
    }

    // Check existing user using the same normalized value that will be saved.
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Role is never taken from the public request body, so users cannot
    // self-register as an admin or driver.
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      phone,
    });

    res.status(201).json({
      message: "User registered successfully",
      token: issueToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({ message: "User already exists" });
    }

    if (isDatabaseUnavailableError(error)) {
      console.error("Registration database lookup failed:", error);
      return res.status(503).json({
        message: "Registration service temporarily unavailable. Please try again shortly.",
      });
    }

    console.error("Registration failed", error);
    return res.status(500).json({ message: "Registration failed" });
  }
};

// LOGIN
const loginUser = async (req, res) => {
  try {
    const body = getRequestBody(req);
    const email = normalizeEmail(body.email);
    const password = body.password;

    if (!email || typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    if (!isDatabaseReady()) {
      return res.status(503).json({
        message: "Login service temporarily unavailable. Please try again shortly.",
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    res.json({
      message: "Login successful",
      token: issueToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.error("Login database lookup failed:", error);
      return res.status(503).json({
        message: "Login service temporarily unavailable. Please try again shortly.",
      });
    }

    console.error("Login failed", error);
    return res.status(500).json({ message: "Login failed" });
  }
};

module.exports = {
  registerUser,
  loginUser,
};
