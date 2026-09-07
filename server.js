const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");

const config = require("./server/config");
const rooms = require("./server/rooms");
const uploads = require("./server/uploads");
const turn = require("./server/turn");
const chatEvents = require("./server/chat-events");
const callEvents = require("./server/call-events");

const app = express();

app.get("/healthz", (req, res) => {
  res.set("Cache-Control", "no-store").type("text/plain").send("ok");
});

app.get("/ice-config", async (req, res) => {
  const { iceServers, hasTurn } = await turn.getIceServers();

  res
    .set("Cache-Control", "no-store")
    .json({ iceServers, iceCandidatePoolSize: 4, hasTurn });
});

app.use(express.static(path.join(__dirname, "public")));

app.use(
  "/uploads",
  express.static(uploads.uploadDir, {
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  })
);

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  maxHttpBufferSize: config.MAX_FILE_BYTES + 1024 * 1024,
  pingInterval: 25000,
  pingTimeout: 60000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

io.on("connection", (socket) => {
  const session = {
    username: null,
    room: null,
    lastMessageAt: 0,
  };

  chatEvents.register(io, socket, session);
  callEvents.register(io, socket, session);

  socket.emit("lobby_stats", rooms.getActiveRooms());

  socket.on("disconnect", () => {
    if (!session.room) return;

    rooms.removeMember(session.room, socket.id);
    socket.to(session.room).emit("system_message", `${session.username} left`);
    socket.to(session.room).emit("screen_share_stopped", socket.id);
    rooms.announce(io, session.room);
  });
});

httpServer.listen(config.PORT, async () => {
  console.log("");
  console.log("  Pulse is running.");
  console.log(`  Open your browser to:  http://localhost:${config.PORT}`);
  console.log("");

  const ice = await turn.getIceServers();
  const notes = {
    api: "  TURN: on, credentials loaded from TURN_API_URL",
    ephemeral: "  TURN: on, time-limited credentials (recommended)",
    static: "  TURN: on, fixed credentials",
    "api-no-turn": "  TURN: OFF - TURN_API_URL returned no turn: servers.",
    "api-failed": "  TURN: OFF - TURN_API_URL could not be loaded (see warning above).",
    incomplete:
      "  TURN: OFF - TURN_URL is set but credentials are missing.\n        Set TURN_SECRET, or TURN_USERNAME and TURN_CREDENTIAL.",
    none:
      "  TURN: off - voice and screen only reach the same network.\n        Set TURN_API_URL or TURN_URL to allow calls across networks.",
  };

  console.log(notes[ice.mode] || notes.none);
  console.log("");
  console.log("  Press Ctrl+C here to stop the server.");
  console.log("");
});
