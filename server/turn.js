const crypto = require("node:crypto");

const CREDENTIAL_TTL_SECONDS = 60 * 60;

function splitUrls(value) {
  return String(value)
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function ephemeralCredentials(secret) {
  const expiresAt = Math.floor(Date.now() / 1000) + CREDENTIAL_TTL_SECONDS;
  const username = `${expiresAt}:pulse`;
  const credential = crypto
    .createHmac("sha1", secret)
    .update(username)
    .digest("base64");

  return { username, credential };
}

function getIceServers() {
  const iceServers = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];

  const urls = process.env.TURN_URL ? splitUrls(process.env.TURN_URL) : null;

  if (!urls || urls.length === 0) {
    return { iceServers, hasTurn: false, mode: "none" };
  }

  if (process.env.TURN_SECRET) {
    const { username, credential } = ephemeralCredentials(process.env.TURN_SECRET);
    iceServers.push({ urls, username, credential });
    return { iceServers, hasTurn: true, mode: "ephemeral" };
  }

  if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
    return { iceServers, hasTurn: true, mode: "static" };
  }

  return { iceServers, hasTurn: false, mode: "incomplete" };
}

module.exports = { getIceServers, CREDENTIAL_TTL_SECONDS };
