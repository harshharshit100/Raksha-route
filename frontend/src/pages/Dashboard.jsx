import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Ambulance as AmbulanceIcon,
  MapPin,
  LocateFixed,
  UserRound,
  Hospital,
  RefreshCw,
  X,
  Radio,
  Timer,
  Navigation,
  Search,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import API, { isApiConnectionError } from "../api";
import { onLive, getSocket, disconnectSocket } from "../socket";
import { useAuth } from "../components/AuthContext";
import Logo from "../components/Logo";
import { Button, Card, CardHeader, Field, StatCard, StatusPill } from "../components/ui";
import { formatDistance, formatEta, STATUS_META, TYPE_META, initials, haversineKm, etaMinutesFromKm } from "../lib/format";
import { toast } from "../lib/toast";
import AmbulanceMap from "../AmbulanceMap";
import TripMap from "../TripMap";

const FALLBACK_COORDS = { lat: 30.7333, lng: 76.7794 }; // Chandigarh
const COORDINATE_ERROR =
  "Enter a latitude between -90 and 90 and a longitude between -180 and 180.";
const ACTIVE_TRIP_STATUSES = new Set(["confirmed", "ongoing"]);
const TERMINAL_TRIP_STATUSES = new Set(["completed", "cancelled"]);

const TRIP_STEPS = ["confirmed", "ongoing", "completed"];
const BOOK_STEPS = ["Find", "Details", "Confirmed"];

function isValidLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function hasValidCoordinates(coords) {
  return isValidLatitude(coords?.lat) && isValidLongitude(coords?.lng);
}

function parseCoordinate(value) {
  if (value === "" || value == null) return NaN;
  return Number(value);
}

