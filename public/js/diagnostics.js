const MAX_ENTRIES = 300;
const entries = [];
const startedAt = Date.now();

export function record(event, detail) {
  entries.push({
    at: Date.now() - startedAt,
    event,
    detail: detail === undefined ? "" : String(detail),
  });

  if (entries.length > MAX_ENTRIES) entries.shift();
}

export function snapshot() {
  const lines = [
    "Pulse connection log",
    new Date().toISOString(),
    navigator.userAgent,
    "installed app: " + window.matchMedia("(display-mode: standalone)").matches,
    "wake lock support: " + ("wakeLock" in navigator),
    "web lock support: " + Boolean(navigator.locks),
    "media session support: " + ("mediaSession" in navigator),
    "",
  ];

  entries.forEach(({ at, event, detail }) => {
    lines.push(`${(at / 1000).toFixed(1)}s  ${event}${detail ? "  " + detail : ""}`);
  });

  return lines.join("\n");
}

document.addEventListener("visibilitychange", () =>
  record(document.hidden ? "page hidden" : "page visible")
);

document.addEventListener("freeze", () => record("page FROZEN by the browser"));
document.addEventListener("resume", () => record("page resumed after freeze"));

window.addEventListener("pagehide", (event) =>
  record("pagehide", event.persisted ? "kept in memory" : "discarded")
);
window.addEventListener("pageshow", (event) =>
  record("pageshow", event.persisted ? "restored from memory" : "fresh load")
);

window.addEventListener("online", () => record("network online"));
window.addEventListener("offline", () => record("network offline"));

record("page loaded");
