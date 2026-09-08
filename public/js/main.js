import { socket } from "./socket.js";
import { $ } from "./ui.js";
import * as chat from "./chat.js";
import * as call from "./call.js";
import * as session from "./session.js";
import { startBackground } from "./background.js";
import { initTilt } from "./tilt.js";
import { record, snapshot } from "./diagnostics.js";

const background = startBackground($("bg-canvas"));
initTilt();

const joinScreen = $("join-screen");
const chatScreen = $("chat-screen");
const joinForm = $("join-form");
const joinError = $("join-error");

const usernameInput = $("username-input");
const codeInput = $("code-input");
const passwordField = $("password-field");
const joinPasswordInput = $("join-password-input");
const roomNameInput = $("room-name-input");
const customCodeInput = $("custom-code-input");
const createPasswordInput = $("create-password-input");
const approvalInput = $("approval-input");
const waiting = $("waiting");
const waitingTitle = $("waiting-title");

const tabJoin = $("tab-join");
const tabCreate = $("tab-create");
const panelJoin = $("panel-join");
const panelCreate = $("panel-create");
const submitBtnText = $("submit-btn-text");

const liveRooms = $("live-rooms");
const liveRoomsList = $("live-rooms-list");

let mode = "join";

function setMode(next) {
  mode = next;
  const creating = mode === "create";

  tabJoin.classList.toggle("is-active", !creating);
  tabCreate.classList.toggle("is-active", creating);
  tabJoin.setAttribute("aria-selected", String(!creating));
  tabCreate.setAttribute("aria-selected", String(creating));

  panelJoin.hidden = creating;
  panelCreate.hidden = !creating;

  submitBtnText.textContent = creating ? "Create room" : "Join room";

  joinError.hidden = true;

  if (usernameInput.value.trim()) {
    (creating ? roomNameInput : codeInput).focus();
  } else {
    usernameInput.focus();
  }
}

tabJoin.addEventListener("click", () => setMode("join"));
tabCreate.addEventListener("click", () => setMode("create"));

const netStatus = $("net-status");
const netStatusText = $("net-status-text");

function setStatus(state, text) {
  if (!state) {
    netStatus.hidden = true;
    return;
  }
  netStatus.hidden = false;
  netStatus.className = "net-status net-status--" + state;
  netStatusText.textContent = text;
}

let activeSession = null;

const saved = session.recall();
usernameInput.value = saved.username;

const codeFromLink = new URLSearchParams(location.search).get("code");

if (codeFromLink) {
  codeInput.value = codeFromLink.toUpperCase();
  setMode("join");
} else if (saved.code) {
  codeInput.value = saved.code;
  setMode("join");

  if (saved.username) {
    activeSession = {
      username: saved.username,
      code: saved.code,
      password: saved.password,
      ownerToken: session.ownerTokenFor(saved.code),
    };
    setStatus("connecting", "Rejoining " + saved.code + "…");
  }
}

usernameInput.focus();

socket.on("connect", () => {
  record("socket connected", socket.io.engine.transport.name);

  if (activeSession) {
    setStatus("connecting", "Rejoining…");
    socket.emit("join_room", activeSession);
  } else {
    setStatus("");
  }
});

socket.on("disconnect", (reason) => {
  record("socket disconnected", reason);
  if (reason === "io client disconnect") return;
  setStatus("offline", "Connection lost — reconnecting…");
});

socket.io.on("reconnect_attempt", (attempt) => {
  record("socket reconnect attempt", attempt);
  setStatus(
    "connecting",
    attempt > 3 ? `Reconnecting… (attempt ${attempt})` : "Reconnecting…"
  );
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden || socket.connected) return;

  setStatus("connecting", "Reconnecting…");
  socket.connect();
});


joinForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const username = usernameInput.value.trim();

  if (!username) {
    showError("Please enter a name so people know who you are.");
    usernameInput.focus();
    return;
  }

  session.rememberName(username);
  joinError.hidden = true;

  if (mode === "create") {
    const roomName = roomNameInput.value.trim();

    if (!roomName) {
      showError("Give the room a name, so people know what it's for.");
      roomNameInput.focus();
      return;
    }

    activeSession = { username, code: "", password: createPasswordInput.value };

    socket.emit("create_room", {
      username,
      roomName,
      code: customCodeInput.value.trim(),
      password: createPasswordInput.value,
      needsApproval: approvalInput.checked,
    });
  } else {
    const code = codeInput.value.trim();

    if (!code) {
      showError("Enter the room code you were given.");
      codeInput.focus();
      return;
    }

    activeSession = {
      username,
      code,
      password: passwordField.hidden ? "" : joinPasswordInput.value,
      ownerToken: session.ownerTokenFor(code),
    };
    socket.emit("join_room", activeSession);
  }
});

socket.on("password_required", ({ roomName }) => {
  activeSession = null;
  setStatus("");
  passwordField.hidden = false;
  joinPasswordInput.focus();
  showError(`${roomName} is locked. Enter the room password to get in.`);
});

socket.on("password_rejected", (message) => {
  activeSession = null;
  setStatus("");
  passwordField.hidden = false;
  joinPasswordInput.value = "";
  joinPasswordInput.focus();
  showError(message);
});

socket.on("joined", (identity) => {
  waiting.hidden = true;
  if (identity.ownerToken) session.rememberOwnerToken(identity.code, identity.ownerToken);
  activeSession = {
    username: identity.username,
    code: identity.code,
    password: activeSession?.password || saved.password || "",
    ownerToken: session.ownerTokenFor(identity.code),
  };

  session.remember(activeSession);
  setStatus("");

  chat.start(identity);
  call.start(identity);

  $("room-name").textContent = identity.roomName;
  $("room-code").textContent = identity.code;
  $("lock-badge").hidden = !identity.locked;
  document.title = `${identity.roomName} — Pulse`;

  joinScreen.hidden = true;
  chatScreen.hidden = false;

  background.setCalm(0.35);

  $("message-input").focus();
});

