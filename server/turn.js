const crypto = require("node:crypto");

const CREDENTIAL_TTL_SECONDS = 60 * 60;
const API_CACHE_MS = 10 * 60 * 1000;

const STUN_ONLY = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

let apiCache = { servers: null, fetchedAt: 0 };

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

function normaliseApiResponse(payload) {
  const list = Array.isArray(payload) ? payload : payload?.iceServers;
  if (!Array.isArray(list)) return null;

  const servers = list.filter((entry) => entry && entry.urls);
  return servers.length > 0 ? servers : null;
}

async function fetchFromApi(url) {
  if (apiCache.servers && Date.now() - apiCache.fetchedAt < API_CACHE_MS) {
    return apiCache.servers;
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("TURN API responded " + response.status);

  const servers = normaliseApiResponse(await response.json());
  if (!servers) throw new Error("TURN API returned no usable iceServers");

  apiCache = { servers, fetchedAt: Date.now() };
  return servers;
}

async function getIceServers() {
  if (process.env.TURN_API_URL) {
    try {
      const servers = await fetchFromApi(process.env.TURN_API_URL);
      const hasTurn = servers.some((s) => String(s.urls).includes("turn:") || String(s.urls).includes("turns:"));
      return { iceServers: [...STUN_ONLY, ...servers], hasTurn, mode: hasTurn ? "api" : "api-no-turn" };
    } catch (error) {
      console.warn("[turn] could not load credentials from TURN_API_URL:", error.message);
      return { iceServers: STUN_ONLY, hasTurn: false, mode: "api-failed" };
    }
  }

  const urls = process.env.TURN_URL ? splitUrls(process.env.TURN_URL) : null;

  if (!urls || urls.length === 0) {
    return { iceServers: STUN_ONLY, hasTurn: false, mode: "none" };
  }

  if (process.env.TURN_SECRET) {
    const { username, credential } = ephemeralCredentials(process.env.TURN_SECRET);
    return {
      iceServers: [...STUN_ONLY, { urls, username, credential }],
      hasTurn: true,
      mode: "ephemeral",
    };
  }

  if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    return {
      iceServers: [
        ...STUN_ONLY,
        {
          urls,
          username: process.env.TURN_USERNAME,
          credential: process.env.TURN_CREDENTIAL,
        },
      ],
      hasTurn: true,
      mode: "static",
    };
  }

  return { iceServers: STUN_ONLY, hasTurn: false, mode: "incomplete" };
}

module.exports = { getIceServers, CREDENTIAL_TTL_SECONDS };
