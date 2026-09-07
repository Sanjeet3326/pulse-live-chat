import { socket } from "./socket.js";
import {
  $,
  avatarEl,
  colorFor,
  formatTime,
  formatBytes,
  mediaKind,
  iconEl,
} from "./ui.js";

const messagesEl = $("messages");
const memberListEl = $("member-list");
const typingEl = $("typing-indicator");
const uploadStatusEl = $("upload-status");
const jumpBtn = $("jump-btn");
const composer = $("composer");
const input = $("message-input");
const charCount = $("char-count");
const attachBtn = $("attach-btn");
const fileInput = $("file-input");
const dropzone = $("dropzone");
const mainEl = $("main");

const MAX_LENGTH = 500;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

let me = null;
let lastAuthor = null;
let lastStamp = 0;

export function start(identity) {
  me = identity;
  messagesEl.innerHTML = "";
  lastAuthor = null;
  lastStamp = 0;
  updateCharCount();
  updatePlaceholder();
  flushPendingMessages();
}

socket.on("chat_history", (history) => {
  messagesEl.innerHTML = "";
  lastAuthor = null;

  if (history.length === 0) {
    showEmptyState();
  } else {
    history.forEach(addMessage);
  }
  scrollToBottom();
});

socket.on("receive_message", (message) => {
  removeEmptyState();

  const wasAtBottom = isNearBottom();
  addMessage(message);

  if (wasAtBottom || message.username === me?.username) {
    scrollToBottom();
  } else {
    jumpBtn.hidden = false;
  }
});

socket.on("system_message", (text) => {
  removeEmptyState();

  const wasAtBottom = isNearBottom();
  const el = document.createElement("div");
  el.className = "system";
  el.textContent = text;
  messagesEl.appendChild(el);

  lastAuthor = null;
  if (wasAtBottom) scrollToBottom();
});

socket.on("room_members", (members) => {
  renderMembers(members);
  const count = members.length;
  $("online-count").textContent = count === 1 ? "1 here" : `${count} here`;
});

const typingUsers = new Set();

socket.on("user_typing", (username) => {
  typingUsers.add(username);
  renderTyping();
});

socket.on("user_stop_typing", (username) => {
  typingUsers.delete(username);
  renderTyping();
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

input.addEventListener("input", () => {
  autoGrow();
  updateCharCount();
  signalTyping();
});

const pendingMessages = [];

function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  if (socket.connected && me) {
    socket.emit("send_message", { text });
  } else {
    pendingMessages.push(text);
    showUploadStatus("Offline — this will send when you reconnect.");
  }

  input.value = "";
  autoGrow();
  updateCharCount();
  stopTyping();
  input.focus();
}

function flushPendingMessages() {
  if (pendingMessages.length === 0) return;

  const queued = pendingMessages.splice(0, pendingMessages.length);
  queued.forEach((text) => socket.emit("send_message", { text }));
  showUploadStatus("");
}

let typingSentAt = 0;
let stopTypingTimer = null;

function signalTyping() {
  const now = Date.now();
  if (now - typingSentAt > 1500) {
    socket.emit("typing");
    typingSentAt = now;
  }

  clearTimeout(stopTypingTimer);
  stopTypingTimer = setTimeout(stopTyping, 1200);
}

function stopTyping() {
  clearTimeout(stopTypingTimer);
  typingSentAt = 0;
  socket.emit("stop_typing");
}

attachBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  sendFiles(Array.from(fileInput.files));
  fileInput.value = "";
});

let dragDepth = 0;

mainEl.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  dropzone.hidden = false;
});

mainEl.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});

mainEl.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.hidden = true;
});

mainEl.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  dragDepth = 0;
  dropzone.hidden = true;
  sendFiles(Array.from(event.dataTransfer.files));
});

input.addEventListener("paste", (event) => {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (files.length === 0) return;
  event.preventDefault();
  sendFiles(files);
});

