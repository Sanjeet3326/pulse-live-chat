const rooms = new Map();

function addMember(code, roomName, { id, username, isOwner }) {
  if (!rooms.has(code)) {
    rooms.set(code, { name: roomName, members: new Map() });
  }

  rooms.get(code).members.set(id, {
    id,
    username,
    isOwner: Boolean(isOwner),
    micOn: false,
    sharing: false,
  });
}

function removeMember(code, id) {
  const room = rooms.get(code);
  if (!room) return;

  room.members.delete(id);
  if (room.members.size === 0) rooms.delete(code);
}

function updateMember(code, id, changes) {
  const member = rooms.get(code)?.members.get(id);
  if (!member) return;

  Object.assign(member, changes);
}

function getRoomName(code) {
  return rooms.get(code)?.name || code;
}

function getMembers(code) {
  return Array.from(rooms.get(code)?.members.values() ?? []);
}

function getActiveRooms() {
  return Array.from(rooms.entries())
    .map(([code, room]) => ({
      code,
      name: room.name,
      count: room.members.size,
    }))
    .sort((a, b) => b.count - a.count);
}

function broadcastMembers(io, code) {
  io.to(code).emit("room_members", getMembers(code));
}

function broadcastLobbyStats(io) {
  io.emit("lobby_stats", getActiveRooms());
}

function announce(io, code) {
  broadcastMembers(io, code);
  broadcastLobbyStats(io);
}

module.exports = {
  addMember,
  removeMember,
  updateMember,
  getMembers,
  getRoomName,
  getActiveRooms,
  broadcastMembers,
  broadcastLobbyStats,
  announce,
};
