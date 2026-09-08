import { socket } from "./socket.js";
import { $, colorFor } from "./ui.js";
import {
  keepScreenAwake,
  letScreenSleep,
  holdAudioFocus,
  releaseAudioFocus,
  showOngoingCall,
  clearOngoingCall,
} from "./awake.js";

const micBtn = $("mic-btn");
const micBtnText = $("mic-btn-text");
const muteBtn = $("mute-btn");
const muteBtnText = $("mute-btn-text");
const screenBtn = $("screen-btn");
const screenBtnText = $("screen-btn-text");
const callNote = $("call-note");
const stage = $("stage");
const stageTiles = $("stage-tiles");
const stageTitleText = $("stage-title-text");
const stageFullscreen = $("stage-fullscreen");
const appEl = $("chat-screen");
const audioContainer = $("audio-container");
const soundUnlock = $("sound-unlock");

let me = null;

const peers = new Map();
const names = new Map();

let micStream = null;
let screenStream = null;
let isMuted = false;

let rtcConfig = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
  iceCandidatePoolSize: 4,
};

let hasTurn = false;

fetch("/ice-config")
  .then((res) => res.json())
  .then((config) => {
    if (config?.iceServers?.length) {
      rtcConfig = { iceServers: config.iceServers, iceCandidatePoolSize: 4 };
      hasTurn = Boolean(config.hasTurn);
    }
    showReachNote();
  })
  .catch(() => {});

function showReachNote() {
  if (hasTurn || !navigator.mediaDevices?.getUserMedia) return;
  if (micStream || screenStream) return;
  callNote.textContent = "Best with people on the same WiFi.";
}

export function start(identity) {
  const isRejoin = me && me.id !== identity.id;
  me = identity;

  if (isRejoin) {
    for (const id of Array.from(peers.keys())) closePeer(id);
  }

  checkBrowserSupport();
  showReachNote();

  if (micStream) socket.emit("call_state", { micOn: true });
  if (screenStream) socket.emit("call_state", { sharing: true });
}

function setCallNote(text) {
  if (text || !micStream) callNote.textContent = text;
}

function checkBrowserSupport() {
  if (navigator.mediaDevices?.getUserMedia) {
    callNote.textContent = "";
    return;
  }

  micBtn.disabled = true;
  screenBtn.disabled = true;
  micBtn.style.opacity = screenBtn.style.opacity = "0.5";
  callNote.textContent =
    "Voice and screen sharing need a secure address. They work on localhost and on any https:// site, but not over a plain network IP. Text chat and files are unaffected.";
}

socket.on("room_members", (members) => {
  if (!me) return;

  const presentIds = new Set();

  roomMembers = members;

  members.forEach((member) => {
    names.set(member.id, member.username);
    presentIds.add(member.id);
    if (member.id !== me.id) ensurePeer(member.id);
  });

  for (const id of peers.keys()) {
    if (!presentIds.has(id)) closePeer(id);
  }

  refreshTileLabels();
});

function ensurePeer(remoteId) {
  const existing = peers.get(remoteId);
  if (existing) return existing;

  const pc = new RTCPeerConnection(rtcConfig);
  const peer = { pc, makingOffer: false, ignoreOffer: false, restarts: 0 };
  peers.set(remoteId, peer);

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;

    if (state === "failed" && peer.restarts < 2) {
      peer.restarts++;
      try {
        pc.restartIce();
      } catch {}
      setCallNote("Reconnecting media…");
    } else if (state === "failed") {
      setCallNote(
        hasTurn
          ? "Couldn't reach someone here for voice or screen. Chat still works."
          : "Couldn't connect voice or screen to someone on a different network. Chat, files and screen still work for anyone on your WiFi."
      );
    } else if (state === "connected" || state === "completed") {
      peer.restarts = 0;
      setCallNote("");
    }
  };

  if (micStream) addStreamToPeer(pc, micStream);
  if (screenStream && screenViewers.has(remoteId)) addStreamToPeer(pc, screenStream);

  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      socket.emit("webrtc_signal", {
        to: remoteId,
        description: pc.localDescription,
      });
    } catch (err) {
      console.error("[call] could not create offer:", err);
    } finally {
      peer.makingOffer = false;
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit("webrtc_signal", { to: remoteId, candidate });
  };

  pc.ontrack = (event) => {
    const [stream] = event.streams;

    if (event.track.kind === "audio") {
      playRemoteAudio(remoteId, stream);

      considerForSpeaking(remoteId, stream);
      stream.addEventListener("addtrack", () =>
        considerForSpeaking(remoteId, stream)
      );

      event.track.addEventListener("ended", () =>
        document.getElementById("audio-" + stream.id)?.remove()
      );
    } else {
      showTile(remoteId, stream, names.get(remoteId) || "Someone");
      event.track.addEventListener("ended", () => removeTile(remoteId));
      event.track.addEventListener("mute", () => removeTile(remoteId));
    }
  };

  return peer;
}

