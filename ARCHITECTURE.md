# How this app is built

A map of the code. Read this once and you'll be able to find anything.

---

## The one-paragraph version

A **server** (Node.js) hands out a webpage and keeps a permanently open line to
every visitor's browser. When you type a message it travels up that line, gets
saved to a file, and is instantly pushed back down every other line in the same
room. Voice and screen sharing work differently: the server only introduces two
browsers to each other, and the audio/video then flows **directly between them**,
never touching the server.

---

## Folder layout

```
live-chat-app/
├── server.js              ← START HERE. Starts everything, ~90 lines.
│
├── server/                ← the "behind the scenes" half. Visitors never see these.
│   ├── config.js            every adjustable setting, in one place
│   ├── database.js          rooms + messages on disk (the only file that knows SQL)
│   ├── room-codes.js        making and cleaning up room codes
│   ├── passwords.js         hashing and checking room passwords
│   ├── uploads.js           validating and storing shared files
│   ├── rooms.js             who is in which room, right now (in memory)
│   ├── chat-events.js       the text chat rules
│   └── call-events.js       voice/screen matchmaking ("signaling")
│
├── public/                ← the "shop window". Everything here is downloaded by browsers.
│   ├── index.html           the page's STRUCTURE only
│   ├── css/
│   │   ├── base.css         design tokens: colours, fonts, glass, depth. Restyle from here.
│   │   ├── join.css         the landing screen layout
│   │   └── chat.css         the chat screen layout
│   └── js/
│       ├── main.js          entry point: the join flow, then hands off
│       ├── socket.js        the one open connection, shared by everything
│       ├── ui.js            tiny shared helpers (colours, initials, time)
│       ├── chat.js          messages, people list, typing indicator
│       ├── call.js          voice + screen sharing (WebRTC)
│       ├── background.js    the live 3D scene  (decoration only)
│       └── tilt.js          cards that turn towards the cursor (decoration only)
│
├── chat.db                ← created automatically on first run. All messages live here.
├── package.json           ← the shopping list of outside tools
└── node_modules/          ← created by `npm install`. Never edited by hand.
```

**The rule that shapes everything:** each file has exactly one job, and its name
says what that job is. If you want to change how messages look, you know without
looking that it's `chat.js` and `chat.css` — and that you can't possibly break
the voice call by editing them.

---

## The three languages, and which file is which

The roadmap document describes HTML/CSS/JavaScript as skeleton, appearance, and
behaviour. This project keeps that split literal:

| Layer | Where | What it decides |
|---|---|---|
| **HTML** | `public/index.html` | *What exists* — a sidebar, a message list, a send button |
| **CSS** | `public/css/*` | *How it looks* — colours, spacing, layout, animation |
| **JavaScript** | `public/js/*` | *What happens* — clicks, messages arriving, connections |

You can delete every line of CSS and the app still fully works — it would just
be ugly. That's a good test of whether the layers are really separate.

---

## Following one message from end to end

This is the single most useful thing to trace. When you press Enter:

1. **`public/js/chat.js`** — `sendMessage()` runs and calls
   `socket.emit("send_message", { text })`. The text goes up the open line.

2. **`server/chat-events.js`** — the matching `socket.on("send_message", ...)`
   receives it. It trims the text, enforces the length limit, and checks you
   aren't sending faster than the anti-spam gap.

3. **`server/database.js`** — `saveMessage()` writes it into `chat.db`, so it
   survives a restart and can be shown to whoever joins later.

4. **`server/chat-events.js`** — `io.to(room).emit("receive_message", ...)`
   pushes it to everyone in that room, the sender included.

5. **`public/js/chat.js`** — `socket.on("receive_message", ...)` fires in every
   browser, and `addMessage()` draws it on the page.

Five steps, five clearly named places. Nothing else is involved.

---

## The messages that travel over the wire

The browser and server only ever exchange these. Everything the app does is
one of these lines.

**Browser → Server**

| Name | Meaning |
|---|---|
| `create_room` | "I'm X, make a room called Y — here's my code, or invent one" |
| `join_room` | "I'm X, let me into the room with this code" |
| `send_message` | "Here's what I typed" |
| `typing` / `stop_typing` | "I'm writing" / "I stopped" |
| `webrtc_signal` | "Pass this setup note to that specific person" |
| `call_state` | "My mic is on" / "I'm sharing my screen" |

**Server → Browser**

