const crypto = require("node:crypto");

const KEY_LENGTH = 64;

function create(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return { salt, key };
}

function verify(password, salt, key) {
  if (!salt || !key) return true;
  if (typeof password !== "string" || password.length === 0) return false;

  const attempt = crypto.scryptSync(password, salt, KEY_LENGTH);
  const stored = Buffer.from(key, "hex");

  if (stored.length !== attempt.length) return false;
  return crypto.timingSafeEqual(stored, attempt);
}

module.exports = { create, verify };
