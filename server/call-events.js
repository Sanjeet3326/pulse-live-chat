const rooms = require("./rooms");

function register(io, socket, session) {
  socket.on("webrtc_signal", ({ to, description, candidate }) => {
    if (!to) return;

    io.to(to).emit("webrtc_signal", {
      from: socket.id,
      description,
      candidate,
    });
  });

  socket.on("call_state", ({ micOn, sharing }) => {
    if (!session.room) return;

    const changes = {};
    if (typeof micOn === "boolean") changes.micOn = micOn;
    if (typeof sharing === "boolean") changes.sharing = sharing;

    rooms.updateMember(session.room, socket.id, changes);
    rooms.broadcastMembers(io, session.room);

    if (changes.sharing === false) {
      socket.to(session.room).emit("screen_share_stopped", socket.id);
    }
  });

  socket.on("request_screen", ({ to }) => {
    if (!session.room || !to || to === socket.id) return;

    const target = rooms.getMembers(session.room).find((m) => m.id === to);
    if (!target) return;

    io.to(to).emit("screen_request", {
      from: socket.id,
      username: session.username,
    });
  });

  socket.on("screen_request_reply", ({ to, allowed }) => {
    if (!session.room || !to) return;

    const asker = rooms.getMembers(session.room).find((m) => m.id === to);
    if (!asker) return;

    io.to(to).emit("screen_request_reply", {
      from: socket.id,
      username: session.username,
      allowed: Boolean(allowed),
    });
  });

  socket.on("screen_access", ({ to, allowed }) => {
    if (!session.room || !to) return;

    const target = rooms.getMembers(session.room).find((m) => m.id === to);
    if (!target) return;

    io.to(to).emit("screen_access", {
      from: socket.id,
      username: session.username,
      allowed: Boolean(allowed),
    });
  });
}

module.exports = { register };
