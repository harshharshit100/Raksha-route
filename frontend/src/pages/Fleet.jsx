import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Ambulance as AmbulanceIcon,
  WifiOff,
  Play,
  Square,
  RefreshCw,
  LogOut,
  Radio,
  MapPin,
  Phone,
  Waypoints,
} from "lucide-react";
import API from "../api";
import { onLive, disconnectSocket } from "../socket";
import { useAuth } from "../components/AuthContext";
import Logo from "../components/Logo";
import { Button, Card, CardHeader, StatCard, StatusPill } from "../components/ui";
import { STATUS_META, TYPE_META, initials } from "../lib/format";
import { toast } from "../lib/toast";
import AmbulanceMap from "../AmbulanceMap";

const CENTER = { lat: 30.7333, lng: 76.7794 };
const MOVES_PER_TICK = 2;
const AMBULANCE_STATUS_META = {
  available: { ...STATUS_META.completed, label: "Available" },
  busy: { ...STATUS_META.ongoing, label: "On a trip" },
  offline: {
    label: "Offline",
    pill: "bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
  },
};
const UNKNOWN_STATUS_META = {
  label: "Unknown",
  pill: "bg-slate-100 text-slate-600",
  dot: "bg-slate-400",
};

function normalizeCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const rawLng = coordinates[0];
  const rawLat = coordinates[1];
  if (
    (typeof rawLng !== "number" && typeof rawLng !== "string") ||
    (typeof rawLat !== "number" && typeof rawLat !== "string") ||
    (typeof rawLng === "string" && rawLng.trim() === "") ||
    (typeof rawLat === "string" && rawLat.trim() === "")
  ) {
    return null;
  }

  const lng = Number(rawLng);
  const lat = Number(rawLat);
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < -180 ||
    lng > 180 ||
    lat < -90 ||
    lat > 90 ||
    (lng === 0 && lat === 0)
  ) {
    return null;
  }

  return [lng, lat];
}

function coordinatesMatch(first, second) {
  const normalizedFirst = normalizeCoordinates(first);
  const normalizedSecond = normalizeCoordinates(second);
  return Boolean(
    normalizedFirst &&
      normalizedSecond &&
      normalizedFirst[0] === normalizedSecond[0] &&
      normalizedFirst[1] === normalizedSecond[1]
  );
}

function getAmbulanceStatusMeta(status) {
  const meta = AMBULANCE_STATUS_META[status];
  if (meta) return meta;
  return typeof status === "string" && status.trim()
    ? { ...UNKNOWN_STATUS_META, label: status }
    : UNKNOWN_STATUS_META;
}

