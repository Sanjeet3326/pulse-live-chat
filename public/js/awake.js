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
    lock.addEventListener("release", () => {
      lock = null;
    });
  } catch {
    lock = null;
  }
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

export function showOngoingCall(roomName) {
  if (!("mediaSession" in navigator)) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "Voice call",
      artist: roomName,
      album: "Pulse",
    });
    navigator.mediaSession.playbackState = "playing";
  } catch {}
}

export function clearOngoingCall() {
  if (!("mediaSession" in navigator)) return;

  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  } catch {}
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;

  requestLock();
  holder?.context.resume().catch(() => {});
  if (holder?.element.paused) holder.element.play().catch(() => {});
});