function formatCoordinates(coords) {
  if (!hasValidCoordinates(coords)) return "Invalid coordinates";
  return `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
}

function isActiveTrip(booking) {
  return ACTIVE_TRIP_STATUSES.has(booking?.status);
}

function isTerminalTrip(booking) {
  return TERMINAL_TRIP_STATUSES.has(booking?.status);
}

function TopBar({ user, onLogout }) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/85 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/">
          <Logo />
        </Link>

        <div className="flex items-center gap-2.5">
          {["admin", "driver"].includes(user.role) && (
            <Button
              variant={location.pathname?.startsWith("/fleet") ? "primary" : "secondary"}
              size="sm"
              onClick={() => navigate("/fleet")}
              className="hidden sm:inline-flex"
            >
              <Radio className="size-4" /> Fleet view
            </Button>
          )}

          <button
            onClick={onLogout}
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
  );
}

function StatusStepper({ status }) {
  const current = STATUS_META[status]?.step ?? 0;
  const cancelled = status === "cancelled";

  return (
    <ol className="flex items-center gap-2">
      {TRIP_STEPS.map((s, i) => {
        const step = i + 1;
        const done = !cancelled && current >= step;
        const active = !cancelled && current === step;
        return (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                done
                  ? "bg-emerald-500 text-white"
                  : active
                    ? "bg-sky-500 text-white anim-ring"
                    : "bg-slate-200 text-slate-500"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={`hidden text-xs font-semibold sm:block ${
                active ? "text-slate-900" : "text-slate-400"
              }`}
            >
              {STATUS_META[s].label}
            </span>
            {i < TRIP_STEPS.length - 1 && (
              <span
                className={`h-0.5 flex-1 rounded ${done ? "bg-emerald-300" : "bg-slate-200"}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [params] = useSearchParams();
  const focus = params.get("focus");

  // ---- Find nearby ----
  const [coords, setCoords] = useState(FALLBACK_COORDS);
  const [distance, setDistance] = useState(10000);
  const [ambulances, setAmbulances] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState("");
  const [locationSource, setLocationSource] = useState("fallback");
  const [addressQuery, setAddressQuery] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  // Search requests can overlap when the pickup point or radius changes.
  const searchRequestRef = useRef(0);
  const searchAbortRef = useRef(null);
  const hasSearchedRef = useRef(false);
  const coordsRef = useRef(coords);

  // ---- Book ----
  const [selectedAmbulance, setSelectedAmbulance] = useState(null);
  const [bookingForm, setBookingForm] = useState({
    destination: "",
    patientName: user?.name || "",
    patientPhone: "",
  });
  const [justBooked, setJustBooked] = useState(null);
  const [bookingError, setBookingError] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);

  // ---- History / live ----
  const [bookings, setBookings] = useState([]);
  const [historyError, setHistoryError] = useState("");
  const [activeTripId, setActiveTripId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [live, setLive] = useState(false);

  const loadBookings = useCallback(async () => {
    try {
      const { data } = await API.get("/bookings/my");
      const nextBookings = Array.isArray(data?.bookings) ? data.bookings : [];
      setBookings(nextBookings);
      setActiveTripId((currentId) => {
        const currentBooking = nextBookings.find((b) => b._id === currentId);
        if (isActiveTrip(currentBooking)) return currentId;
        return nextBookings.find(isActiveTrip)?._id || null;
      });
      setJustBooked((current) => {
        if (!current) return current;
        const latest = nextBookings.find((b) => b._id === current._id);
        if (!latest) return current;
        return isTerminalTrip(latest) ? null : latest;
      });
      setHistoryError("");
    } catch (err) {
      setHistoryError(err.response?.data?.message || "Failed to load bookings.");
    }
  }, []);

  const invalidateNearbySearch = useCallback(() => {
    searchRequestRef.current += 1;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setAmbulances([]);
    setSearchError("");
  }, []);

  const runNearbySearch = useCallback(async (searchCoords, searchDistance) => {
    const requestId = ++searchRequestRef.current;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    hasSearchedRef.current = true;
    setHasSearched(true);
    setAmbulances([]);
    setSearchError("");
    setSearching(true);

    if (!hasValidCoordinates(searchCoords)) {
      setSearching(false);
      setSearchError(COORDINATE_ERROR);
      return;
    }

    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    searchAbortRef.current = controller;
    try {
      const { data } = await API.get("/ambulances/nearby", {
        params: {
          latitude: searchCoords.lat,
          longitude: searchCoords.lng,
          distance: searchDistance,
        },
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (requestId !== searchRequestRef.current) return;
      const nextAmbulances = Array.isArray(data?.ambulances) ? data.ambulances : [];
      setAmbulances(nextAmbulances);
      if (data?.developmentFleetAdded) {
        toast("Available local ambulances were added near your pickup point.", "info");
      }
      if (!nextAmbulances.length) {
        toast("No available ambulances in range", "info");
      }
    } catch (err) {
      if (
        requestId !== searchRequestRef.current ||
        err?.code === "ERR_CANCELED" ||
        err?.name === "CanceledError"
      ) {
        return;
      }
      const connectionMessage = import.meta.env.DEV
        ? "Unable to reach the local API. Start it with npm run dev from the backend folder."
        : "Unable to reach the RakshaRoute server. Check your connection and try again.";
      setSearchError(
        err.response?.data?.message ||
          (isApiConnectionError(err)
            ? connectionMessage
            : "Unable to find nearby ambulances.")
      );
    } finally {
      if (requestId === searchRequestRef.current) {
        if (searchAbortRef.current === controller) searchAbortRef.current = null;
        setSearching(false);
      }
    }
  }, []);

  const changeCoords = useCallback((nextCoords) => {
    const next = typeof nextCoords === "function" ? nextCoords(coordsRef.current) : nextCoords;
    const changed =
      !Object.is(coordsRef.current?.lat, next?.lat) ||
      !Object.is(coordsRef.current?.lng, next?.lng);
    coordsRef.current = next;
    if (changed) {
      invalidateNearbySearch();
      setCoords(next);
      if (hasSearchedRef.current) setSearching(true);
    }
  }, [invalidateNearbySearch]);

  const updateCoordinate = useCallback(
    (field, rawValue) => {
      const value = parseCoordinate(rawValue);
      changeCoords((prev) => ({ ...prev, [field]: value }));
      setLocationSource("custom");
      setAddressQuery("");
      setPickupAddress("");
      setAddressError("");
      setLocationNote("");
    },
    [changeCoords]
  );

  const updateDistance = (rawValue) => {
    const nextDistance = parseCoordinate(rawValue);
    invalidateNearbySearch();
    setDistance(nextDistance);
    if (hasSearchedRef.current) setSearching(true);
  };

  const lookupAddress = async (event) => {
    event?.preventDefault();
    const address = addressQuery.trim();
    if (address.length < 3) {
      setAddressError("Enter a full pickup address, including city or PIN code.");
      return;
    }

    setAddressError("");
    setAddressLoading(true);
    try {
      const { data } = await API.get("/locations/geocode", {
        params: { address },
      });
      const nextCoords = { lat: data.latitude, lng: data.longitude };
      if (!hasValidCoordinates(nextCoords)) {
        throw new Error("The address lookup returned invalid coordinates.");
      }

      setAddressQuery(data.address || address);
      setPickupAddress(data.address || address);
      setLocationSource("address");
      setLocationNote(`Pickup set to ${data.address || address}.`);
      changeCoords(nextCoords);
      await runNearbySearch(nextCoords, distance);
      toast("Pickup address located", "success");
    } catch (err) {
      setAddressError(
        err.response?.data?.message ||
          err.message ||
          "Could not locate that address. Try adding a city or PIN code."
      );
    } finally {
      setAddressLoading(false);
    }
  };

  const locate = useCallback((silent = false) => {
    const showSpinner = !silent;
    const applyFallback = () => {
      changeCoords(FALLBACK_COORDS);
      setLocationSource("fallback");
      setAddressQuery("");
      setPickupAddress("Chandigarh fallback");
      setAddressError("");
    };

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      applyFallback();
      if (showSpinner) {
        setLocationNote("Geolocation is not supported — using fallback coordinates (Chandigarh).");
        setLocating(false);
      }
      return;
    }

    if (showSpinner) setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextCoords = {
          lat: parseCoordinate(pos.coords.latitude),
          lng: parseCoordinate(pos.coords.longitude),
        };
        if (!hasValidCoordinates(nextCoords)) {
          applyFallback();
          if (showSpinner) {
            setLocationNote("Location unavailable — using fallback coordinates (Chandigarh). Edit them below.");
            setLocating(false);
          }
          return;
        }
        changeCoords(nextCoords);
        setLocationSource("live");
        setAddressQuery("");
        setPickupAddress("Current location");
        setAddressError("");
        if (showSpinner) {
          setLocationNote("Using your live location.");
          toast("Location updated", "info");
          setLocating(false);
        }
      },
      () => {
        applyFallback();
        if (showSpinner) {
          setLocationNote("Location denied — using fallback coordinates (Chandigarh). Edit them below.");
          setLocating(false);
        }
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [changeCoords]);

  // keep the location hint auto-hiding
  useEffect(() => {
    if (!locationNote) return;
    const t = setTimeout(() => setLocationNote(""), 6000);
    return () => clearTimeout(t);
  }, [locationNote]);

  useEffect(() => {
    if (!hasSearchedRef.current) return;
    // Debounce coordinate/radius edits so a partially typed valid value does
    // not trigger a request for every keystroke.
    const timer = setTimeout(() => runNearbySearch(coords, distance), 350);
    return () => clearTimeout(timer);
  }, [coords, distance, runNearbySearch]);

  useEffect(() => {
    // Fetch-on-mount: loadBookings/locate only setState after async work.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBookings();
    locate(true);
  }, [loadBookings, locate]);

  // scroll to the section the landing page asked for
  useEffect(() => {
    if (!focus) return;
    const map = { find: "find-section", book: "book-section", track: "trips-section" };
    const id = map[focus];
    if (id) {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focus]);

  // ---- Live socket updates ----
  useEffect(() => {
    const offStatus = onLive("booking:status", (payload) => {
      const bk = payload?.booking || payload;
      const bookingId = bk?._id || payload?.bookingId;
      if (!bookingId) return;

      const bookingUpdate = bk?._id
        ? bk
        : { _id: bookingId, status: bk?.status || payload?.status };
      setBookings((prev) =>
        prev.map((b) => (b._id === bookingId ? { ...b, ...bookingUpdate } : b))
      );
      setJustBooked((current) => {
        if (!current || current._id !== bookingId) return current;
        const updated = { ...current, ...bookingUpdate };
        return isTerminalTrip(updated) ? null : updated;
      });

      const status = bookingUpdate.status;
      if (status) {
        const lbl = STATUS_META[status]?.label || status;
        toast(`Booking ${lbl.toLowerCase()}`, "info");
      }
    });

    const offLoc = onLive("ambulance:location", (amb) => {
      if (!amb?._id || !amb.location) return;
      setAmbulances((prev) =>
        prev.map((a) =>
          a._id === amb._id ? { ...a, location: amb.location } : a
        )
      );
      setBookings((prev) =>
        prev.map((b) =>
          b.ambulance?._id === amb._id
            ? { ...b, ambulance: { ...b.ambulance, location: amb.location } }
            : b
        )
      );
    });

    // Reflect the actual socket state instead of leaving a stale LIVE label.
    const s = getSocket();
    const markLive = () => setLive(true);
    const markDisconnected = () => setLive(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLive(Boolean(s.connected));
    s.on("connect", markLive);
    s.on("disconnect", markDisconnected);
    s.on("connect_error", markDisconnected);

    return () => {
      s.off("connect", markLive);
      s.off("disconnect", markDisconnected);
      s.off("connect_error", markDisconnected);
      offStatus();
      offLoc();
    };
  }, []);

  useEffect(() => () => {
    searchRequestRef.current += 1;
    searchAbortRef.current?.abort();
    disconnectSocket();
  }, []);

  const findNearby = (e) => {
    e.preventDefault();
    const typedAddress = addressQuery.trim();
    if (typedAddress && typedAddress !== pickupAddress) {
      void lookupAddress(e);
      return;
    }
    runNearbySearch(coords, distance);
  };

  const selectAmbulance = (amb) => {
    setSelectedAmbulance(amb);
    setJustBooked(null);
    setBookingError("");
    document.getElementById("book-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleBookingForm = (e) => {
    const { name, value } = e.target;
    setBookingForm((prev) => ({ ...prev, [name]: value }));
  };

  const bookAmbulance = async (e) => {
    e.preventDefault();
    if (!selectedAmbulance) return;
    setBookingError("");
    if (!hasValidCoordinates(coords)) {
      setBookingError(COORDINATE_ERROR);
      return;
    }
    setBookingLoading(true);
    try {
      const { data } = await API.post("/bookings", {
        ambulanceId: selectedAmbulance._id,
        latitude: coords.lat,
        longitude: coords.lng,
        pickupAddress: pickupAddress || addressQuery.trim(),
        destination: bookingForm.destination,
        patientName: bookingForm.patientName,
        patientPhone: bookingForm.patientPhone,
      });
      setJustBooked(data.booking);
      setSelectedAmbulance(null);
      setBookingForm({ destination: "", patientName: user?.name || "", patientPhone: "" });
      setActiveTripId(data.booking._id);
      await loadBookings();
      toast("Ambulance booked — it’s on the way! 🚑", "success");
    } catch (err) {
      setBookingError(err.response?.data?.message || "Booking failed, please try again.");
    } finally {
      setBookingLoading(false);
    }
  };

  const cancelBooking = async (id) => {
    if (!window.confirm("Cancel this booking?")) return;
    try {
      await API.patch(`/bookings/${id}/status`, { status: "cancelled" });
      await loadBookings();
      toast("Booking cancelled", "error");
    } catch (err) {
      toast(err.response?.data?.message || "Could not cancel booking", "error");
    }
  };

  const activeTrip = useMemo(
    () => bookings.find((b) => b._id === activeTripId) || null,
    [bookings, activeTripId]
  );
  const activeTripIsRunning = isActiveTrip(activeTrip);

  // Socket updates are the primary live feed. A short polling fallback keeps
  // the marker moving if a proxy drops a WebSocket event or the tab reconnects.
  useEffect(() => {
    if (!activeTripIsRunning || !activeTripId) return undefined;

    let cancelled = false;
    let inFlight = false;
    const refreshActiveTrip = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { data } = await API.get(`/bookings/${activeTripId}`);
        if (cancelled || !data?.booking) return;
        setBookings((current) =>
          current.map((booking) =>
            booking._id === activeTripId ? data.booking : booking
          )
        );
      } catch {
        // The next interval retries; the live connection state remains visible.
      } finally {
        inFlight = false;
      }
    };

    void refreshActiveTrip();
    const timer = window.setInterval(refreshActiveTrip, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeTripId, activeTripIsRunning]);

  const locationLabel =
    locationSource === "live"
      ? "Live"
      : locationSource === "address"
        ? "Address"
        : locationSource === "custom"
          ? "Custom"
          : "Fallback";

  // Live ETA: straight-line ambulance → pickup, recomputed as socket
  // location updates move the ambulance pin
  const activeEta = useMemo(() => {
    const amb = activeTrip?.ambulance?.location?.coordinates;
    const pick = activeTrip?.pickupLocation?.coordinates;
    if (!activeTrip || !Array.isArray(amb) || !Array.isArray(pick)) return null;
    if (!isActiveTrip(activeTrip)) return null;
    const km = haversineKm(amb[1], amb[0], pick[1], pick[0]);
    return formatEta(etaMinutesFromKm(km));
  }, [activeTrip]);

  const filteredBookings =
    statusFilter === "all"
      ? bookings
      : bookings.filter((b) => b.status === statusFilter);

  const nearbyCount =
    hasSearched && !searching ? ambulances.length : null;

  // booking step for the stepper
  let bookStep = 1;
  if (selectedAmbulance) bookStep = 2;
  if (justBooked) bookStep = 3;

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar user={user} onLogout={logout} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* ---------- header ---------- */}
        <div className="anim-fade-in flex flex-wrap items-end justify-between gap-4">
          <div>
            <p
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand-600"
              aria-live="polite"
            >
              <span className="relative flex size-2">
                <span
                  className={`absolute inline-flex size-full rounded-full opacity-75 anim-pulse-dot ${
                    live ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                <span
                  className={`relative inline-flex size-2 rounded-full ${
                    live ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
              </span>
              Live network {live ? "connected" : "disconnected"}
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">
              Welcome back, {user.name.split(" ")[0]} 👋
            </h1>
            <p className="mt-1 text-slate-500">
              Find an ambulance, book it, and track every minute of the trip.
            </p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => locate()}
            disabled={locating}
          >
            <LocateFixed className="size-4" />{" "}
            {locating ? "Locating…" : "Use my location"}
          </Button>
        </div>

        {/* ---------- stats ---------- */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={LocateFixed}
            label="Location"
            value={locationLabel}
            hint={pickupAddress || addressQuery.trim() || formatCoordinates(coords)}
            accentBg="bg-sky-50"
            accentText="text-sky-600"
          />
          <StatCard
            icon={AmbulanceIcon}
            label="Nearby available"
            value={nearbyCount === null ? "—" : nearbyCount}
            hint={hasSearched ? "from last search" : "run a search"}
            accentBg="bg-brand-50"
            accentText="text-brand-600"
          />
          <StatCard
            icon={Navigation}
            label="Active trip"
            value={activeTripIsRunning ? "Live" : activeTrip ? "Ended" : "None"}
            hint={
              activeTripIsRunning
                ? activeTrip?.ambulance?.vehicleNumber || "no trip running"
                : activeTrip
                  ? "trip ended"
                  : "no trip running"
            }
            accentBg="bg-emerald-50"
            accentText="text-emerald-600"
          />
          <StatCard
            icon={ShieldCheck}
            label="Total trips"
            value={bookings.length}
            hint={`${bookings.filter((b) => b.status === "completed").length} completed`}
            accentBg="bg-amber-50"
            accentText="text-amber-600"
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* ============ FIND ============ */}
          <section id="find-section" className="lg:col-span-2">
            <Card className="scroll-mt-20">
              <CardHeader
                title="Find nearby ambulances"
                subtitle="We show only available vehicles around your pickup point."
              />
              <div className="p-5 sm:p-6">
                <form onSubmit={findNearby} className="grid gap-3 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="pickup-address"
                      className="mb-1.5 block text-[13px] font-semibold text-slate-700"
                    >
                      Pickup address
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="pickup-address"
                        type="text"
                        value={addressQuery}
                        onChange={(e) => {
                          setAddressQuery(e.target.value);
                          if (addressError) setAddressError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void lookupAddress(e);
                          }
                        }}
                        placeholder="e.g. Sector 17, Chandigarh, 160017"
                        autoComplete="street-address"
                        className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                        aria-invalid={Boolean(addressError)}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={(e) => void lookupAddress(e)}
                        disabled={addressLoading}
                        className="shrink-0"
                      >
                        <MapPin className="size-4" />
                        {addressLoading ? "Locating…" : "Use address"}
                      </Button>
                    </div>
                    {addressError && (
                      <p className="mt-2 text-sm font-medium text-rose-600">
                        {addressError}
                      </p>
                    )}
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                      Max distance
                    </span>
                    <select
                      value={distance}
                      onChange={(e) => updateDistance(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                    >
                      <option value={5000}>5 km</option>
                      <option value={10000}>10 km</option>
                      <option value={25000}>25 km</option>
                      <option value={50000}>50 km</option>
                    </select>
                  </label>

                  <div className="flex items-end">
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full"
                      disabled={searching || addressLoading}
                    >
                      <Search className="size-4" />
                      {searching ? "Searching…" : "Search"}
                    </Button>
                  </div>

                  <details className="sm:col-span-4">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-brand-600">
                      Advanced: enter coordinates instead
                    </summary>
                    <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
                      <Field
                        label="Latitude"
                        type="number"
                        step="any"
                        value={Number.isFinite(coords.lat) ? coords.lat : ""}
                        onChange={(e) => updateCoordinate("lat", e.target.value)}
                        min="-90"
                        max="90"
                        aria-invalid={!isValidLatitude(coords.lat)}
                      />
                      <Field
                        label="Longitude"
                        type="number"
                        step="any"
                        value={Number.isFinite(coords.lng) ? coords.lng : ""}
                        onChange={(e) => updateCoordinate("lng", e.target.value)}
                        min="-180"
                        max="180"
                        aria-invalid={!isValidLongitude(coords.lng)}
                      />
                    </div>
                  </details>
                </form>

                {locationNote && (
                  <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                    <MapPin className="size-4 text-brand-500" /> {locationNote}
                  </p>
                )}
                {searchError && (
                  <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">
                    {searchError}
                  </p>
                )}

                {/* The pickup map remains available even if the optional live
                    ambulance search cannot reach its API. */}
                {hasValidCoordinates(coords) && (
                  <div className="anim-slide-in mt-5">
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
                      <MapPin className="size-3.5 text-sky-600" />
                      {searchError
                        ? "Map centred on your pickup point. Live ambulance search is unavailable."
                        : searching
                          ? "Searching nearby ambulances…"
                          : ambulances.length > 0
                            ? "You are here — tap a 🚑 pin to book it right away."
                            : "Map centred on your pickup point. Search to load nearby ambulances."}
                    </p>
                    <div className="h-[380px] overflow-hidden rounded-2xl border border-slate-200">
                      <AmbulanceMap
                        ambulances={ambulances}
                        center={coords}
                        onSelect={selectAmbulance}
                      />
                    </div>
                  </div>
                )}

                {/* results or empty state */}
                {!searching && hasSearched && !searchError && ambulances.length === 0 && (
                  <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center">
                    <AmbulanceIcon className="mx-auto size-10 text-slate-300" />
                    <p className="mt-3 font-bold text-slate-600">
                      No available ambulances in range
                    </p>
                    <p className="text-sm text-slate-400">
                      Increase the distance or try “Use my location”.
                    </p>
                  </div>
                )}

                {!searching && hasSearched && ambulances.length > 0 && (
                  <div className="rk-scroll mt-5 grid max-h-72 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                    {ambulances.map((amb) => (
                      <div
                        key={amb._id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-200 hover:shadow-md"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 font-bold text-slate-900">
                            🚑 {amb.vehicleNumber}
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_META[amb.type]?.badge}`}>
                              {amb.type}
                            </span>
                          </p>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {amb.driverName || "Driver details available after booking"}
                          </p>
                          <p className="mt-1 text-xs font-bold text-brand-600">
                            {formatDistance(amb.distance)} away
                            {amb.etaMinutes != null && (
                              <span> · {formatEta(amb.etaMinutes)}</span>
                            )}
                          </p>
                        </div>
                        <Button size="sm" onClick={() => selectAmbulance(amb)}>
                          Book
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </section>

          {/* ============ BOOK + LIVE ============ */}
          <aside className="space-y-6">
            <Card id="book-section" className="scroll-mt-20">
              <CardHeader
                title="Book ambulance"
                subtitle="Select a vehicle, confirm details, done."
              />
              <div className="p-5 sm:p-6">
                {/* step indicator */}
                <div className="mb-5 flex items-center gap-1.5">
                  {BOOK_STEPS.map((label, i) => {
                    const n = i + 1;
                    const active = bookStep === n;
                    const done = bookStep > n;
                    return (
                      <div key={label} className="flex flex-1 flex-col items-center gap-1">
                        <span
                          className={`grid size-8 place-items-center rounded-full text-xs font-bold ${
                            done
                              ? "bg-emerald-500 text-white"
                              : active
                                ? "bg-brand-600 text-white"
                                : "bg-slate-200 text-slate-500"
                          }`}
                        >
                          {done ? "✓" : n}
                        </span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${active ? "text-brand-700" : "text-slate-400"}`}>
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {!justBooked && (
                  <form onSubmit={bookAmbulance} className="space-y-3.5">
                    {selectedAmbulance ? (
                      <div className="flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
                        <div>
                          <p className="font-bold text-slate-900">
                            🚑 {selectedAmbulance.vehicleNumber}
                          </p>
                          <p className="text-xs text-slate-500">
                            {selectedAmbulance.type} · {formatDistance(selectedAmbulance.distance) || "0 km"} away
                            {selectedAmbulance.etaMinutes != null && (
                              <span className="font-bold text-brand-600">
                                {" "}· ⏱ {formatEta(selectedAmbulance.etaMinutes)}
                              </span>
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedAmbulance(null)}
                          className="rounded-lg p-1 text-slate-400 transition hover:bg-white hover:text-slate-600"
                          aria-label="Deselect"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-center">
                        <MapPin className="mx-auto size-7 text-slate-300" />
                        <p className="mt-2 text-sm font-semibold text-slate-600">
                          Select an ambulance first
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Search nearby and choose a vehicle — or tap a pin on the map.
                        </p>
                      </div>
                    )}

                    <Field
                      label="Patient name"
                      type="text"
                      placeholder="Patient name"
                      name="patientName"
                      value={bookingForm.patientName}
                      onChange={handleBookingForm}
                      required
                    />
                    <Field
                      label="Patient phone"
                      type="tel"
                      placeholder="+91 98765 43210"
                      name="patientPhone"
                      value={bookingForm.patientPhone}
                      onChange={handleBookingForm}
                      required
                    />
                    <Field
                      label="Destination"
                      type="text"
                      placeholder="Hospital or address"
                      name="destination"
                      value={bookingForm.destination}
                      onChange={handleBookingForm}
                      required
                    />

                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      <MapPin className="size-3.5 text-sky-600" />
                      Pickup: {pickupAddress || addressQuery.trim() || formatCoordinates(coords)}
                    </p>

                    {bookingError && (
                      <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">
                        {bookingError}
                      </p>
                    )}

                    <Button
                      type="submit"
                      size="lg"
                      className="w-full"
                      disabled={bookingLoading || !selectedAmbulance}
                    >
                      {bookingLoading
                        ? "Booking…"
                        : selectedAmbulance
                          ? "Confirm booking"
                          : "Select an ambulance first"}
                    </Button>
                  </form>
                )}

                {justBooked && (
                  <div className="anim-slide-in rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="flex items-center gap-2 font-bold text-emerald-800">
                      <ShieldCheck className="size-5" /> Ambulance booked!
                    </p>
                    <p className="mt-2 text-sm text-emerald-700">
                      🚑 {justBooked.ambulance?.vehicleNumber} →
                      {justBooked.destination}
                    </p>
                    {justBooked.etaMinutes != null && (
                      <p className="mt-1 text-sm font-semibold text-emerald-800">
                        ⏱ Arriving in {formatEta(justBooked.etaMinutes)}
                      </p>
                    )}
                    <p className="mt-1 text-sm text-emerald-700">
                      Status:{" "}
                      <span className="font-bold">
                        {STATUS_META[justBooked.status]?.label || justBooked.status}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </Card>

            {/* live trip */}
            <Card id="live-section" className="scroll-mt-20">
              <CardHeader
                title={activeTripIsRunning ? "Live trip" : activeTrip ? "Trip details" : "Live trip"}
                subtitle={
                  activeTripIsRunning
                    ? "Real-time position & status"
                    : activeTrip
                      ? "Trip status"
                      : "Tracking appears here"
                }
                action={
                  activeTripIsRunning ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                      <span className="size-1.5 rounded-full bg-emerald-500 anim-pulse-dot" /> LIVE
                    </span>
                  ) : activeTrip ? (
                    <StatusPill status={activeTrip.status} />
                  ) : null
                }
              />
              <div className="p-5 sm:p-6">
                {activeTrip ? (
                  <div className="space-y-4">
                    <div className="h-56 overflow-hidden rounded-2xl border border-slate-200">
                      <TripMap booking={activeTrip} />
                    </div>

                    <StatusStepper status={activeTrip.status} />

                    {activeTrip.status === "completed" ? (
                      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                        <ShieldCheck className="size-4" /> Arrived at destination
                      </p>
                    ) : activeTrip.status === "cancelled" ? (
                      <p className="flex items-center gap-2 text-sm font-semibold text-rose-600">
                        <X className="size-4" /> Booking cancelled
                      </p>
                    ) : (
                      <p className="flex items-center gap-2 text-sm font-semibold text-brand-700">
                        <Timer className="size-4" />
                        {activeEta ? `Arriving in ${activeEta}` : "Computing ETA…"}
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                          <UserRound className="size-3.5" /> Patient
                        </p>
                        <p className="mt-1 font-bold text-slate-900">
                          {activeTrip.patientName}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                          <Hospital className="size-3.5" /> Destination
                        </p>
                        <p className="mt-1 font-bold text-slate-900">
                          {activeTrip.destination}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500">
                        📞 Driver: {activeTrip.ambulance?.driverPhone || "—"}
                      </p>
                      <Button variant="ghost" size="sm" onClick={() => setActiveTripId(null)}>
                        Close
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-5 text-center">
                    <Timer className="mx-auto size-8 text-slate-300" />
                    <p className="mt-2 text-sm font-semibold text-slate-600">
                      No trip running
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Once you book, the ambulance position and status appear here in real time.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </aside>
        </div>

        {/* ============ MY BOOKINGS ============ */}
        <Card id="trips-section" className="mt-6 scroll-mt-20">
          <CardHeader
            title="My bookings"
            subtitle="Every trip, in one place."
            action={
              <Button variant="secondary" size="sm" onClick={loadBookings}>
                <RefreshCw className="size-3.5" /> Refresh
              </Button>
            }
          />
          <div className="p-5 sm:p-6">
            {historyError && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">
                {historyError}
              </p>
            )}

            {bookings.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                {[
                  ["all", "All"],
                  ["confirmed", "Confirmed"],
                  ["ongoing", "Ongoing"],
                  ["completed", "Completed"],
                  ["cancelled", "Cancelled"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setStatusFilter(value)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                      statusFilter === value
                        ? "bg-brand-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="ml-auto text-xs font-medium text-slate-400">
                  {filteredBookings.length} of {bookings.length}
                </span>
              </div>
            )}

            {!historyError && bookings.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center">
                <AmbulanceIcon className="mx-auto size-10 text-slate-300" />
                <p className="mt-3 font-bold text-slate-600">No bookings yet</p>
                <p className="text-sm text-slate-400">
                  Book an ambulance from the map above and it will show up here.
                </p>
              </div>
            )}

            {filteredBookings.length > 0 && (
              <ul className="space-y-3">
                {filteredBookings.map((bk) => (
                  <li
                    key={bk._id}
                    className={`rounded-2xl border p-4 transition ${
                      bk._id === activeTripId
                        ? "border-brand-300 bg-brand-50/50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-bold text-slate-900">
                          🚑 {bk.ambulance?.vehicleNumber || "Ambulance"}
                          <StatusPill status={bk.status} />
                        </p>
                        <p className="mt-1 truncate text-sm text-slate-500">
                          <Hospital className="mr-1 inline size-3.5" />
                          {bk.destination}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          🧑 {bk.patientName} · 📞 {bk.patientPhone} ·{" "}
                          {new Date(bk.createdAt).toLocaleString()}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setActiveTripId((cur) => (cur === bk._id ? null : bk._id));
                            if (bk._id !== activeTripId) {
                              document.getElementById("live-section")?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                            }
                          }}
                        >
                          <Navigation className="size-3.5" />
                          Track
                        </Button>
                        {(bk.status === "confirmed" || bk.status === "ongoing") && (
                          <Button variant="danger" size="sm" onClick={() => cancelBooking(bk._id)}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}