function AmbulanceStatusPill({ status }) {
  const meta = getAmbulanceStatusMeta(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.pill}`}
      aria-label={`Ambulance status: ${meta.label}`}
    >
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

export default function Fleet() {
  const { user, logout } = useAuth();
  const canSimulate = user?.role === "driver" || user?.role === "admin";
  const [ambulances, setAmbulances] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const timer = useRef(null);
  const simulationInFlight = useRef(false);

  const loadFleet = useCallback(async () => {
    try {
      const [ambRes, bookRes] = await Promise.all([
        API.get("/ambulances"),
        // Activity feed is admin/driver-only — patients still get the map
        API.get("/bookings").catch(() => null),
      ]);
      setAmbulances(ambRes.data.ambulances || []);
      setBookings(bookRes?.data?.bookings || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load fleet data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount data load; loadFleet only setStates after its awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFleet();

    const offLoc = onLive("ambulance:location", (amb) => {
      const coordinates = normalizeCoordinates(amb?.location?.coordinates);
      if (!amb?._id || !coordinates) return;
      setAmbulances((prev) =>
        prev.map((a) =>
          a._id === amb._id
            ? {
                ...a,
                location: { type: amb.location?.type || "Point", coordinates },
              }
            : a
        )
      );
    });

    const offCreated = onLive("booking:created:fleet", (bk) => {
      if (!bk?._id) return;
      setBookings((prev) => [bk, ...prev].slice(0, 12));
      toast(`New booking — ${bk.ambulance?.vehicleNumber || "ambulance"}`, "info");
    });

    const offStatus = onLive("booking:status:fleet", (payload) => {
      const bk = payload?.booking || payload;
      if (!bk?._id) return;
      setBookings((prev) =>
        prev.map((b) => (b._id === bk._id ? { ...b, ...bk } : b))
      );
    });

    return () => {
      offLoc();
      offCreated();
      offStatus();
    };
  }, [loadFleet]);

  useEffect(() => () => disconnectSocket(), []);

  // ---- Simulate movement ----
  const stepSimulation = useCallback(async () => {
    if (!canSimulate || !simulating || simulationInFlight.current) return;

    const movable = ambulances.filter(
      (a) => a.status === "available" && normalizeCoordinates(a.location?.coordinates)
    );
    const candidates = [...new Map(movable.map((a) => [a._id, a])).values()];
    if (!candidates.length) return;

    const picks = Array.from(
      { length: Math.min(MOVES_PER_TICK, candidates.length) },
      () => {
        const index = Math.floor(Math.random() * candidates.length);
        return candidates.splice(index, 1)[0];
      }
    );

    simulationInFlight.current = true;
    try {
      for (const amb of picks) {
        const originalCoordinates = normalizeCoordinates(amb.location?.coordinates);
        if (!originalCoordinates) continue;

        const [lng, lat] = originalCoordinates;
        const dLat = (Math.random() - 0.5) * 0.006;
        const dLng = (Math.random() - 0.5) * 0.006;
        const nextCoordinates = [
          Math.min(180, Math.max(-180, lng + dLng)),
          Math.min(90, Math.max(-90, lat + dLat)),
        ];
        const nextLocation = { type: "Point", coordinates: nextCoordinates };
        const originalLocation = { type: "Point", coordinates: originalCoordinates };

        // Optimistic local update; a failed PATCH restores the last local position.
        setAmbulances((prev) =>
          prev.map((a) =>
            a._id === amb._id ? { ...a, location: nextLocation } : a
          )
        );

        try {
          await API.patch(`/ambulances/${amb._id}/location`, {
            latitude: nextCoordinates[1],
            longitude: nextCoordinates[0],
          });
        } catch {
          setAmbulances((prev) =>
            prev.map((current) => {
              if (
                current._id !== amb._id ||
                !coordinatesMatch(current.location?.coordinates, nextCoordinates)
              ) {
                return current;
              }
              return { ...current, location: originalLocation };
            })
          );
        }
      }
    } finally {
      simulationInFlight.current = false;
    }
  }, [ambulances, canSimulate, simulating]);

  useEffect(() => {
    if (!canSimulate || !simulating) return;
    timer.current = window.setInterval(stepSimulation, 2000);
    return () => window.clearInterval(timer.current);
  }, [canSimulate, simulating, stepSimulation]);

  const simulationActive = canSimulate && simulating;
  const mappableAmbulances = ambulances.flatMap((amb) => {
    const coordinates = normalizeCoordinates(amb.location?.coordinates);
    if (!coordinates) return [];
    return [
      {
        ...amb,
        status: getAmbulanceStatusMeta(amb.status).label,
        location: { type: amb.location?.type || "Point", coordinates },
      },
    ];
  });
  const total = ambulances.length;
  const available = ambulances.filter((a) => a.status === "available").length;
  const busy = ambulances.filter((a) => a.status === "busy").length;
  const offline = ambulances.filter((a) => a.status === "offline").length;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/85 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/">
            <Logo />
          </Link>

          <div className="flex items-center gap-2.5">
            <span className="hidden items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 sm:inline-flex">
              <Radio className="size-3.5" /> Fleet control
            </span>

            {canSimulate && (
              <Button
                variant={simulationActive ? "danger" : "secondary"}
                size="sm"
                onClick={() => {
                  setSimulating((s) => {
                    if (s) toast("Simulation stopped", "info");
                    else toast("Simulating ambulance movement…", "info");
                    return !s;
                  });
                }}
              >
                {simulationActive ? (
                  <>
                    <Square className="size-3.5" /> Stop simulate
                  </>
                ) : (
                  <>
                    <Play className="size-3.5" /> Simulate movement
                  </>
                )}
              </Button>
            )}

            <Button variant="secondary" size="sm" onClick={loadFleet} className="hidden sm:inline-flex">
              <RefreshCw className="size-3.5" /> Refresh
            </Button>

            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              <LogOut className="size-4" /> Logout
            </button>

            <span className="grid size-9 place-items-center rounded-full bg-brand-100 text-sm font-extrabold text-brand-700">
              {initials(user.name)}
            </span>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="anim-fade-in flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand-600">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full rounded-full bg-emerald-500 opacity-75 anim-pulse-dot" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              {simulationActive
                ? "Simulation active — watching fleet move live"
                : "Live fleet status"}
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">
              Fleet command
            </h1>
            <p className="mt-1 text-slate-500">
              Every ambulance, driver, and active trip — in real time.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={AmbulanceIcon}
            label="Total fleet"
            value={loading ? "…" : total}
            hint="registered vehicles"
            accentBg="bg-brand-50"
            accentText="text-brand-600"
          />
          <StatCard
            icon={MapPin}
            label="Available"
            value={loading ? "…" : available}
            hint="ready to dispatch"
            accentBg="bg-emerald-50"
            accentText="text-emerald-600"
          />
          <StatCard
            icon={Waypoints}
            label="On a trip"
            value={loading ? "…" : busy}
            hint="currently busy"
            accentBg="bg-sky-50"
            accentText="text-sky-600"
          />
          <StatCard
            icon={WifiOff}
            label="Offline"
            value={loading ? "…" : offline}
            hint="not available"
            accentBg="bg-slate-100"
            accentText="text-slate-500"
          />
        </div>

        {error && (
          <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* map */}
          <Card className="lg:col-span-2">
            <CardHeader
              title="Fleet map"
              subtitle="Live positions of every ambulance."
              action={
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  <span className="size-1.5 rounded-full bg-emerald-500 anim-pulse-dot" /> LIVE
                </span>
              }
            />
            <div className="p-5 sm:p-6">
              {loading ? (
                <div className="h-[420px] animate-pulse rounded-2xl bg-slate-200/70" />
              ) : (
                <div className="h-[420px] overflow-hidden rounded-2xl border border-slate-200">
                  <AmbulanceMap
                    ambulances={mappableAmbulances}
                    center={CENTER}
                    showUser={false}
                    zoom={11}
                  />
                </div>
              )}
              {simulationActive && (
                <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-sky-700">
                  <span className="size-2 rounded-full bg-sky-500 anim-pulse-dot" />
                  Simulating — ambulances are moving on the map right now.
                </p>
              )}
            </div>
          </Card>

          {/* live feed */}
          <Card>
            <CardHeader
              title="Activity feed"
              subtitle="Latest trips across the fleet."
            />
            <div className="rk-scroll max-h-[420px] space-y-3 overflow-y-auto p-5 sm:p-6">
              {loading && <p className="text-sm text-slate-400">Loading…</p>}
              {!loading && bookings.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-5 text-center text-sm text-slate-400">
                  No recent activity yet.
                </p>
              )}
              {bookings.map((bk) => (
                <div
                  key={bk._id}
                  className="rounded-xl border border-slate-200 p-3.5 transition hover:border-brand-200"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-bold text-slate-900">
                      🚑 {bk.ambulance?.vehicleNumber || "Ambulance"}
                    </p>
                    <StatusPill status={bk.status} />
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {bk.destination} · {bk.patientName}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {new Date(bk.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* fleet table */}
        <Card className="mt-6">
          <CardHeader
            title="Registered ambulances"
            subtitle={total ? `${total} vehicles in the network` : "Register vehicles to see them here."}
          />
          <div className="p-5 sm:p-6">
            {!loading && ambulances.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-400">
                No ambulances registered yet. Use{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  node backend/seed.js
                </code>{" "}
                to add the local fleet.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ambulances.map((amb) => {
                const coordinates = normalizeCoordinates(amb.location?.coordinates);
                const typeBadge =
                  TYPE_META[amb.type]?.badge || "bg-slate-100 text-slate-700";
                return (
                  <div
                    key={amb._id}
                    className="rounded-xl border border-slate-200 p-4 transition hover:border-brand-200 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-slate-900">
                        🚑 {amb.vehicleNumber}
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${typeBadge}`}>
                        {amb.type}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-slate-500">
                      <p>Driver: <span className="font-semibold text-slate-700">{amb.driverName}</span></p>
                      <p className="flex items-center gap-1">
                        <Phone className="size-3" /> {amb.driverPhone}
                      </p>
                      <p className="flex items-center gap-1">
                        <MapPin className="size-3" />
                        {coordinates
                          ? `${coordinates[1].toFixed(4)}, ${coordinates[0].toFixed(4)}`
                          : "Location unavailable"}
                      </p>
                    </div>
                    <div className="mt-3">
                      <AmbulanceStatusPill status={amb.status} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}