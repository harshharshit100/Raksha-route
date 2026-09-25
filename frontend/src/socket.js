import { io } from "socket.io-client";

let socket = null;

function getSocketUrl() {
  return import.meta.env.VITE_SOCKET_URL || window.location.origin;
}

export function getSocket() {
  if (!socket) {
    // In production an unset VITE_SOCKET_URL uses the current origin and the
    // /socket.io proxy. A public backend origin can be supplied at build time.
    socket = io(getSocketUrl(), {
      // Read the token for every connection attempt, including reconnects.
      auth: (callback) => {
        callback({ token: localStorage.getItem("raksharoute_token") || "" });
      },
      // Polling first works reliably through HTTP proxies and upgrades to
      // WebSocket once the connection is established.
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });
  }
  return socket;
}

// Subscribe to a live event; returns an unsubscribe function
export function onLive(event, handler) {
  const s = getSocket();
  s.on(event, handler);
  s.connect();
  return () => s.off(event, handler);
}

export function connectSocket() {
  const s = getSocket();
  s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket) {
    socket.close();
    socket = null;
  }
}
