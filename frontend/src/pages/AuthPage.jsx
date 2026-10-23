import { useState } from "react";
import { Link, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  MailCheck,
  MapPin,
  ShieldCheck,
  Timer,
} from "lucide-react";
import API, { isApiConnectionError } from "../api";
import { useAuth } from "../components/AuthContext";
import { Button, Field } from "../components/ui";
import { AmbulanceMark } from "../components/Logo";
import { toast } from "../lib/toast";

function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-12 text-white lg:flex lg:w-1/2 lg:flex-col lg:justify-between">
      <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-white/5" />

      <Link to="/" className="relative inline-flex items-center gap-2.5">
        <span className="grid size-10 place-items-center rounded-xl bg-white text-brand-600 shadow-lg">
          <AmbulanceMark className="size-6" />
        </span>
        <span className="text-xl font-extrabold tracking-tight">RakshaRoute</span>
      </Link>

      <div className="relative">
        <h2 className="max-w-md text-4xl font-black leading-tight tracking-tight">
          Emergency care, one tap away.
        </h2>
        <p className="mt-4 max-w-sm text-brand-100/90">
          Login to find the nearest ambulance, book instantly, and track your
          trip to the hospital — live.
        </p>

        <div className="mt-9 space-y-4">
          {[
            { icon: MapPin, text: "Nearest ambulances on a live map" },
            { icon: Timer, text: "Confirmed trips with live status" },
            { icon: ShieldCheck, text: "GPS tracking from pickup to hospital" },
          ].map((item) => (
            <div key={item.text} className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-white/15">
                <item.icon className="size-4.5" />
              </span>
              <p className="text-sm font-medium text-brand-50">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="relative text-sm text-brand-200">
        108 — National Emergency Helpline · Available 24/7
      </p>
    </div>
  );
}

const TITLES = {
  login: "Welcome back",
  register: "Create your account",
  forgot: "Forgot your password?",
  reset: "Choose a new password",
};

const SUBTITLES = {
  login: "Login to book the nearest ambulance in seconds.",
  register: "It takes less than a minute — be ready for any emergency.",
  forgot:
    "Enter the email linked to your account and we'll send you a reset link.",
  reset: "Pick a new password for your RakshaRoute account.",
};

function getResetTokenFromUrl(url) {
  try {
    return new URL(url).searchParams.get("token") || "";
  } catch {
    return "";
  }
}

export default function AuthPage({ mode }) {
  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";

  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "find";
  const resetToken = params.get("token") || "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [devResetUrl, setDevResetUrl] = useState("");
  const [loading, setLoading] = useState(false);

  if (user && !isReset) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setDevResetUrl("");

    if (isReset && !resetToken) {
      setError("This reset link is missing its token. Please request a new link.");
      return;
    }

    if ((isReset || isRegister) && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      if (isForgot) {
        const { data } = await API.post("/api/auth/forgot-password", { email });
        setNotice(
          data?.message ||
            "If an account exists for that email, password reset instructions have been sent."
        );
        if (typeof data?.devResetUrl === "string" && data.devResetUrl) {
          setDevResetUrl(data.devResetUrl);
        }
        return;
      }

      if (isReset) {
        const { data } = await API.post("/api/auth/reset-password", {
          token: resetToken,
          password,
        });

        if (
          typeof data?.token !== "string" ||
          !data.token ||
          !data.user ||
          typeof data.user.name !== "string"
        ) {
          throw new Error("The server returned an invalid authentication response.");
        }

        localStorage.setItem("raksharoute_token", data.token);
        login(data.user);
        toast(`Password updated — welcome back, ${data.user.name.split(" ")[0]}!`, "success");
        navigate("/dashboard", { replace: true });
        return;
      }

      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
      const body = isLogin
        ? { email, password }
        : { name, email, password, phone };

      const { data } = await API.post(endpoint, body);

      if (
        typeof data?.token !== "string" ||
        !data.token ||
        !data.user ||
        typeof data.user.name !== "string"
      ) {
        throw new Error("The server returned an invalid authentication response.");
      }

      localStorage.setItem("raksharoute_token", data.token);
      login(data.user);

      toast(
        isLogin
          ? `Welcome back, ${data.user.name.split(" ")[0]}!`
          : "Account created — welcome to RakshaRoute!",
        "success"
      );
      navigate(`/dashboard?focus=${next}`);
    } catch (err) {
      if (isApiConnectionError(err)) {
        setError("Cannot connect to backend. Ensure the server is reachable.");
      } else {
        setError(
          err.response?.data?.message ||
            err.message ||
            "Something went wrong. Please try again."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const submitLabel = isLogin
    ? "Login to RakshaRoute"
    : isRegister
      ? "Create account"
      : isForgot
        ? "Send reset link"
        : "Reset password";

  const loadingLabel = isLogin
    ? "Logging in…"
    : isRegister
      ? "Creating account…"
      : isForgot
        ? "Sending link…"
        : "Resetting password…";

  const devResetToken = devResetUrl ? getResetTokenFromUrl(devResetUrl) : "";

  return (
    <div className="flex min-h-screen bg-white">
      <BrandPanel />

      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:px-12">
        <div className="w-full max-w-md anim-fade-in">
          <Link
            to="/"
            className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition hover:text-brand-600"
          >
            <ArrowLeft className="size-4" /> Back to home
          </Link>

          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/30">
              <AmbulanceMark className="size-6" />
            </span>
            <div>
              <p className="text-lg font-extrabold tracking-tight text-slate-900">
                RakshaRoute
              </p>
              <p className="text-xs font-medium text-slate-500">
                Emergency ambulance booking
              </p>
            </div>
          </div>

          <h1 className="text-3xl font-black tracking-tight text-slate-900">
            {TITLES[mode]}
          </h1>
          <p className="mt-2 text-slate-500">{SUBTITLES[mode]}</p>

          {isReset && !resetToken && (
            <div className="mt-8 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              This reset link is missing its token.{" "}
              <Link
                to="/forgot-password"
                className="font-bold underline underline-offset-2"
              >
                Request a new link
              </Link>
              .
            </div>
          )}

          {(!isReset || resetToken) && (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              {isRegister && (
                <Field
                  label="Full name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              )}

              {(isLogin || isRegister || isForgot) && (
                <Field
                  label="Email address"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              )}

              {!isForgot && (
                <Field
                  label={isReset ? "New password" : "Password"}
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  hint={
                    isLogin
                      ? undefined
                      : isReset
                        ? "At least 6 characters."
                        : "At least 6 characters, anything else goes."
                  }
                />
              )}

              {isLogin && (
                <div className="-mt-1 text-right">
                  <Link
                    to="/forgot-password"
                    className="text-xs font-bold text-brand-600 transition hover:text-brand-700"
                  >
                    Forgot password?
                  </Link>
                </div>
              )}

              {(isReset || isRegister) && (
                <Field
                  label="Confirm password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              )}

              {isRegister && (
                <Field
                  label="Phone number"
                  type="tel"
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, "");

                    // Allow empty input while typing
                    if (value === "") {
                      setPhone("");
                      return;
                    }

                    // First digit must be 6, 7, 8, or 9
                    if (!/^[6-9]/.test(value)) {
                      return;
                    }

                    // Maximum 10 digits
                    if (value.length <= 10) {
                      setPhone(value);
                    }
                  }}
                  required
                  autoComplete="tel"
                />
              )}

              {error && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {error}
                </p>
              )}

              {notice && (
                <div
                  role="status"
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
                >
                  <p className="flex items-start gap-2">
                    <MailCheck className="mt-0.5 size-4 shrink-0" />
                    <span>{notice}</span>
                  </p>

                  {devResetToken && (
                    <div className="mt-3 border-t border-emerald-200 pt-3 text-emerald-900">
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide">
                        <KeyRound className="size-3.5" /> Development mode
                      </p>
                      <p className="mt-1.5 text-xs font-medium text-emerald-700">
                        Email delivery is not configured, so use this link to
                        continue:
                      </p>
                      <Link
                        to={`/reset-password?token=${encodeURIComponent(devResetToken)}`}
                        className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold underline underline-offset-2"
                      >
                        <CheckCircle2 className="size-4" /> Open reset link
                      </Link>
                    </div>
                  )}
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={loading}
              >
                {loading ? loadingLabel : submitLabel}
              </Button>
            </form>
          )}

          <p className="mt-7 text-center text-sm text-slate-500">
            {isRegister
              ? "Already have an account? "
              : isLogin
                ? "New to RakshaRoute? "
                : "Remembered your password? "}
            <Link
              to={isLogin ? "/register" : "/login"}
              className="font-bold text-brand-600 transition hover:text-brand-700"
            >
              {isLogin
                ? "Create an account"
                : isRegister
                  ? "Login instead"
                  : "Back to login"}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
