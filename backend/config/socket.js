const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getCorsOrigins } = require("./cors");
const { getJwtSecret } = require("./env");

const VALID_ROLES = new Set(["patient", "driver", "admin"]);
const USER_ROOM_PREFIX = "user:";
const ROLE_ROOM_PREFIX = "role:";

let io = null;

function getId(value) {
  const id = value?._id ?? value?.id ?? value;
  if (id === undefined || id === null || id === "") return null;
  return String(id);
}

function userRoom(userId) {
  const id = getId(userId);
  return id ? `${USER_ROOM_PREFIX}${id}` : null;
}

function roleRoom(role) {
  if (typeof role !== "string" || !VALID_ROLES.has(role)) return null;
  return `${ROLE_ROOM_PREFIX}${role}`;
}

async function authenticateSocket(socket) {
  const token = socket.handshake.auth?.token;

  if (!token) throw new Error("Unauthorized: no token");

  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret());
  } catch {
    throw new Error("Unauthorized: invalid token");
  }

  if (!decoded?.id) {
    throw new Error("Unauthorized: invalid token");
  }

  let user;
  try {
    // Use the current database role, not the possibly-stale role in the JWT.
    user = await User.findById(decoded.id).select("role");
  } catch {
    throw new Error("Unauthorized: authentication failed");
  }

  const userId = getId(user);
  const role = user?.role;

  if (!userId || !VALID_ROLES.has(role)) {
    throw new Error("Unauthorized: user no longer exists");
  }

  socket.data.user = { id: userId, role };
  socket.data.userId = userId;
  socket.data.role = role;

  return socket.data.user;
}

function joinPrivateRooms(socket) {
  const rooms = [
    userRoom(socket.data.userId),
    roleRoom(socket.data.role),
  ].filter(Boolean);

  if (rooms.length) socket.join(rooms);
  return rooms;
}

function init(server) {
  if (io) return io;

  io = new Server(server, {
    cors: { origin: getCorsOrigins(), methods: ["GET", "POST", "PATCH"] },
  });

  // Authenticate the user and derive authorization data from the current
  // database record before allowing the live connection.
  io.use((socket, next) => {
    authenticateSocket(socket).then(
      () => next(),
      (error) => next(error)
    );
  });

  io.on("connection", (socket) => {
    // Rooms are assigned only by the server; clients cannot join them directly.
    joinPrivateRooms(socket);
    console.log("⚡ client connected:", socket.id);

    socket.on("disconnect", () => {
      console.log("✖ client disconnected:", socket.id);
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitToRooms(event, payload, rooms) {
  if (!io) return;

  const uniqueRooms = [...new Set(
    (Array.isArray(rooms) ? rooms : [rooms]).filter(
      (room) => typeof room === "string" && room.length > 0
    )
  )];

  if (uniqueRooms.length) io.to(uniqueRooms).emit(event, payload);
}

function emitToUser(event, payload, userId) {
  emitToRooms(event, payload, [userRoom(userId)]);
}

function emitToRoles(event, payload, roles) {
  emitToRooms(
    event,
    payload,
    (Array.isArray(roles) ? roles : [roles]).map(roleRoom).filter(Boolean)
  );
}

// Kept for non-sensitive fleet-wide events such as ambulance coordinates.
function emit(event, payload) {
  if (io) io.emit(event, payload);
}

module.exports = {
  init,
  getIO,
  emit,
  emitToRooms,
  emitToUser,
  emitToRoles,
  userRoom,
  roleRoom,
  authenticateSocket,
  joinPrivateRooms,
};