| Name | Meaning |
|---|---|
| `joined` | "You're in — here's the room's name, its code, and your own connection id" |
| `chat_history` | "Here's what was said before you arrived" |
| `receive_message` | "Someone said this, show it now" |
| `system_message` | "Someone joined / left" |
| `room_members` | "Here's everyone in the room and their mic/screen state" |
| `lobby_stats` | "These rooms currently have people in them" |
| `webrtc_signal` | "Someone sent you a setup note" |
| `screen_share_stopped` | "They stopped sharing, drop the video tile" |

Note there is no "someone joined the voice call" message. `room_members`
already says who's present, so `call.js` just watches that one list and opens
or closes connections to match. One source of truth instead of two.

---

## A note on comments

The source files carry no comments — that was a deliberate request. This
document is where the explanation lives instead, so if you change how something
works, update it here.

---

## Room passwords

A password is optional, set when the room is created. It is never stored:
`server/passwords.js` keeps a random salt plus an scrypt hash, and checks
attempts with `timingSafeEqual` so the comparison takes the same time whether
the first character is wrong or the last.

The join flow is deliberately two-step. The browser doesn't know a room is
locked until it asks, so:

1. Browser sends `join_room` with no password.
2. Server replies `password_required` — the join screen reveals the password box.
3. Browser sends `join_room` again, this time with the password.
4. Wrong password gets `password_rejected`; right password gets `joined`.

The server never says "that room exists but is locked" before checking the code
is real, and it never sends the hash to the browser.

---

## Shared files

`server/uploads.js` is the only file that touches the disk for uploads, and it
refuses anything not on an explicit allow-list of types. HTML and SVG are
deliberately **not** allowed: both can carry scripts, and serving them from our
own origin would let anyone in a room run code in everyone else's browser.
Uploads are also served with `X-Content-Type-Options: nosniff` so a file cannot
be re-interpreted as something more dangerous than it claims to be.

