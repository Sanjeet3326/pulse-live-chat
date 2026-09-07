const config = require("./config");

const SAFE_CHARACTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function normalise(rawCode) {
  return String(rawCode ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, config.MAX_CODE_LENGTH);
}

function generateOne() {
  let code = "";

  for (let i = 0; i < config.GENERATED_CODE_LENGTH; i++) {
    code += SAFE_CHARACTERS[Math.floor(Math.random() * SAFE_CHARACTERS.length)];
  }

  const middle = Math.ceil(code.length / 2);
  return code.slice(0, middle) + "-" + code.slice(middle);
}

function generateUnique(isTaken) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = generateOne();
    if (!isTaken(code)) return code;
  }

  throw new Error("Could not generate an unused room code");
}

module.exports = { normalise, generateUnique };
