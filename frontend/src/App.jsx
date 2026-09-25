import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./components/AuthContext";
import { ToastContainer } from "./lib/toast";

const Landing = lazy(() => import("./pages/Landing"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Fleet = lazy(() => import("./pages/Fleet"));

const FLEET_ROLES = ["admin", "driver"];

function PageLoader() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600"
      role="status"
      aria-live="polite"
    >
      Loading…
    </div>
  );
}

function RequireAuth({ children, roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ToastContainer />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route
              path="/book"
              element={
                <RequireAuth>
                  <Navigate to="/dashboard?focus=book" replace />
                </RequireAuth>
              }
            />
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <Dashboard />
                </RequireAuth>
              }
            />
            <Route
              path="/fleet"
              element={
                <RequireAuth roles={FLEET_ROLES}>
                  <Fleet />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
