export const $ = (id) => document.getElementById(id);

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

const PALETTE = [
  "#FF6B4A",
  "#FFA62B",
  "#FFC94A",
  "#4ECDC4",
  "#FF8FA3",
  "#F7B267",
  "#6EE7B7",
  "#FFD6A5",
];

export function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 100000;
  }
  return PALETTE[hash % PALETTE.length];
}

export function initials(name) {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

export function avatarEl(name) {
  const el = document.createElement("div");
  el.className = "avatar";
  el.style.background = colorFor(name);
  el.textContent = initials(name);
  return el;
}

export function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function mediaKind(type) {
  if (!type) return "file";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}

export function iconEl(name, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#" + name);
  svg.appendChild(use);
  if (className) svg.setAttribute("class", className);
  return svg;
}