function closePeer(remoteId) {
  const peer = peers.get(remoteId);
  if (peer) {
    peer.pc.close();
    peers.delete(remoteId);
  }

  audioContainer
    .querySelectorAll(`audio[data-peer="${remoteId}"]`)
    .forEach((el) => el.remove());
  stopWatchingAudio(remoteId);
  removeTile(remoteId);
  forgetAsksFrom(remoteId);
  names.delete(remoteId);
}

function addStreamToPeer(pc, stream) {
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
}

function removeStreamFromPeers(stream) {
  peers.forEach(({ pc }) => {
    pc.getSenders().forEach((sender) => {
      if (sender.track && stream.getTracks().includes(sender.track)) {
        pc.removeTrack(sender);
      }
    });
  });
}

socket.on("webrtc_signal", async ({ from, description, candidate }) => {
  if (!me) return;

  const peer = ensurePeer(from);
  const { pc } = peer;
  const polite = me.id > from;

  try {
    if (description) {
      const collision =
        description.type === "offer" &&
        (peer.makingOffer || pc.signalingState !== "stable");

      peer.ignoreOffer = !polite && collision;
      if (peer.ignoreOffer) return;

      await pc.setRemoteDescription(description);

      if (description.type === "offer") {
        await pc.setLocalDescription();
        socket.emit("webrtc_signal", {
          to: from,
          description: pc.localDescription,
        });
      }
    } else if (candidate) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        if (!peer.ignoreOffer) console.warn("[call] ICE candidate:", err);
      }
    }
  } catch (err) {
    console.error("[call] signalling problem:", err);
  }
});

socket.on("screen_share_stopped", (remoteId) => removeTile(remoteId));

micBtn.addEventListener("click", () => (micStream ? leaveVoice() : joinVoice()));

async function joinVoice() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  } catch (err) {
    callNote.textContent =
      "Couldn't use your microphone. Check that you allowed access, and that no other app is holding it.";
    console.error("[call] microphone:", err);
    return;
  }

  peers.forEach(({ pc }) => addStreamToPeer(pc, micStream));

  watchMicTrack(micStream.getAudioTracks()[0]);

  socket.emit("call_state", { micOn: true });
  watchAudioLevel(me.id, micStream);

  micBtn.classList.remove("is-nudge");
  micBtn.classList.add("is-on");
  micBtnText.textContent = "Leave voice call";
  muteBtn.hidden = false;
  callNote.textContent = "You're live. Anyone else who joins can hear you.";

  holdAudioFocus();
  showOngoingCall($("room-name").textContent);

  keepScreenAwake().then((held) => {
    if (held && micStream && !isMuted && !recovering) {
      callNote.textContent =
        "You're live. Your screen stays on so the call keeps running.";
    }
  });
}

function leaveVoice() {
  clearTimeout(muteTimer);
  recovering = false;

  removeStreamFromPeers(micStream);
  micStream.getTracks().forEach((track) => track.stop());
  micStream = null;
  isMuted = false;

  stopWatchingAudio(me.id);
  socket.emit("call_state", { micOn: false });

  micBtn.classList.remove("is-on");
  micBtnText.textContent = "Join voice call";
  muteBtn.hidden = true;
  muteBtn.classList.remove("is-on");
  muteBtnText.textContent = "Mute me";
  callNote.textContent = "";

  releaseCallHolds();
  nudgeToJoinVoice();
}

function releaseCallHolds() {
  if (micStream || screenStream) return;

  releaseAudioFocus();
  clearOngoingCall();
  letScreenSleep();
}

const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