socket.on("join_error", (message) => {
  activeSession = null;
  session.forgetRoom();
  setStatus("");
  showError(message);
});

socket.on("awaiting_approval", ({ roomName }) => {
  joinError.hidden = true;
  waiting.hidden = false;
  waitingTitle.textContent = `Waiting to be let into ${roomName}…`;
  setStatus("");
  activeSession = null;
});

socket.on("join_denied", (message) => {
  activeSession = null;
  session.forgetRoom();
  showError(message);
});

socket.on("kicked", ({ roomName, by }) => {
  activeSession = null;
  session.forgetRoom();
  setStatus("");

  chatScreen.hidden = true;
  joinScreen.hidden = false;
  background.setCalm(1);
  document.title = "Pulse — live rooms";

  showError(`${by} removed you from ${roomName}.`);
});

function showError(message) {
  waiting.hidden = true;
  joinError.textContent = message;
  joinError.hidden = false;
}

const codeChip = $("code-chip");
const codeChipHint = $("code-chip-hint");

codeChip.addEventListener("click", async () => {
  const code = $("room-code").textContent;
  const inviteLink = `${location.origin}/?code=${encodeURIComponent(code)}`;

  try {
    await navigator.clipboard.writeText(inviteLink);
    flashCopied("copied!");
  } catch {
    flashCopied("press ctrl+c");
    selectText($("room-code"));
  }
});

function flashCopied(message) {
  codeChipHint.textContent = message;
  codeChip.classList.add("is-copied");

  setTimeout(() => {
    codeChipHint.textContent = "copy";
    codeChip.classList.remove("is-copied");
  }, 1800);
}

function selectText(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

socket.on("lobby_stats", (rooms) => {
  if (!chatScreen.hidden) return;

  liveRoomsList.innerHTML = "";
  liveRooms.hidden = rooms.length === 0;

  rooms.slice(0, 5).forEach(({ code, name, count }) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "room-chip";

    const label = document.createElement("span");
    label.textContent = name;

    const codeEl = document.createElement("span");
    codeEl.className = "room-chip__code";
    codeEl.textContent = code;

    const badge = document.createElement("b");
    badge.textContent = count === 1 ? "1 person" : `${count} people`;

    chip.append(label, codeEl, badge);
    chip.addEventListener("click", () => {
      setMode("join");
      codeInput.value = code;
      if (usernameInput.value.trim()) joinForm.requestSubmit();
      else usernameInput.focus();
    });

    liveRoomsList.appendChild(chip);
  });
});

const quickMic = $("q-mic");
const quickScreen = $("q-screen");
const micBtn = $("mic-btn");
const screenBtn = $("screen-btn");

quickMic.addEventListener("click", () => micBtn.click());
quickScreen.addEventListener("click", () => screenBtn.click());
$("q-people").addEventListener("click", (event) => {
  event.stopPropagation();
  openSidebar();
});

function mirror(source, target, label) {
  const sync = () => {
    target.classList.toggle("is-on", source.classList.contains("is-on"));
    target.classList.toggle("is-nudge", source.classList.contains("is-nudge"));
    if (label) {
      label.textContent = source.classList.contains("is-on")
        ? label.dataset.on
        : label.dataset.off;
    }
  };

  new MutationObserver(sync).observe(source, {
    attributes: true,
    attributeFilter: ["class"],
  });

  sync();
}

const quickMicText = $("q-mic-text");
quickMicText.dataset.off = "Voice";
quickMicText.dataset.on = "Leave";

const quickScreenText = $("q-screen-text");
quickScreenText.dataset.off = "Share";
quickScreenText.dataset.on = "Stop";

mirror(micBtn, quickMic, quickMicText);
mirror(screenBtn, quickScreen, quickScreenText);

const copyLogBtn = $("copy-log");

copyLogBtn.addEventListener("click", async () => {
  const text = snapshot();

  try {
    await navigator.clipboard.writeText(text);
    flashLog("Copied — paste it to whoever is helping");
  } catch {
    flashLog("Couldn't copy — the log is in the box below");
    showLogFallback(text);
  }
});

function flashLog(message) {
  copyLogBtn.textContent = message;

  setTimeout(() => {
    copyLogBtn.textContent = "Copy connection log";
  }, 3000);
}

function showLogFallback(text) {
  let box = $("log-fallback");

  if (!box) {
    box = document.createElement("textarea");
    box.id = "log-fallback";
    box.className = "callbox__log-text";
    box.readOnly = true;
    copyLogBtn.after(box);
  }

  box.value = text;
  box.select();
}

const installBtn = $("install-btn");
let installPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installBtn.hidden = false;
});

installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;

  installBtn.hidden = true;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installBtn.hidden = true;
});

$("leave-btn").addEventListener("click", () => {
  activeSession = null;
  session.forgetRoom();
  location.href = location.origin;
});

const sidebar = $("sidebar");
const sidebarVeil = $("sidebar-veil");

function openSidebar() {
  sidebar.classList.add("is-open");
  sidebarVeil.hidden = false;
}

function closeSidebar() {
  sidebar.classList.remove("is-open");
  sidebarVeil.hidden = true;
}

$("sidebar-toggle").addEventListener("click", (event) => {
  event.stopPropagation();
  if (sidebar.classList.contains("is-open")) closeSidebar();
  else openSidebar();
});

sidebarVeil.addEventListener("click", closeSidebar);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSidebar();
});

document.addEventListener("click", (event) => {
  if (!sidebar.contains(event.target)) closeSidebar();
});
