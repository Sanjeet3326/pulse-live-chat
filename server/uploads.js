const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const config = require("./config");

const uploadDir = path.join(__dirname, "..", config.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/ogg", "ogg"],
  ["audio/webm", "weba"],
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
  ["text/csv", "csv"],
  ["application/json", "json"],
  ["application/zip", "zip"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
]);

function cleanDisplayName(name) {
  return String(name ?? "file")
    .replace(/[\\/]/g, " ")
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, 80) || "file";
}

function save({ data, name, type }) {
  if (!ALLOWED_TYPES.has(type)) {
    return { error: "That file type isn't allowed here." };
  }

  const buffer = Buffer.from(data);

  if (buffer.length === 0) {
    return { error: "That file is empty." };
  }

  if (buffer.length > config.MAX_FILE_BYTES) {
    const limit = Math.round(config.MAX_FILE_BYTES / (1024 * 1024));
    return { error: `Files have to be under ${limit} MB.` };
  }

  const extension = ALLOWED_TYPES.get(type);
  const storedName = crypto.randomBytes(16).toString("hex") + "." + extension;

  fs.writeFileSync(path.join(uploadDir, storedName), buffer);

  return {
    file: {
      url: "/uploads/" + storedName,
      name: cleanDisplayName(name),
      type,
      size: buffer.length,
    },
  };
}

module.exports = { save, uploadDir };