let recovering = false;
let muteTimer = null;

function watchMicTrack(track) {
  if (!track) return;

  track.addEventListener("ended", () => {
    if (micStream && !document.hidden) recoverMic();
  });

  track.addEventListener("mute", () => {
    if (isMuted || !micStream || document.hidden) return;

    callNote.textContent = "Your microphone went quiet — checking…";

    clearTimeout(muteTimer);
    muteTimer = setTimeout(() => {
      const current = micStream?.getAudioTracks()[0];
      if (current && current.muted && !document.hidden) recoverMic();
    }, 3000);
  });

  track.addEventListener("unmute", () => {
    clearTimeout(muteTimer);
    if (!isMuted && micStream && !recovering) {
      callNote.textContent = "You're live. Anyone else who joins can hear you.";
    }
  });
}

async function recoverMic() {
  if (recovering || !micStream) return;
  recovering = true;

  callNote.textContent =
    "Something took your microphone — trying to get it back. Games often do this.";

  for (let attempt = 0; attempt < 720; attempt++) {
    if (!micStream) break;

    if (document.hidden) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempt--;
      continue;
    }

    try {
      const fresh = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      const track = fresh.getAudioTracks()[0];

      if (track && track.readyState === "live" && !track.muted) {
        swapMicTrack(fresh, track);
        recovering = false;
        callNote.textContent = isMuted
          ? "Muted — nobody can hear you."
          : "Got your microphone back. You're live again.";
        return;
      }

      fresh.getTracks().forEach((t) => t.stop());
    } catch {}

    if (attempt === 5 && micStream) {
      callNote.textContent =
        "Another app is holding your microphone. They'll hear you again the moment it lets go.";
    }

    await new Promise((resolve) => setTimeout(resolve, attempt < 12 ? 5000 : 15000));
  }

  recovering = false;
  if (micStream && !document.hidden) handleMicLost();
}

function swapMicTrack(freshStream, freshTrack) {
  const oldTrack = micStream.getAudioTracks()[0];

  peers.forEach(({ pc }) => {
    const sender = pc.getSenders().find((s) => s.track === oldTrack);
    if (sender) sender.replaceTrack(freshTrack).catch(() => {});
  });

  if (oldTrack) oldTrack.stop();

  freshTrack.enabled = !isMuted;
  micStream = freshStream;

  stopWatchingAudio(me.id);
  watchAudioLevel(me.id, micStream);
  watchMicTrack(freshTrack);
}

function handleMicLost() {
  if (!micStream) return;

  clearTimeout(muteTimer);
  recovering = false;

  removeStreamFromPeers(micStream);
  micStream.getTracks().forEach((track) => track.stop());
  micStream = null;
  isMuted = false;

  stopWatchingAudio(me.id);
  socket.emit("call_state", { micOn: false });

  micBtn.classList.remove("is-on");
  micBtnText.textContent = "Join voice call";
  muteBtn.hidden = true;
  muteBtn.classList.remove("is-on");
  muteBtnText.textContent = "Mute me";

  callNote.textContent =
    "Another app took your microphone, so you left the call. Close it and join again.";
  micBtn.classList.add("is-nudge");

  releaseCallHolds();
}

muteBtn.addEventListener("click", () => {
  if (!micStream) return;

  isMuted = !isMuted;
  micStream.getAudioTracks().forEach((track) => (track.enabled = !isMuted));

  muteBtn.classList.toggle("is-on", isMuted);
  muteBtnText.textContent = isMuted ? "Unmute me" : "Mute me";
  callNote.textContent = isMuted
    ? "Muted — nobody can hear you."
    : "You're live. Anyone else who joins can hear you.";
});

const shareSheet = $("share-sheet");
const sharePeople = $("share-people");
const screenViewers = new Set();
let roomMembers = [];

export function isSharing() {
  return Boolean(screenStream);
}

export function isViewer(id) {
  return screenViewers.has(id);
}

function grantViewer(id) {
  if (!screenStream || id === me?.id || screenViewers.has(id)) return;

  screenViewers.add(id);

  const peer = peers.get(id);
  if (peer) addStreamToPeer(peer.pc, screenStream);

  document.dispatchEvent(new CustomEvent("pulse:viewers-changed"));
}