Files travel over the existing socket connection as binary, are stored under a
random name (never the uploader's filename, which could contain path tricks),
and the original name is kept only as a label.

---

## The screen-share stage

When anyone shares, `public/js/call.js` puts a `has-stage` class on the app and
the CSS grid changes shape:

```
normal              sharing
+--------+------+   +--------+-----------+------+
| topbar        |   | topbar                    |
+--------+------+   +--------+-----------+------+
| people | chat |   | people |  screen   | chat |
+--------+------+   +--------+-----------+------+
```

The chat keeps its own column instead of being squeezed under the video. Below
1100px the stage moves above the chat, and on a phone they stack.

---

## The look: how the 3D works

The backdrop is a genuine 3D object, drawn by the graphics card sixty times a
second — but there is **no 3D library and nothing to download.**

`public/js/background.js` hands the GPU a small program (a *shader*) that runs
for every pixel at once and answers one question: *"if I fired a ray from the
camera through you, what would it hit?"* The shape isn't a model — it's an
equation: a sphere whose radius is disturbed by layers of noise. Walking a ray
forward until it touches that surface is called **raymarching**. Because the
shape is maths rather than geometry, it can churn and breathe without anyone
modelling anything, and the whole scene costs one file.

The rest of the depth is CSS doing honest 3D: `rotateX`/`rotateY` inside a
parent with `perspective`, so far edges really are further away. That's what
`public/js/tilt.js` drives when a card leans towards your cursor.

### The rules that keep it usable

Decoration is never allowed to get in the way of the app. Four rules enforce
that, and each one exists because the alternative actually broke something:

1. **The scene dims when you enter a room.** `background.setCalm(0.35)` is
   called on join. Spectacle belongs on the landing page; the room has a job.
2. **Text always gets a calm backing.** The landing page lays a dark scrim
   under its words, and every panel holding text is tinted *as well as* blurred.
   Glass over a busy moving image is unreadable otherwise.
3. **Entrance animations in the chat move position only — never opacity.**
   If animation frames stall, a transform-only animation leaves a panel sitting
   a few pixels low. An opacity one leaves it *invisible*, taking the whole
   chat with it. That is not hypothetical: it happened during development.
4. **Everything degrades to nothing.** No WebGL, a shader that won't compile, a
   driver that refuses — the canvas removes itself and the CSS gradient
   underneath carries the look. `prefers-reduced-motion` switches the scene off
   entirely, because large moving backgrounds genuinely make some people ill.

### What it costs

The shader renders at 60% of screen resolution (invisible on something this
soft, far cheaper to draw), stops completely when the tab is hidden, and paints
one frame immediately at startup so the scene is never a black rectangle
waiting for an animation frame that may never come.

---

## Rooms have a name AND a code

This is the most important idea in the app, and the one thing to get straight:

| | Example | Purpose | Unique? |
|---|---|---|---|
| **Name** | `Monday Standup` | What the room is *for*. Shown at the top of the screen. | No — two rooms may share a name |
| **Code** | `QZE-GED` | The *key* you type to get in. | **Yes** — it identifies the room |

Everything internal is filed under the **code**, never the name: the `messages`
table, the in-memory member lists, and Socket.io's own room grouping. A name is
a label for humans and could change or repeat; a code can't.

**Creating** asks for a name, and lets you choose a code or leave it blank.
**Joining** asks only for a code — the name comes back from the database, so you
never have to know it or spell it right.

### Where codes come from

`server/room-codes.js` handles this, and two decisions in it are worth knowing:

- **The alphabet leaves out `I`, `L`, `O`, `0` and `1`.** Those are the
  characters people confuse when reading a code aloud or copying it off a
  screen. Dropping them costs almost nothing and removes a whole class of "I
  typed it exactly and it says it's wrong".
- **Codes are normalised before use** — uppercased, stripped of stray
  characters. So ` qze-ged ` and `QZE-GED` are the same room, and nobody is
  locked out for typing lowercase.

Generation happens on the **server**, not the browser, because only the server
can check that a code isn't already taken. It retries until it finds a free one
rather than trusting that a collision "won't happen".

### What each action refuses

| Action | Refuses | Because |
|---|---|---|
| **Create** | a code that's already taken | you'd silently land in a stranger's room thinking you'd made your own |
| **Create** | a blank room name | a room nobody can identify is no use to the people in it |
| **Join** | a code that doesn't exist | almost always a typo, and you'd sit alone wondering where everyone is |

The browser never decides any of this. `public/js/main.js` only reports which
tab you were on; `server/chat-events.js` makes the ruling. That's deliberate —
the server is the only place that actually knows, and the only place that can't
be lied to by an edited page.

---

## How voice and screen sharing actually work

The part that surprises people: **your audio never reaches this server.**

Every person opens a direct line to every other person — a "mesh":

```
   A ————— B
    \     /
     \   /
       C
```

To open one of those lines, two browsers must first swap notes: *what can you
send? what can you receive? what address can I reach you at?* They can't do
that directly (they've never met), so the server relays those notes. That
relaying is the whole of `server/call-events.js`, and it's called **signaling**.

Once the notes are exchanged, the browsers connect straight to each other and
the server is out of the loop entirely.

Two details worth knowing:

- **STUN servers.** Your computer sits behind a router and doesn't know its own
  public address. A free public STUN server tells it "from out here you look
  like this." It sees no audio or video — just addresses.

- **Perfect negotiation.** If both browsers try to start the handshake at the
  same instant they talk over each other and the connection wedges. The fix, in
  `call.js`, is that both sides compare their two connection ids — a comparison
  that always gives opposite answers — so one side politely backs down. No extra
  coordination message needed.

**Why it needs `localhost` or `https`:** browsers refuse to hand out a mic or a
screen over an insecure connection. `localhost` is trusted as a special case,
and real hosting gives you `https`. A bare address like `http://192.168.1.5:3000`
is neither — text chat works there, voice and screen sharing won't.

**The size limit:** mesh is perfect for 2–6 people. Beyond that, every device is
sending its audio separately to everyone else and it gets heavy. That's a real
property of this simple design, not a bug — bigger apps add a central media
server to solve it, at the cost of much more complexity.

---

## What survives a restart, and what doesn't

| | Survives? | Why |
|---|---|---|
| Chat messages | **Yes** | Written to `chat.db` on disk |
| Who's online | No | Only in memory (`server/rooms.js`) — and correctly so, since nobody is connected after a restart |
| Voice calls | No | They're live connections between browsers |

---

## Where to change things

| I want to… | Edit |
|---|---|
| Change the colour scheme | `public/css/base.css` — the `:root` block at the top |
| Change the message limit, port, or history length | `server/config.js` |
| Change how a message looks | `addMessage()` in `public/js/chat.js`, `.msg` in `chat.css` |
| Change the join screen wording | `public/index.html` |
| Add a new chat feature | `server/chat-events.js` + `public/js/chat.js` |
| Touch the voice/screen logic | `public/js/call.js` (the browser does the real work) |
