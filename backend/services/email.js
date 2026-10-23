const nodemailer = require("nodemailer");

let transporter;

function getSmtpUrl() {
  return process.env.SMTP_URL?.trim() || "";
}

function getSmtpHost() {
  return process.env.SMTP_HOST?.trim() || "";
}

/**
 * Whether enough SMTP configuration exists to attempt delivery. The actual
 * connection is only created when an email is sent.
 */
function isEmailDeliveryConfigured() {
  return Boolean(getSmtpUrl() || getSmtpHost());
}

function getSmtpOptions() {
  const url = getSmtpUrl();
  if (url) return url;

  const host = getSmtpHost();
  if (!host) {
    throw new Error("SMTP is not configured");
  }

  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535");
  }

  const secureValue = process.env.SMTP_SECURE?.trim().toLowerCase();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS ?? "";

  return {
    host,
    port,
    secure: secureValue ? secureValue === "true" : port === 465,
    ...(user ? { auth: { user, pass } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(getSmtpOptions());
  }
  return transporter;
}

function getMailFrom() {
  return (
    process.env.MAIL_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "RakshaRoute <no-reply@raksharoute.app>"
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  if (!isEmailDeliveryConfigured()) {
    throw new Error("Email delivery is not configured");
  }

  const displayName = name || "there";
  const subject = "Reset your RakshaRoute password";
  const text = [
    `Hi ${displayName},`,
    "",
    "We received a request to reset your RakshaRoute password.",
    "Open the link below to choose a new password. It expires in 30 minutes",
    "and can only be used once.",
    "",
    resetUrl,
    "",
    "If you did not request this, you can safely ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px;color:#d62828">Reset your password</h2>
      <p style="margin:0 0 12px">Hi ${escapeHtml(displayName)},</p>
      <p style="margin:0 0 20px">
        We received a request to reset your RakshaRoute password. Click the
        button below to choose a new password.
      </p>
      <p style="margin:0 0 20px">
        <a href="${escapeHtml(resetUrl)}"
           style="display:inline-block;padding:12px 20px;border-radius:10px;background:#d62828;color:#ffffff;text-decoration:none;font-weight:bold">
          Reset password
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#64748b">
        This link expires in 30 minutes and can only be used once.
      </p>
      <p style="margin:0;font-size:13px;color:#64748b">
        If you did not request this, you can safely ignore this email.
      </p>
    </div>
  `;

  await getTransporter().sendMail({
    from: getMailFrom(),
    to,
    subject,
    text,
    html,
  });
}

module.exports = {
  isEmailDeliveryConfigured,
  sendPasswordResetEmail,
};
