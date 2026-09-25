const assert = require("node:assert/strict");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET ||= "socket-auth-test-secret";

const User = require("../models/User");
const {
  authenticateSocket,
  joinPrivateRooms,
  roleRoom,
  userRoom,
} = require("../config/socket");

async function withUserLookup(lookup, run) {
  const originalFindById = User.findById;
  User.findById = lookup;

  try {
    return await run();
  } finally {
    User.findById = originalFindById;
  }
}

test("socket auth attaches the current database user and role", async () => {
  const userId = "user-current-role";
  const token = jwt.sign(
    { id: userId, role: "admin" },
    process.env.JWT_SECRET
  );
  const socket = { handshake: { auth: { token } }, data: {} };

  await withUserLookup(
    (requestedId) => {
      assert.equal(requestedId, userId);
      return {
        select: async (fields) => {
          assert.equal(fields, "role");
          return { _id: userId, role: "patient" };
        },
      };
    },
    async () => {
      const user = await authenticateSocket(socket);

      assert.deepEqual(user, { id: userId, role: "patient" });
      assert.deepEqual(socket.data, {
        user: { id: userId, role: "patient" },
        userId,
        role: "patient",
      });
    }
  );
});

test("server-assigned rooms combine the private user and current role", () => {
  const joined = [];
  const rooms = joinPrivateRooms({
    data: { userId: "user-123", role: "driver" },
    join: (roomNames) => joined.push(roomNames),
  });

  assert.deepEqual(rooms, ["user:user-123", "role:driver"]);
  assert.deepEqual(joined, [rooms]);
  assert.equal(userRoom({ _id: "user-123" }), "user:user-123");
  assert.equal(roleRoom("admin"), "role:admin");
  assert.equal(roleRoom("unknown"), null);
});

test("socket auth rejects missing, invalid, and deleted users", async () => {
  await assert.rejects(
    () => authenticateSocket({ handshake: { auth: {} }, data: {} }),
    { message: "Unauthorized: no token" }
  );

  await assert.rejects(
    () =>
      authenticateSocket({
        handshake: { auth: { token: "not-a-jwt" } },
        data: {},
      }),
    { message: "Unauthorized: invalid token" }
  );

  const deletedUserId = "deleted-user";
  const token = jwt.sign(
    { id: deletedUserId, role: "patient" },
    process.env.JWT_SECRET
  );

  await withUserLookup(
    () => ({ select: async () => null }),
    () =>
      assert.rejects(
        () =>
          authenticateSocket({
            handshake: { auth: { token } },
            data: {},
          }),
        { message: "Unauthorized: user no longer exists" }
      )
  );
});
