const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const config = require("./config");

const db = new DatabaseSync(path.join(__dirname, "..", config.DB_FILE));

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    code       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    room       TEXT NOT NULL,
    username   TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room, id);
`);

function addColumn(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!existing.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumn("rooms", "password_salt", "TEXT");
addColumn("rooms", "password_key", "TEXT");
addColumn("messages", "kind", "TEXT NOT NULL DEFAULT 'text'");
addColumn("messages", "file_url", "TEXT");
addColumn("messages", "file_name", "TEXT");
addColumn("messages", "file_type", "TEXT");
addColumn("messages", "file_size", "INTEGER");

const insertRoom = db.prepare(
  `INSERT INTO rooms (code, name, created_by, created_at, password_salt, password_key)
   VALUES (?, ?, ?, ?, ?, ?)`
);

const selectRoom = db.prepare(
  `SELECT code, name, created_by, created_at, password_salt, password_key
     FROM rooms WHERE code = ?`
);

const insertMessage = db.prepare(
  `INSERT INTO messages (room, username, text, created_at, kind, file_url, file_name, file_type, file_size)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const selectRecent = db.prepare(
  `SELECT username, text, created_at, kind, file_url, file_name, file_type, file_size
     FROM messages
    WHERE room = ?
    ORDER BY id DESC
    LIMIT ?`
);

function createRoom({ code, name, createdBy, passwordSalt, passwordKey }) {
  insertRoom.run(
    code,
    name,
    createdBy,
    new Date().toISOString(),
    passwordSalt ?? null,
    passwordKey ?? null
  );
}

function getRoom(code) {
  return selectRoom.get(code);
}

function roomExists(code) {
  return selectRoom.get(code) !== undefined;
}

function saveMessage({ room, username, text, createdAt, kind, file }) {
  insertMessage.run(
    room,
    username,
    text ?? "",
    createdAt,
    kind ?? "text",
    file?.url ?? null,
    file?.name ?? null,
    file?.type ?? null,
    file?.size ?? null
  );
}

function toMessage(row) {
  const message = {
    username: row.username,
    text: row.text,
    created_at: row.created_at,
    kind: row.kind || "text",
  };

  if (message.kind === "file") {
    message.file = {
      url: row.file_url,
      name: row.file_name,
      type: row.file_type,
      size: row.file_size,
    };
  }

  return message;
}

function getRecentMessages(room) {
  return selectRecent.all(room, config.HISTORY_LIMIT).map(toMessage).reverse();
}

module.exports = {
  createRoom,
  getRoom,
  roomExists,
  saveMessage,
  getRecentMessages,
};
