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
}

module.exports = { register };
