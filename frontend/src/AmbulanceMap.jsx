import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import MapViewport from "./MapViewport";
import { formatEta, STATUS_META, toLatLng } from "./lib/format";

const DEFAULT_CENTER = [30.7333, 76.7794];

// Simple emoji pins — avoids the broken default icon assets in Vite builds
const ambulanceIcon = L.divIcon({
  className: "map-marker ambulance-marker",
  html: "<span class='marker-pin'>🚑</span>",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -30],
});

const userIcon = L.divIcon({
  className: "map-marker user-marker",
  html: "<span class='marker-pin user-pin'>📍</span>",
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

// Keeps the map centred on the user's current coordinates
function FlyTo({ center }) {
  const map = useMap();

  useEffect(() => {
    if (center) {
      map.flyTo(center, map.getZoom());
    }
  }, [center, map]);

  return null;
}

// Live map of nearby ambulances. `ambulances` are GeoJSON docs with
// `location.coordinates = [longitude, latitude]`.
function AmbulanceMap({
  ambulances = [],
  center,
  onSelect,
  showUser = true,
  zoom = 13,
}) {
  const mapCenter = toLatLng([center?.lng, center?.lat]) || DEFAULT_CENTER;

  return (
    <MapContainer
      center={mapCenter}
      zoom={zoom}
      scrollWheelZoom={false}
      style={{ height: "100%", width: "100%" }}
    >
      <MapViewport />

      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FlyTo center={mapCenter} />

      {/* Your location */}
      {showUser && (
        <Marker position={mapCenter} icon={userIcon}>
          <Popup>You are here</Popup>
        </Marker>
      )}

      {/* Nearby ambulances */}
      {ambulances.map((amb) => {
        const position = toLatLng(amb.location?.coordinates);
        if (!position) return null;

        const statusLabel = STATUS_META[amb.status]?.label || amb.status || "Unknown";
        return (
          <Marker
            key={amb._id}
            position={position}
            icon={ambulanceIcon}
            eventHandlers={{ click: () => onSelect?.(amb) }}
          >
            <Popup>
              <strong>🚑 {amb.vehicleNumber}</strong>
              <br />
              {amb.type} • Driver: {amb.driverName || "assigned after booking"}
              <br />
              <span>Status: {statusLabel}</span>
              {amb.distance != null && (
                <>
                  <br />
                  <span>{(amb.distance / 1000).toFixed(2)} km away</span>
                </>
              )}
              {amb.etaMinutes != null && (
                <>
                  <br />
                  <span style={{ color: "#b51f1f", fontWeight: 700 }}>
                    ⏱ Arriving in {formatEta(amb.etaMinutes)}
                  </span>
                </>
              )}
              {onSelect ? (
                <>
                  <br />
                  <button
                    type="button"
                    onClick={() => onSelect(amb)}
                    className="mt-2 w-full rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-700"
                  >
                    Book this ambulance
                  </button>
                </>
              ) : null}
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}

export default AmbulanceMap;