export function toggleViewer(id) {
  if (!screenStream || id === me?.id) return;

  const peer = peers.get(id);

  if (screenViewers.has(id)) {
    screenViewers.delete(id);
    if (peer) {
      peer.pc.getSenders().forEach((sender) => {
        if (sender.track && screenStream.getTracks().includes(sender.track)) {
          peer.pc.removeTrack(sender);
        }
      });
    }
    socket.emit("screen_access", { to: id, allowed: false });
  } else {
    screenViewers.add(id);
    if (peer) addStreamToPeer(peer.pc, screenStream);
  }

  document.dispatchEvent(new CustomEvent("pulse:viewers-changed"));
}

screenBtn.addEventListener("click", () => {
  if (screenStream) {
    stopSharing();
    return;
  }

  const others = roomMembers.filter((m) => m.id !== me?.id);

  if (others.length === 0) {
    beginSharing(new Set());
    return;
  }

  openSharePicker(others);
});

function openSharePicker(others) {
  sharePeople.innerHTML = "";

  others.forEach((member) => {
    const li = document.createElement("li");

    const label = document.createElement("label");
    label.className = "toggle";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.value = member.id;

    const mark = document.createElement("span");
    mark.className = "toggle__box";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-check");
    icon.appendChild(use);
    mark.appendChild(icon);

    const text = document.createElement("span");
    text.className = "toggle__text";
    text.textContent = member.username;

    label.append(box, mark, text);
    li.appendChild(label);
    sharePeople.appendChild(li);
  });

  shareSheet.hidden = false;
}

$("share-cancel").addEventListener("click", () => {
  shareSheet.hidden = true;
});

$("share-start").addEventListener("click", () => {
  const chosen = new Set(
    Array.from(sharePeople.querySelectorAll("input:checked")).map((i) => i.value)
  );
  shareSheet.hidden = true;
  beginSharing(chosen);
});

async function beginSharing(chosen) {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (err) {
    return false;
  }

  if (screenStream.getAudioTracks().length === 0) {
    setCallNote(
      "Sharing without sound. To include it, tick “Share tab audio” or “Share system audio” in the picker."
    );
  }

  screenViewers.clear();
  chosen.forEach((id) => screenViewers.add(id));

  peers.forEach(({ pc }, id) => {
    if (screenViewers.has(id)) addStreamToPeer(pc, screenStream);
  });

  socket.emit("call_state", { sharing: true });
  document.dispatchEvent(new CustomEvent("pulse:viewers-changed"));

  showTile(me.id, screenStream, "You", true);

  screenBtn.classList.add("is-on");
  screenBtnText.textContent = "Stop sharing";

  screenStream.getVideoTracks()[0].addEventListener("ended", stopSharing);
  keepScreenAwake();

  return true;
}

function stopSharing() {
  if (!screenStream) return;

  removeStreamFromPeers(screenStream);
  screenStream.getTracks().forEach((track) => track.stop());
  screenStream = null;

  screenViewers.clear();
  socket.emit("call_state", { sharing: false });
  removeTile(me.id);
  document.dispatchEvent(new CustomEvent("pulse:viewers-changed"));

  screenBtn.classList.remove("is-on");
  screenBtnText.textContent = "Share my screen";

  releaseCallHolds();
}

const askSheet = $("ask-sheet");
const askTitle = $("ask-title");
const askSub = $("ask-sub");

const askQueue = [];
let currentAsk = null;

export function askForScreen(id) {
  if (!id || id === me?.id) return;

  socket.emit("request_screen", { to: id });
  setCallNote(`Asked ${names.get(id) || "them"} to show you their screen.`);
}

socket.on("screen_request", ({ from, username }) => {
  if (askQueue.some((ask) => ask.from === from) || currentAsk?.from === from) return;

  askQueue.push({ from, username });
  if (!currentAsk) showNextAsk();
});

function showNextAsk() {
  currentAsk = askQueue.shift() || null;

  if (!currentAsk) {
    askSheet.hidden = true;
    return;
  }

  askTitle.textContent = `${currentAsk.username} wants to see your screen`;
  askSub.textContent = screenStream
    ? "They'll start receiving the screen you're already sharing."
    : "Pick the window or tab to share on the next step.";

  askSheet.hidden = false;
}

