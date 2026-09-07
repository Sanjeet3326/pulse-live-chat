import { socket } from "./socket.js";
import { $ } from "./ui.js";
import * as chat from "./chat.js";
import * as call from "./call.js";
import { startBackground } from "./background.js";
import { initTilt } from "./tilt.js";

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

usernameInput.value = localStorage.getItem("pulse:name") || "";

const codeFromLink = new URLSearchParams(location.search).get("code");
if (codeFromLink) {
  codeInput.value = codeFromLink.toUpperCase();
  setMode("join");
}

usernameInput.focus();

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const username = usernameInput.value.trim();

  if (!username) {
    showError("Please enter a name so people know who you are.");
    usernameInput.focus();
    return;
  }

  localStorage.setItem("pulse:name", username);
  joinError.hidden = true;

  if (mode === "create") {
    const roomName = roomNameInput.value.trim();

    if (!roomName) {
      showError("Give the room a name, so people know what it's for.");
      roomNameInput.focus();
      return;
    }

    socket.emit("create_room", {
      username,
      roomName,
      code: customCodeInput.value.trim(),
      password: createPasswordInput.value,
    });
  } else {
    const code = codeInput.value.trim();

    if (!code) {
      showError("Enter the room code you were given.");
      codeInput.focus();
      return;
    }

    socket.emit("join_room", {
      username,
      code,
      password: passwordField.hidden ? "" : joinPasswordInput.value,
    });
  }
});

socket.on("password_required", ({ roomName }) => {
  passwordField.hidden = false;
  joinPasswordInput.focus();
  showError(`${roomName} is locked. Enter the room password to get in.`);
});

socket.on("password_rejected", (message) => {
  passwordField.hidden = false;
  joinPasswordInput.value = "";
  joinPasswordInput.focus();
  showError(message);
});

socket.on("joined", (identity) => {
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

socket.on("join_error", showError);

function showError(message) {
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

$("leave-btn").addEventListener("click", () => location.reload());

const sidebar = $("sidebar");

$("sidebar-toggle").addEventListener("click", (event) => {
  event.stopPropagation();
  sidebar.classList.toggle("is-open");
});

document.addEventListener("click", (event) => {
  if (!sidebar.contains(event.target)) sidebar.classList.remove("is-open");
});