async function sendFiles(files) {
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      showUploadStatus(`${file.name} is too big — the limit is 10 MB.`, true);
      continue;
    }

    showUploadStatus(`Sending ${file.name}…`);

    try {
      const data = await file.arrayBuffer();

      const result = await socket
        .timeout(60000)
        .emitWithAck("send_file", { name: file.name, type: file.type, data })
        .catch(() => ({ error: "That took too long. Try a smaller file." }));

      if (result?.error) {
        showUploadStatus(result.error, true);
      } else {
        showUploadStatus("");
      }
    } catch (error) {
      showUploadStatus("Couldn't read that file.", true);
    }
  }
}

let uploadStatusTimer = null;

function showUploadStatus(text, isError = false) {
  clearTimeout(uploadStatusTimer);
  uploadStatusEl.textContent = text;
  uploadStatusEl.classList.toggle("is-error", isError);

  if (text) {
    uploadStatusTimer = setTimeout(() => {
      uploadStatusEl.textContent = "";
      uploadStatusEl.classList.remove("is-error");
    }, isError ? 6000 : 4000);
  }
}

function addMessage(message) {
  const { username, created_at } = message;
  const stamp = new Date(created_at).getTime();
  const isGrouped =
    username === lastAuthor && stamp - lastStamp < GROUPING_WINDOW_MS;

  const row = document.createElement("div");
  row.className = "msg";
  if (username === me?.username) row.classList.add("msg--own");
  if (isGrouped) row.classList.add("msg--grouped");

  row.appendChild(avatarEl(username));

  const body = document.createElement("div");
  body.className = "msg__body";

  const head = document.createElement("div");
  head.className = "msg__head";

  const nameEl = document.createElement("span");
  nameEl.className = "msg__name";
  nameEl.style.color = colorFor(username);
  nameEl.textContent = username;

  const timeEl = document.createElement("span");
  timeEl.className = "msg__time";
  timeEl.textContent = formatTime(created_at);

  head.append(nameEl, timeEl);
  body.appendChild(head);

  if (message.kind === "file" && message.file) {
    body.appendChild(buildAttachment(message.file));
  } else {
    const textEl = document.createElement("div");
    textEl.className = "msg__text";
    textEl.textContent = message.text;
    body.appendChild(textEl);
  }

  row.appendChild(body);
  messagesEl.appendChild(row);

  lastAuthor = username;
  lastStamp = stamp;
}

function buildAttachment(file) {
  const kind = mediaKind(file.type);
  const wrap = document.createElement("div");
  wrap.className = "attach attach--" + kind;

  if (kind === "image") {
    const link = document.createElement("a");
    link.href = file.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "attach__imagelink";

    const img = document.createElement("img");
    img.src = file.url;
    img.alt = file.name;
    img.loading = "lazy";
    img.className = "attach__image";

    link.appendChild(img);
    wrap.appendChild(link);
    wrap.appendChild(buildFileMeta(file, true));
    return wrap;
  }

  if (kind === "video") {
    const video = document.createElement("video");
    video.src = file.url;
    video.controls = true;
    video.preload = "metadata";
    video.className = "attach__video";
    wrap.appendChild(video);
    wrap.appendChild(buildFileMeta(file, true));
    return wrap;
  }

  if (kind === "audio") {
    const audio = document.createElement("audio");
    audio.src = file.url;
    audio.controls = true;
    audio.preload = "metadata";
    audio.className = "attach__audio";
    wrap.appendChild(buildFileMeta(file, true));
    wrap.appendChild(audio);
    return wrap;
  }

  wrap.appendChild(buildFileCard(file));
  return wrap;
}

function buildFileMeta(file, subtle = false) {
  const meta = document.createElement("a");
  meta.className = "attach__meta" + (subtle ? " attach__meta--subtle" : "");
  meta.href = file.url;
  meta.download = file.name;

  meta.appendChild(iconEl("i-download"));

  const name = document.createElement("span");
  name.className = "attach__name";
  name.textContent = file.name;

  const size = document.createElement("span");
  size.className = "attach__size";
  size.textContent = formatBytes(file.size);

  meta.append(name, size);
  return meta;
}