function answerAsk(allowed) {
  const ask = currentAsk;
  currentAsk = null;
  askSheet.hidden = true;

  if (!ask) return null;

  if (!allowed) {
    socket.emit("screen_request_reply", { to: ask.from, allowed: false });
    showNextAsk();
    return null;
  }

  return ask;
}

$("ask-deny").addEventListener("click", () => {
  answerAsk(false);
});

$("ask-allow").addEventListener("click", async () => {
  const ask = answerAsk(true);
  if (!ask) return;

  if (screenStream) {
    grantViewer(ask.from);
    socket.emit("screen_request_reply", { to: ask.from, allowed: true });
  } else {
    const started = await beginSharing(new Set([ask.from]));
    socket.emit("screen_request_reply", { to: ask.from, allowed: started });
  }

  showNextAsk();
});

socket.on("screen_request_reply", ({ username, allowed }) => {
  setCallNote(
    allowed
      ? `${username} is showing you their screen.`
      : `${username} would rather not show their screen right now.`
  );
});

socket.on("screen_access", ({ from, username, allowed }) => {
  if (allowed) return;

  removeTile(from);
  setCallNote(`${username} stopped showing you their screen.`);
});

function forgetAsksFrom(id) {
  for (let i = askQueue.length - 1; i >= 0; i--) {
    if (askQueue[i].from === id) askQueue.splice(i, 1);
  }

  if (currentAsk?.from === id) {
    currentAsk = null;
    showNextAsk();
  }
}

function showTile(id, stream, label, isLocal = false) {
  let tile = document.getElementById("tile-" + id);

  if (!tile) {
    tile = document.createElement("div");
    tile.className = "tile";
    tile.id = "tile-" + id;
    tile.dataset.local = String(isLocal);

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    const tag = document.createElement("div");
    tag.className = "tile__label";

    const dot = document.createElement("span");
    dot.className = "pulse-dot";
    dot.style.background = colorFor(label);

    const text = document.createElement("span");
    text.className = "tile__name";

    tag.append(dot, text);

    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "tile__expand";
    expand.title = "Fullscreen";
    const expandIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const expandUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
    expandUse.setAttribute("href", "#i-expand");
    expandIcon.appendChild(expandUse);
    expand.appendChild(expandIcon);
    expand.addEventListener("click", (event) => {
      event.stopPropagation();
      requestFullscreen(tile);
    });

    tile.append(video, tag, expand);
    tile.addEventListener("click", () => {
      tile.classList.toggle("is-focused");
      updateStageLayout();
    });

    stageTiles.appendChild(tile);
  }

  tile.dataset.label = label;
  tile.dataset.local = String(isLocal);
  tile.querySelector("video").srcObject = stream;

  refreshTileLabels();
  updateStageLayout();
}

function removeTile(id) {
  document.getElementById("tile-" + id)?.remove();
  audioContainer
    .querySelectorAll(`audio[data-peer="${id}"][data-kind="screen"]`)
    .forEach((el) => el.remove());
  updateStageLayout();
}

function refreshTileLabels() {
  stageTiles.querySelectorAll(".tile").forEach((tile) => {
    const id = tile.id.replace("tile-", "");
    const isLocal = tile.dataset.local === "true";
    const label = isLocal ? "You" : names.get(id) || tile.dataset.label || "Someone";

    tile.dataset.label = label;
    const nameEl = tile.querySelector(".tile__name");
    if (nameEl) nameEl.textContent = isLocal ? "Your screen" : label;

    const dot = tile.querySelector(".pulse-dot");
    if (dot) dot.style.background = colorFor(label);
  });
}

function updateStageLayout() {
  const count = stageTiles.children.length;

  stage.hidden = count === 0;
  appEl.classList.toggle("has-stage", count > 0);
  stageTiles.classList.toggle("is-multi", count > 1);

  const focused = stageTiles.querySelector(".tile.is-focused");
  stageTiles.classList.toggle("has-focus", Boolean(focused));

  if (count === 0) {
    stageTitleText.textContent = "On the wall";
  } else if (count === 1) {
    const only = stageTiles.querySelector(".tile");
    stageTitleText.textContent =
      only?.dataset.local === "true"
        ? "You're sharing your screen"
        : (only?.dataset.label || "Someone") + " is sharing";
  } else {
    stageTitleText.textContent = count + " screens shared";
  }
}

