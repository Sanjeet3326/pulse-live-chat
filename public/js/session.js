const NAME_KEY = "pulse:name";
const CODE_KEY = "pulse:code";
const PASS_KEY = "pulse:pass";

function safeGet(store, key) {
  try {
    return store.getItem(key) || "";
  } catch {
    return "";
  }
}

function safeSet(store, key, value) {
  try {
    if (value) store.setItem(key, value);
    else store.removeItem(key);
  } catch {}
}

export function remember({ username, code, password }) {
  safeSet(localStorage, NAME_KEY, username);
  safeSet(localStorage, CODE_KEY, code);
  safeSet(sessionStorage, PASS_KEY, password);
}

export function rememberName(username) {
  safeSet(localStorage, NAME_KEY, username);
}

export function recall() {
  return {
    username: safeGet(localStorage, NAME_KEY),
    code: safeGet(localStorage, CODE_KEY),
    password: safeGet(sessionStorage, PASS_KEY),
  };
}

export function forgetRoom() {
  safeSet(localStorage, CODE_KEY, "");
  safeSet(sessionStorage, PASS_KEY, "");
}

export function rememberOwnerToken(code, token) {
  safeSet(localStorage, "pulse:owner:" + code, token);
}

export function ownerTokenFor(code) {
  return code ? safeGet(localStorage, "pulse:owner:" + code.toUpperCase()) : "";
}
