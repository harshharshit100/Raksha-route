const crypto = require("node:crypto");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { isDatabaseReady } = require("../config/db");
const { getFrontendUrl, getJwtSecret } = require("../config/env");
const {
  isDuplicateKeyError,
  isRecord,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} = require("../lib/validation");
const {
  isEmailDeliveryConfigured,
  sendPasswordResetEmail,
} = require("../services/email");

const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const PASSWORD_RESET_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

const PASSWORD_RESET_RESPONSE = {
  message:
    "If an account exists for that email, password reset instructions have been sent.",
};

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

function hashPasswordResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildPasswordResetUrl(token) {
  return `${getFrontendUrl()}/reset-password?token=${token}`;
}

// Returning the link lets local development and demos complete the flow even
// when SMTP is not configured. Production only ever emails it.
function canExposeResetLink() {
  return process.env.NODE_ENV !== "production";
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

// FORGOT PASSWORD
const forgotPassword = async (req, res) => {
  try {
    const body = getRequestBody(req);
    const email = normalizeEmail(body.email);

    if (!email) {
      return res.status(400).json({ message: "Please enter a valid email address" });
    }

    if (!isDatabaseReady()) {
      return res.status(503).json({
        message:
          "Password reset service temporarily unavailable. Please try again shortly.",
      });
    }

    const user = await User.findOne({ email });

    // Always return the same response so this endpoint cannot be used to check
    // whether an email address has an account.
    if (!user) {
      return res.json(PASSWORD_RESET_RESPONSE);
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.passwordResetToken = hashPasswordResetToken(token);
    user.passwordResetExpires = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    await user.save();

    const resetUrl = buildPasswordResetUrl(token);
    let delivered = false;

    if (isEmailDeliveryConfigured()) {
      try {
        await sendPasswordResetEmail({
          to: user.email,
          name: user.name,
          resetUrl,
        });
        delivered = true;
      } catch (error) {
        // A delivery failure must not reveal whether the account exists.
        console.error("Password reset email failed:", error?.message || error);
      }
    }

    if (!delivered && canExposeResetLink()) {
      console.log(`Password reset link for ${user.email}: ${resetUrl}`);
      return res.json({ ...PASSWORD_RESET_RESPONSE, devResetUrl: resetUrl });
    }

    if (!delivered) {
      console.error(
        "Password reset email was not delivered. Configure SMTP_URL or " +
          "SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS."
      );
    }

    return res.json(PASSWORD_RESET_RESPONSE);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.error("Password reset database lookup failed:", error);
      return res.status(503).json({
        message:
          "Password reset service temporarily unavailable. Please try again shortly.",
      });
    }

    console.error("Forgot password failed", error);
    return res.status(500).json({
      message: "Password reset failed. Please try again.",
    });
  }
};

// RESET PASSWORD
const resetPassword = async (req, res) => {
  try {
    const body = getRequestBody(req);
    const token =
      typeof body.token === "string" ? body.token.trim().toLowerCase() : "";
    const password = body.password;

    if (!PASSWORD_RESET_TOKEN_PATTERN.test(token)) {
      return res.status(400).json({
        message: "This reset link is invalid or has expired. Please request a new one.",
      });
    }

    if (
      typeof password !== "string" ||
      password.length < PASSWORD_MIN_LENGTH ||
      password.length > PASSWORD_MAX_LENGTH
    ) {
      return res.status(400).json({
        message: `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`,
      });
    }

    if (!isDatabaseReady()) {
      return res.status(503).json({
        message:
          "Password reset service temporarily unavailable. Please try again shortly.",
      });
    }

    const user = await User.findOne({
      passwordResetToken: hashPasswordResetToken(token),
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        message: "This reset link is invalid or has expired. Please request a new one.",
      });
    }

    user.password = await bcrypt.hash(password, 10);
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    // Log the user in right away: the reset token proved ownership of the
    // email address and the new password was just set by this request.
    res.json({
      message: "Password reset successfully",
      token: issueToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.error("Password reset database write failed:", error);
      return res.status(503).json({
        message:
          "Password reset service temporarily unavailable. Please try again shortly.",
      });
    }

    console.error("Reset password failed", error);
    return res.status(500).json({
      message: "Password reset failed. Please try again.",
    });
  }
};

module.exports = {
  forgotPassword,
  loginUser,
  registerUser,
  resetPassword,
};