function requestFullscreen(element) {
  const target = element.querySelector("video") || element;
  if (document.fullscreenElement) {
    document.exitFullscreen();
    return;
  }
  (target.requestFullscreen || target.webkitRequestFullscreen)?.call(target);
}

stageFullscreen.addEventListener("click", () => {
  const focused =
    stageTiles.querySelector(".tile.is-focused") || stageTiles.querySelector(".tile");
  if (focused) requestFullscreen(focused);
});

function resumeAfterBackground() {
  if (!me || document.hidden) return;

  if (!socket.connected) socket.connect();

  audioContext?.resume().catch(() => {});

  audioContainer.querySelectorAll("audio").forEach((element) => {
    if (element.paused) {
      element.play().catch(() => {
        soundUnlock.hidden = false;
      });
    }
  });

  peers.forEach((peer) => {
    const state = peer.pc.iceConnectionState;

    if (state === "failed" || state === "disconnected") {
      peer.restarts = 0;
      try {
        peer.pc.restartIce();
      } catch {}
    }
  });

  if (!micStream) return;

  const track = micStream.getAudioTracks()[0];
  const dead = !track || track.readyState !== "live" || track.muted;

  if (dead && !recovering) recoverMic();
}

document.addEventListener("visibilitychange", resumeAfterBackground);
window.addEventListener("pageshow", resumeAfterBackground);
window.addEventListener("focus", resumeAfterBackground);

function considerForSpeaking(remoteId, stream) {
  if (stream.getVideoTracks().length > 0) {
    stopWatchingAudio(remoteId);
    document.getElementById("audio-" + stream.id)?.setAttribute("data-kind", "screen");
    return;
  }

  watchAudioLevel(remoteId, stream);
}

function playRemoteAudio(remoteId, stream) {
  let audio = document.getElementById("audio-" + stream.id);

  if (!audio) {
    audio = document.createElement("audio");
    audio.id = "audio-" + stream.id;
    audio.autoplay = true;
    audio.dataset.peer = remoteId;
    audio.dataset.kind = stream.getVideoTracks().length > 0 ? "screen" : "mic";
    audioContainer.appendChild(audio);
  }

  audio.srcObject = stream;

  audio.play().catch(() => {
    soundUnlock.hidden = false;
  });

  nudgeToJoinVoice();
}

function nudgeToJoinVoice() {
  const receiving =
    audioContainer.querySelectorAll('audio[data-kind="mic"]').length > 0;

  if (micStream || !receiving) {
    micBtn.classList.remove("is-nudge");
    return;
  }

  micBtn.classList.add("is-nudge");
  callNote.textContent =
    "You can hear them, but they can't hear you — join the call to talk back.";
}

soundUnlock.addEventListener("click", () => {
  audioContainer.querySelectorAll("audio").forEach((el) => el.play());
  audioContext?.resume();
  soundUnlock.hidden = true;
});

let audioContext = null;
const meters = new Map();
let meterTimer = null;
const METER_INTERVAL_MS = 100;

function watchAudioLevel(id, stream) {
  if (stream.getAudioTracks().length === 0) return;

  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();

  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  meters.set(id, {
    analyser,
    source,
    samples: new Uint8Array(analyser.frequencyBinCount),
  });

  if (!meterTimer) meterTimer = setInterval(measureEveryone, METER_INTERVAL_MS);
}

function stopWatchingAudio(id) {
  const meter = meters.get(id);
  if (!meter) return;

  meter.source.disconnect();
  meters.delete(id);
  document.getElementById("member-" + id)?.classList.remove("is-speaking");

  if (meters.size === 0 && meterTimer) {
    clearInterval(meterTimer);
    meterTimer = null;
  }
}

function measureEveryone() {
  if (document.hidden) return;

  meters.forEach(({ analyser, samples }, id) => {
    analyser.getByteTimeDomainData(samples);

    let total = 0;
    for (let i = 0; i < samples.length; i++) {
      const offset = samples[i] - 128;
      total += offset * offset;
    }
    const loudness = Math.sqrt(total / samples.length);

    document
      .getElementById("member-" + id)
      ?.classList.toggle("is-speaking", loudness > 4);
  });
}