function buildFileCard(file) {
  const card = document.createElement("a");
  card.className = "attach__card";
  card.href = file.url;
  card.download = file.name;

  const icon = document.createElement("span");
  icon.className = "attach__icon";
  icon.appendChild(iconEl("i-file"));

  const info = document.createElement("span");
  info.className = "attach__info";

  const name = document.createElement("strong");
  name.textContent = file.name;

  const size = document.createElement("span");
  size.textContent = formatBytes(file.size);

  info.append(name, size);

  const action = document.createElement("span");
  action.className = "attach__action";
  action.appendChild(iconEl("i-download"));

  card.append(icon, info, action);
  return card;
}

function renderMembers(members) {
  memberListEl.innerHTML = "";

  members.forEach((member) => {
    const li = document.createElement("li");
    li.className = "member";
    li.id = "member-" + member.id;

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "member__avatar";
    avatarWrap.appendChild(avatarEl(member.username));

    const body = document.createElement("div");
    body.className = "member__body";

    const name = document.createElement("span");
    name.className = "member__name";
    name.textContent = member.username;
    body.appendChild(name);

    const tags = [];
    if (member.id === me?.id) tags.push("you");
    if (member.isOwner) tags.push("owner");

    if (tags.length > 0) {
      const tag = document.createElement("span");
      tag.className = "member__you";
      tag.textContent = tags.join(" · ");
      body.appendChild(tag);
    }

    const badges = document.createElement("div");
    badges.className = "member__badges";

    if (member.micOn) {
      const badge = document.createElement("span");
      badge.className = "badge badge--mic";
      badge.title = "In the voice call";
      badge.appendChild(iconEl("i-mic"));
      badges.appendChild(badge);
    }
    if (member.sharing) {
      const badge = document.createElement("span");
      badge.className = "badge badge--screen";
      badge.title = "Sharing their screen";
      badge.appendChild(iconEl("i-screen"));
      badges.appendChild(badge);
    }

    li.append(avatarWrap, body, badges);

    if (me?.isOwner && member.id !== me.id && !member.isOwner) {
      const kick = document.createElement("button");
      kick.type = "button";
      kick.className = "member__kick";
      kick.title = "Remove " + member.username;
      kick.setAttribute("aria-label", "Remove " + member.username);
      kick.appendChild(iconEl("i-remove"));

      kick.addEventListener("click", () => {
        if (confirm(`Remove ${member.username} from the room?`)) {
          socket.emit("kick_member", { id: member.id });
        }
      });

      li.appendChild(kick);
    }

    memberListEl.appendChild(li);
  });
}

function renderTyping() {
  if (typingUsers.size === 0) {
    typingEl.textContent = "";
    return;
  }

  const names = Array.from(typingUsers);
  const who =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names.length} people are typing`;

  typingEl.innerHTML =
    '<span class="typing__dots"><i></i><i></i><i></i></span>' + who;
}

function showEmptyState() {
  const box = document.createElement("div");
  box.className = "empty";
  box.id = "empty-state";
  box.appendChild(iconEl("i-chat"));

  const title = document.createElement("strong");
  title.textContent = "Nothing here yet";

  const sub = document.createElement("span");
  sub.textContent =
    "You're first in. Send a message, drop in a file, or click the room code at the top to copy an invite link.";

  box.append(title, sub);
  messagesEl.appendChild(box);
}

function removeEmptyState() {
  $("empty-state")?.remove();
}

function isNearBottom() {
  const gap =
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  return gap < 120;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
  jumpBtn.hidden = true;
}

jumpBtn.addEventListener("click", scrollToBottom);

messagesEl.addEventListener("scroll", () => {
  if (isNearBottom()) jumpBtn.hidden = true;
});

function autoGrow() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}

function updatePlaceholder() {
  const roomy = composer.clientWidth >= 430;
  input.placeholder = roomy
    ? "Say something…  (Enter to send, Shift+Enter for a new line)"
    : "Say something…";
  composer.classList.toggle("is-narrow", !roomy);
}

updatePlaceholder();

if (typeof ResizeObserver === "function") {
  new ResizeObserver(updatePlaceholder).observe(composer);
} else {
  window.addEventListener("resize", updatePlaceholder);
}

function updateCharCount() {
  const used = input.value.length;
  charCount.textContent = `${used}/${MAX_LENGTH}`;
  charCount.classList.toggle("is-near", used > MAX_LENGTH * 0.85);
}
