import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import MapViewport from "./MapViewport";
import { toLatLng } from "./lib/format";

const pickupIcon = L.divIcon({
  className: "map-marker trip-marker",
  html: "<span class='marker-pin'>📍</span>",
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

const ambulanceIcon = L.divIcon({
  className: "map-marker ambulance-marker",
  html: "<span class='marker-pin'>🚑</span>",
  iconSize: [30, 30],
  iconAnchor: [15, 30],
});

function createRoutePath(ambulance, pickup) {
  if (!ambulance || !pickup) return [];

  const [startLat, startLng] = ambulance;
  const [endLat, endLng] = pickup;
  const deltaLat = endLat - startLat;
  const deltaLng = endLng - startLng;
  const distance = Math.hypot(deltaLat, deltaLng);
  if (distance < 0.000001) return [ambulance, pickup];

  const normalLat = -deltaLat / distance;
  const normalLng = deltaLng / distance;
  const bend = Math.min(0.12, distance * 0.08);
  const control1 = [
    startLat + deltaLat * 0.3 + normalLat * bend,
    startLng + deltaLng * 0.3 + normalLng * bend,
  ];
  const control2 = [
    startLat + deltaLat * 0.7 - normalLat * bend,
    startLng + deltaLng * 0.7 - normalLng * bend,
  ];

  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24;
    const inverse = 1 - t;
    return [
      inverse ** 3 * startLat +
        3 * inverse ** 2 * t * control1[0] +
        3 * inverse * t ** 2 * control2[0] +
        t ** 3 * endLat,
      inverse ** 3 * startLng +
        3 * inverse ** 2 * t * control1[1] +
        3 * inverse * t ** 2 * control2[1] +
        t ** 3 * endLng,
    ];
  });
}

function FitTrip({ route }) {
  const map = useMap();

  useEffect(() => {
    if (route.length < 2) return;
    const bounds = L.latLngBounds(
      route.map(([latitude, longitude]) => [latitude, longitude])
    );
    map.fitBounds(bounds, {
      padding: [36, 36],
      maxZoom: 15,
      animate: true,
      duration: 0.45,
    });
  }, [map, route]);

  return null;
}

// Live map for a single trip. The route is recalculated as the ambulance marker
// moves, and the viewport keeps both the vehicle and pickup visible.
function TripMap({ booking }) {
  const pickup = toLatLng(booking?.pickupLocation?.coordinates);
  const ambulance = toLatLng(booking?.ambulance?.location?.coordinates);
  const pickupLatitude = pickup?.[0];
  const pickupLongitude = pickup?.[1];
  const ambulanceLatitude = ambulance?.[0];
  const ambulanceLongitude = ambulance?.[1];
  const route = useMemo(
    () =>
      createRoutePath(
        ambulanceLatitude === undefined
          ? null
          : [ambulanceLatitude, ambulanceLongitude],
        pickupLatitude === undefined ? null : [pickupLatitude, pickupLongitude]
      ),
    [
      ambulanceLatitude,
      ambulanceLongitude,
      pickupLatitude,
      pickupLongitude,
    ]
  );
  const isLive = ["confirmed", "ongoing"].includes(booking?.status);

  if (!pickup) {
    return (
      <div className="grid h-full place-items-center bg-slate-50 p-6 text-center text-sm text-slate-500">
        Pickup location is unavailable for this trip.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        key={booking?._id || "trip"}
        center={pickup}
        zoom={13}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <MapViewport />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitTrip route={route} />

        <Marker position={pickup} icon={pickupIcon}>
          <Popup>
            <strong>📍 Pickup</strong>
            {booking?.pickupAddress && (
              <>
                <br />
                {booking.pickupAddress}
              </>
            )}
            <br />
            {booking?.destination ? `→ ${booking.destination}` : "—"}
          </Popup>
        </Marker>

        {ambulance && (
          <Marker position={ambulance} icon={ambulanceIcon}>
            <Popup>
              <strong>🚑 {booking?.ambulance?.vehicleNumber || "Ambulance"}</strong>
              <br />
              Status: {booking?.status || "—"}
            </Popup>
          </Marker>
        )}

        {route.length > 1 && (
          <>
            <Polyline
              positions={route}
              pathOptions={{ color: "#ffffff", weight: 8, opacity: 0.9 }}
            />
            <Polyline
              positions={route}
              pathOptions={{ color: "#d62828", weight: 4, opacity: 0.95 }}
            />
          </>
        )}
      </MapContainer>

      {isLive && (
        <div className="pointer-events-none absolute left-3 top-3 z-[500] inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-lg ring-1 ring-slate-200">
          <span className="size-2 rounded-full bg-emerald-500 anim-pulse-dot" />
          Live route · updating
        </div>
      )}
    </div>
  );
}

export default TripMap;
