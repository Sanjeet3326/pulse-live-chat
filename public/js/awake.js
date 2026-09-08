import { record } from "./diagnostics.js";

const RESTART_GAP_MS = 1000;

export function keepPlaying(element) {
  clearTimeout(element.restartTimer);

  const since = Date.now() - (element.restartedAt || 0);
  const wait = Math.max(0, RESTART_GAP_MS - since);

  element.restartTimer = setTimeout(() => {
    if (!element.isConnected || !element.paused) return;

    element.restartedAt = Date.now();
    element.play().catch(() => {});
  }, wait);
}

let wantsLock = false;
let lock = null;

export async function keepScreenAwake() {
  wantsLock = true;
  await requestLock();
  return Boolean(lock);
}

export function letScreenSleep() {
  wantsLock = false;

  const held = lock;
  lock = null;
  held?.release().catch(() => {});
}

async function requestLock() {
  if (lock || !wantsLock || document.hidden) return;
  if (!("wakeLock" in navigator)) return;

  try {
    lock = await navigator.wakeLock.request("screen");
    record("screen wake lock held");

    lock.addEventListener("release", () => {
      lock = null;
      record("screen wake lock released");
    });
  } catch (err) {
    lock = null;
    record("screen wake lock refused", err.name);
  }
}

let releaseActivity = null;

export function holdActivity() {
  if (releaseActivity || !navigator.locks) return;

  navigator.locks
    .request("pulse-call", () => {
      record("activity lock held");
      return new Promise((resolve) => {
        releaseActivity = resolve;
      });
    })
    .catch(() => {
      releaseActivity = null;
    });
}

export function releaseActivityLock() {
  if (!releaseActivity) return;

  releaseActivity();
  releaseActivity = null;
  record("activity lock released");
}

let holder = null;

export function holdAudioFocus() {
  if (holder) return;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  try {
    const context = new Ctx();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const sink = context.createMediaStreamDestination();

    oscillator.frequency.value = 40;
    gain.gain.value = 0.002;

    oscillator.connect(gain);
    gain.connect(sink);
    oscillator.start();

    const element = document.createElement("audio");
    element.id = "audio-focus-holder";
    element.srcObject = sink.stream;
    element.autoplay = true;
    element.setAttribute("playsinline", "");
    document.body.appendChild(element);
    element.play().catch(() => {});
    element.addEventListener("pause", () => {
      if (holder?.element === element) keepPlaying(element);
    });

    holder = { context, oscillator, element };
  } catch {
    holder = null;
  }
}

export function releaseAudioFocus() {
  if (!holder) return;

  const { context, oscillator, element } = holder;
  holder = null;

  try {
    oscillator.stop();
  } catch {}

  element.pause();
  element.srcObject = null;
  element.remove();
  context.close().catch(() => {});
}

const SESSION_ACTIONS = ["play", "pause", "stop", "hangup"];

function setAction(name, handler) {
  try {
    navigator.mediaSession.setActionHandler(name, handler);
  } catch {}
}

export function showOngoingCall(roomName, { onStop, onResume }) {
  if (!("mediaSession" in navigator)) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "Voice call",
      artist: roomName,
      album: "Pulse",
      artwork: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
    navigator.mediaSession.playbackState = "playing";
  } catch {}

  setAction("play", () => {
    navigator.mediaSession.playbackState = "playing";
    onResume?.();
  });

  setAction("pause", () => {
    navigator.mediaSession.playbackState = "playing";
    onResume?.();
  });

  setAction("stop", () => onStop?.());
  setAction("hangup", () => onStop?.());
}

export function clearOngoingCall() {
  if (!("mediaSession" in navigator)) return;

  SESSION_ACTIONS.forEach((name) => setAction(name, null));

  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  } catch {}
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;

  requestLock();
  holder?.context.resume().catch(() => {});
  if (holder?.element.paused) keepPlaying(holder.element);
});
