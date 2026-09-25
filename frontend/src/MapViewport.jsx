import { useEffect } from "react";
import { useMap } from "react-leaflet";

export default function MapViewport() {
  const map = useMap();

  useEffect(() => {
    const updateSize = () => {
      map.invalidateSize({ animate: false, pan: false });
    };

    const frame = requestAnimationFrame(updateSize);
    const container = map.getContainer();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateSize);

    observer?.observe(container);
    window.addEventListener("resize", updateSize);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, [map]);

  return null;
}
