const config = require("./config");
const database = require("./database");
const rooms = require("./rooms");
const roomCodes = require("./room-codes");
const passwords = require("./passwords");
const uploads = require("./uploads");
const owners = require("./owners");

const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const pending = new Map();

function requestsFor(code) {
  return Array.from(pending.values())
    .filter((entry) => entry.code === code)
    .map((entry) => ({ id: entry.socket.id, username: entry.username }));
}

function notifyOwners(io, code) {
  const list = requestsFor(code);

  rooms
    .getMembers(code)
    .filter((member) => member.isOwner)
    .forEach((owner) => io.to(owner.id).emit("join_requests", list));
}

function dropRequest(io, id, message) {
  const entry = pending.get(id);
  if (!entry) return;

  clearTimeout(entry.timer);
  pending.delete(id);

  if (message) entry.socket.emit("join_denied", message);
  notifyOwners(io, entry.code);
}

function clean(value, maxLength) {
  return String(value ?? "")
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function enterRoom({ io, socket, session, username, room, isOwner, ownerToken }) {
  session.username = username;
  session.room = room.code;
  session.isOwner = Boolean(isOwner);

  socket.join(room.code);
  rooms.addMember(room.code, room.name, { id: socket.id, username, isOwner });

  socket.emit("joined", {
    id: socket.id,
    username,
    code: room.code,
    roomName: room.name,
    locked: Boolean(room.password_key),
    isOwner: Boolean(isOwner),
    ownerToken: ownerToken || undefined,
  });

  socket.emit("chat_history", database.getRecentMessages(room.code));
  socket.to(room.code).emit("system_message", `${username} joined`);
  rooms.announce(io, room.code);

  if (isOwner) notifyOwners(io, room.code);
}

function register(io, socket, session) {
  socket.on("create_room", ({ username, roomName, code, password, needsApproval }) => {
    const cleanUsername = clean(username, config.MAX_NAME_LENGTH);
    const cleanRoomName = clean(roomName, config.MAX_ROOM_NAME_LENGTH);

    if (!cleanUsername) {
      socket.emit("join_error", "Please enter your name.");
      return;
    }

    if (!cleanRoomName) {
      socket.emit("join_error", "Give the room a name, so people know what it's for.");
      return;
    }

    const requestedPassword = typeof password === "string" ? password.trim() : "";

    if (requestedPassword && requestedPassword.length < config.MIN_PASSWORD_LENGTH) {
      socket.emit(
        "join_error",
        `A room password needs at least ${config.MIN_PASSWORD_LENGTH} characters. Leave it blank for an open room.`
      );
      return;
    }

    if (requestedPassword.length > config.MAX_PASSWORD_LENGTH) {
      socket.emit("join_error", "That password is too long.");
      return;
    }

    let finalCode;
    const requestedCode = roomCodes.normalise(code);

    if (requestedCode) {
      if (requestedCode.length < config.MIN_CODE_LENGTH) {
        socket.emit(
          "join_error",
          `That code is too short — it needs at least ${config.MIN_CODE_LENGTH} characters. Leave it blank and we'll make one for you.`
        );
        return;
      }

      if (database.roomExists(requestedCode)) {
        socket.emit(
          "join_error",
          `The code ${requestedCode} is already taken. Try a different one, or leave it blank for a random code.`
        );
        return;
      }

      finalCode = requestedCode;
    } else {
      finalCode = roomCodes.generateUnique(database.roomExists);
    }

    const credentials = requestedPassword ? passwords.create(requestedPassword) : null;
    const owner = owners.createToken();

    database.createRoom({
      code: finalCode,
      name: cleanRoomName,
      createdBy: cleanUsername,
      passwordSalt: credentials?.salt,
      passwordKey: credentials?.key,
      ownerKey: owner.key,
      needsApproval: Boolean(needsApproval),
    });

    enterRoom({
      io,
      socket,
      session,
      username: cleanUsername,
      room: database.getRoom(finalCode),
      isOwner: true,
      ownerToken: owner.token,
    });
  });

  socket.on("join_room", ({ username, code, password, ownerToken }) => {
    const cleanUsername = clean(username, config.MAX_NAME_LENGTH);
    const cleanCode = roomCodes.normalise(code);

    if (!cleanUsername) {
      socket.emit("join_error", "Please enter your name.");
      return;
    }

    if (!cleanCode) {
      socket.emit("join_error", "Enter the room code you were given.");
      return;
    }

    const room = database.getRoom(cleanCode);

    if (!room) {
      socket.emit(
        "join_error",
        `No room found with the code ${cleanCode}. Check it with whoever invited you, or create a room of your own.`
      );
      return;
    }

    const owner = owners.isOwner(ownerToken, room.owner_key);

    if (!owner && owners.isBlocked(room.code, cleanUsername)) {
      socket.emit(
        "join_error",
        "You were removed from this room. You can try again later, or ask whoever runs it to let you back in."
      );
      return;
    }

    if (room.password_key && !owner) {
      const attempt = typeof password === "string" ? password : "";

      if (!attempt) {
        socket.emit("password_required", { code: room.code, roomName: room.name });
        return;
      }

      if (!passwords.verify(attempt, room.password_salt, room.password_key)) {
        socket.emit("password_rejected", "That password isn't right. Try again.");
        return;
      }
    }

    if (room.needs_approval && !owner) {
      const ownersPresent = rooms
        .getMembers(room.code)
        .filter((member) => member.isOwner).length;

      if (ownersPresent === 0) {
        socket.emit(
          "join_error",
          `${room.name} only lets people in when whoever runs it is here to approve. Try again when they're online.`
        );
        return;
      }

      dropRequest(io, socket.id);

      const timer = setTimeout(() => {
        dropRequest(
          io,
          socket.id,
          "Nobody answered your request in time. Try knocking again."
        );
      }, REQUEST_TIMEOUT_MS);

      pending.set(socket.id, {
        code: room.code,
        username: cleanUsername,
        socket,
        session,
        timer,
      });

      socket.emit("awaiting_approval", { roomName: room.name });
      notifyOwners(io, room.code);
      return;
    }

    enterRoom({ io, socket, session, username: cleanUsername, room, isOwner: owner });
  });

  socket.on("approve_join", ({ id }) => {
    if (!session.room || !session.isOwner) return;

    const entry = pending.get(id);
    if (!entry || entry.code !== session.room) return;

    const room = database.getRoom(entry.code);
    if (!room) return;

    clearTimeout(entry.timer);
    pending.delete(id);

    enterRoom({
      io,
      socket: entry.socket,
      session: entry.session,
      username: entry.username,
      room,
      isOwner: false,
    });

    notifyOwners(io, session.room);
  });

  socket.on("deny_join", ({ id }) => {
    if (!session.room || !session.isOwner) return;

    const entry = pending.get(id);
    if (!entry || entry.code !== session.room) return;

    dropRequest(io, id, `${session.username} didn't let you in.`);
  });

  socket.on("disconnect", () => {
    if (pending.has(socket.id)) dropRequest(io, socket.id);
  });

  socket.on("kick_member", ({ id }) => {
    if (!session.room || !session.isOwner || !id || id === socket.id) return;

    const target = rooms.getMembers(session.room).find((m) => m.id === id);
    if (!target || target.isOwner) return;

    owners.block(session.room, target.username);

    io.to(id).emit("kicked", {
      roomName: rooms.getRoomName(session.room),
      by: session.username,
    });

    const targetSocket = io.sockets.sockets.get(id);
    if (targetSocket) targetSocket.leave(session.room);

    rooms.removeMember(session.room, id);
    socket
      .to(session.room)
      .emit("system_message", `${target.username} was removed by ${session.username}`);
    socket.to(session.room).emit("screen_share_stopped", id);
    rooms.announce(io, session.room);
  });

  socket.on("send_message", ({ text }) => {
    if (!session.room || !session.username) return;

    const cleanText = clean(text, config.MAX_MESSAGE_LENGTH);
    if (!cleanText) return;

    const now = Date.now();
    if (now - session.lastMessageAt < config.MIN_MS_BETWEEN_MESSAGES) return;
    session.lastMessageAt = now;

    const createdAt = new Date().toISOString();

    database.saveMessage({
      room: session.room,
      username: session.username,
      text: cleanText,
      createdAt,
      kind: "text",
    });

    io.to(session.room).emit("receive_message", {
      username: session.username,
      text: cleanText,
      created_at: createdAt,
      kind: "text",
    });
  });

  socket.on("send_file", ({ name, type, data }, acknowledge) => {
    const respond = typeof acknowledge === "function" ? acknowledge : () => {};

    if (!session.room || !session.username) {
      respond({ error: "You're not in a room." });
      return;
    }

    const result = uploads.save({ data, name, type });

    if (result.error) {
      respond({ error: result.error });
      return;
    }

    const createdAt = new Date().toISOString();

    database.saveMessage({
      room: session.room,
      username: session.username,
      text: "",
      createdAt,
      kind: "file",
      file: result.file,
    });

    io.to(session.room).emit("receive_message", {
      username: session.username,
      text: "",
      created_at: createdAt,
      kind: "file",
      file: result.file,
    });

    respond({ ok: true });
  });

  socket.on("typing", () => {
    if (!session.room) return;
    socket.to(session.room).emit("user_typing", session.username);
  });

  socket.on("stop_typing", () => {
    if (!session.room) return;
    socket.to(session.room).emit("user_stop_typing", session.username);
  });
}

module.exports = { register };
