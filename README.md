# Pulse — live chat, voice, and screen sharing

Pick a name, join a room, and talk. Messages appear instantly, you can turn on
your microphone to talk to the whole room, and you can throw your screen up for
everyone to watch — all in the browser, with nothing to install.

---

## Run it

You need **Node.js version 22.5 or newer** (check with `node -v`; download from
[nodejs.org](https://nodejs.org) if you don't have it).

Open a terminal in this folder and run these two commands once:

```bash
npm install
```

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

**To see the "live" part:** open a *second* tab to the same address, join the
same room with a different name, and type between them. That single moment is
the whole point of the project.

Press `Ctrl+C` in the terminal to stop the server.

---

## What it does

- **Live text chat** — no refreshing, ever
- **Room passwords** — set one when you create a room and the code alone won't
  get anyone in. Stored as a salted scrypt hash, never as the password itself
- **File & media sharing** — drag in, paste, or click the clip. Images, video
  and audio play inline; everything else becomes a download card. 10 MB limit
- **A real screen-share stage** — when someone shares, the screen gets its own
  large panel and the chat docks beside it instead of being squashed underneath.
  Click any screen to focus it, or go fullscreen
- **Create or Join** — two tabs, because they need different things.
  **Create** asks what the room is called and lets you pick a code (or invents
  one like `K7N-4PQ`). **Join** asks only for the code
- **Room name + room code** — the name says what the room is for and shows at
  the top; the code is the key people type to get in. Click the code to copy an
  invite link
- **Rooms** — messages stay inside the room they were sent in
- **Saved history** — anyone joining later sees what was said before they arrived
- **Live voice calls** — talk to everyone in the room at once
- **Screen sharing** — put your screen on the room's wall; click a tile to enlarge it
- **Who's here** — live member list with mic and screen badges, and a ring around whoever is speaking
- **Typing indicators**, join/leave notices, and an online count
- **A colour per person**, worked out from their name, so everyone is identifiable at a glance
- **A live 3D backdrop** — a raymarched object drawn by your graphics card,
  with glass panels floating over it and cards that tilt towards your cursor.
  No 3D library, nothing to download, and it switches itself off for anyone
  who has asked for reduced motion
- **Works on phones** — the sidebar becomes a slide-over panel

### Safety built in

- Messages are capped at 500 characters
- All text is inserted with `.textContent`, never `.innerHTML`, so nobody can
  inject working HTML or JavaScript into the chat
- A minimum gap between messages, to stop flooding
- Only the `public/` folder is ever exposed to visitors

---

## About voice and screen sharing

Your audio and video **never pass through the server**. It only introduces two
browsers to each other; after that they connect directly. The technology is
called WebRTC, and the introduction step is called *signaling*.

Two consequences worth knowing before you test it:

**It needs a secure address.** Browsers refuse to hand out your microphone or
screen over an insecure connection. That means:

| Address | Text chat | Voice / screen |
|---|---|---|
| `http://localhost:3000` | works | **works** (localhost is trusted) |
| `http://192.168.1.5:3000` (your WiFi) | works | blocked by the browser |
| `https://your-app.onrender.com` | works | **works** |

**Across different networks it needs a TURN relay.** Two people on the same
WiFi can find a direct path, so voice and screen sharing just work. Two people
on *different* networks are usually both behind NAT, and a direct path often
can't be formed at all — you'll get text but silence and a blank screen.

Fixing that needs a TURN server, which relays the media when no direct path
exists. There is no reliable free public one (relaying video costs bandwidth),
so you supply your own. The app reads it from environment variables — no code
change:

There are two ways to supply credentials. Set `TURN_URL` either way:

| Variable | Example |
|---|---|
| `TURN_URL` | `turn:your.turnserver.com:3478` (comma-separate several) |

**Fixed credentials** — what most hosted providers give you:

| Variable | Example |
|---|---|
| `TURN_USERNAME` | your username |
| `TURN_CREDENTIAL` | your password |

**Time-limited credentials** — better, if your provider or your own coturn
supports a shared secret. The server mints a fresh username and HMAC that
expire after an hour, and the secret itself never reaches the browser:

| Variable | Example |
|---|---|
| `TURN_SECRET` | the shared secret from your TURN server |

Fixed credentials are handed to every visitor's browser, so anyone who opens
the site can read them and spend your bandwidth. Time-limited credentials
avoid that, which is why they're worth preferring.

The startup log tells you which mode is active, so check it after deploying.

On Render: your service → **Environment** → **Add Environment Variable** → save,
and it redeploys. Providers with free or cheap tiers include
[metered.ca](https://www.metered.ca/stun-turn), Cloudflare Calls and Twilio, or
you can self-host [coturn](https://github.com/coturn/coturn) on any VPS.

Without TURN the app still works — it just tells people plainly that voice and
screen are limited to the same network, instead of silently failing.

**It's built for small rooms.** Everyone connects directly to everyone else,
which is ideal for 2–6 people. Beyond that each device has to send its audio
separately to every other person, and it gets heavy. That's a real limit of this
deliberately simple design, not a bug.

---

## Sharing it with other people

**Same WiFi:** find your computer's local address (something like `192.168.1.5`)
and share `http://192.168.1.5:3000`. Your computer must stay on with the server
running. Text chat will work; voice and screen sharing won't, per the table above.

**Anyone, anywhere:** deploy to a host that supports always-open connections —
[Render](https://render.com) or [Railway](https://railway.app) both have free
tiers. Upload this folder (without `node_modules`), set the start command to
`npm start`, and make sure the Node version is 22.5 or newer. You'll get an
`https://` address, so voice and screen sharing work there too.

You can also share a direct link to a room: `http://localhost:3000/?code=K7N-4PQ`
opens the Join tab with the code already filled in. That's exactly what the
**copy** button next to the room code gives you.

---

## Understanding the code

Every file is commented in plain language, and each one has a single job.

**[ARCHITECTURE.md](ARCHITECTURE.md)** is the map — it walks a single message
from your keyboard to everyone else's screen in five steps, lists every message
that travels over the wire, and explains how voice calls actually work.

The short version of the layout:

```
server.js        start here — starts everything, ~90 lines
server/          the behind-the-scenes half (config, database, room-codes, rooms, chat, calls)
public/          everything a visitor's browser downloads
  index.html       structure
  css/             appearance  (base.css holds the colours — restyle from there)
  js/              behaviour   (main, socket, ui, chat, call)
chat.db          created automatically; every message ever sent
```

## A good way to learn from it

Change small things in something that already works, and watch what happens:

1. Open `public/css/base.css` and change `--violet` from `#8B5CF6` to any other
   colour. Save, refresh the browser. The entire app re-themes.
2. Open `server/config.js` and change `MAX_MESSAGE_LENGTH` to `50`. Restart the
   server (`Ctrl+C`, then `npm start`) and watch the character counter follow.
3. Open `public/index.html` and reword the headline on the join screen.

The loop is always: **edit → save → refresh** (or restart the server first, if
you changed something in `server/`).
