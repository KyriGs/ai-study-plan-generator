"use strict";

// ============================================================
//  NEON CANYON — game engine
//  Sections: constants, audio, input, level loading, physics,
//  hazards & pickups, particles, camera, rendering, game loop
// ============================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ----- Constants -----
const TILE = 32;
const VIEW_W = 960, VIEW_H = 540;

// Physics (tuned for arcade feel)
const GRAV = 2300;          // base gravity, px/s^2
const FALL_MULT = 1.55;     // extra gravity while falling -> snappy arc
const MAX_FALL = 950;
const RUN_SPEED = 270;
const GROUND_ACC = 3000, GROUND_FRI = 2600;
const AIR_ACC = 2000, AIR_FRI = 500;
const JUMP_VEL = 650;
// Hollow-Knight-style variable jump: max height only if you hold the key.
// Tap = small pop (~1/3 height): hard cut on release + heavy deceleration
// while still rising, plus a slight hang right at the apex.
const JUMP_CUT = 0.25;      // velocity kept when jump key released early
const CUT_GRAV_MULT = 3.0;  // extra gravity while rising after an early release
const APEX_HANG_VY = 60;    // |vy| below this counts as apex...
const APEX_HANG_MULT = 0.55; // ...where gravity softens for a moment of hang
const COYOTE_TIME = 0.09;   // seconds you can still jump after leaving a ledge
const BUFFER_TIME = 0.11;   // seconds a jump press is remembered before landing
const PLAYER_W = 22, PLAYER_H = 30;

// Dash
const DASH_SPEED = 640;
const DASH_TIME = 0.13;     // seconds of dash
const DASH_COOLDOWN = 0.45;

// Ghost replay
const GHOST_HZ = 30;        // samples per second
const GHOST_MAX = 20000;    // ~11 minutes of recording, hard cap

const C = {
  skyTop: "#050514", skyBottom: "#1a1040",
  hillFar: "#181048", hillNear: "#251a63",
  platFill: "#0d1830", platTop: "#3fe8ff", platSide: "#1a5f88",
  player: "#7cff6b", coin: "#ffd84d", coinCore: "#fff3b0",
  spike: "#ff3e6c", exitFlag: "#ff5cf0",
  cpOff: "#6b46c1", cpOn: "#58ffd0",
  text: "#cfe8ff", accent: "#3fe8ff",
};

// ----- Audio (WebAudio synth bleeps, no files) -----
const audio = {
  ctx: null,
  muted: false,
  init() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
  tone(f0, f1, dur, type, vol) {
    if (!this.ctx || this.muted || settings.sfx <= 0.01) return;
    vol *= settings.sfx;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  jump()  { this.tone(220, 460, 0.13, "square", 0.12); },
  dash()  { this.tone(320, 720, 0.12, "sawtooth", 0.1); },
  coin()  { this.tone(950, 1500, 0.09, "triangle", 0.18); },
  hurt()  { this.tone(280, 70, 0.28, "sawtooth", 0.2); },
  checkpoint() {
    this.tone(660, 660, 0.08, "square", 0.12);
    setTimeout(() => this.tone(990, 990, 0.14, "square", 0.12), 90);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this.tone(f, f, 0.16, "square", 0.12), i * 100));
  },
};

// ----- Music (synthwave arpeggio engine, fully synthesized) -----
// Tracks: title = dreamy/slow; levels ramp bpm + change key (Am -> Dm -> Em).
// pat: 8 eighth-note steps per bar; 0-2 = chord note index, 3 = root an octave up, null = rest.
const MTRACKS = {
  title: { bpm: 68,  pat: [0, null, 2, null, 1, null, 2, null], chords: [[57,60,64],[53,57,60],[48,52,55],[55,59,62]] },
  L0:    { bpm: 100, pat: [0, 1, 2, 1, 3, 1, 2, 1],             chords: [[57,60,64],[53,57,60],[48,52,55],[55,59,62]] },
  L1:    { bpm: 116, pat: [0, 1, 2, 1, 3, 2, 1, 2],             chords: [[50,53,57],[46,50,53],[53,57,60],[48,52,55]] },
  L2:    { bpm: 132, pat: [0, 2, 3, 2, 0, 2, 3, 2],             chords: [[52,55,59],[48,52,55],[55,59,62],[50,54,57]] },
  L3:    { bpm: 140, pat: [0, 3, 2, 3, 1, 3, 2, 3],             chords: [[57,60,64],[53,57,60],[48,52,55],[55,59,62]] },
  L4:    { bpm: 148, pat: [0, 2, 3, 2, 1, 2, 3, 2],             chords: [[52,55,59],[48,52,55],[55,59,62],[50,54,57]] },
};
const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const music = {
  trackId: null, track: null, step: 0, nextT: 0, timer: null, gainNode: null,
  ensure() {
    if (!audio.ctx) return;
    if (!this.gainNode) {
      this.gainNode = audio.ctx.createGain();
      this.gainNode.gain.value = 0.6;
      this.gainNode.connect(audio.ctx.destination);
    }
    if (!this.timer) {
      this.nextT = audio.ctx.currentTime + 0.06;
      this.timer = setInterval(() => this.schedule(), 90);
    }
  },
  // pick track from game state + fade for menus/mute; call on every state change
  sync() {
    if (!audio.ctx) return;
    this.ensure();
    const want = (game.state === "title" || game.state === "win" || game.state === "binds" || game.state === "options") ? "title" : "L" + game.levelIndex;
    if (want !== this.trackId) {
      this.trackId = want;
      this.track = MTRACKS[want] || MTRACKS.L0;
      this.step = 0;
    }
    const duck = (game.state === "complete" || game.state === "win") ? 0.35 : 1;
    this.gainNode.gain.setTargetAtTime(audio.muted ? 0 : 0.6 * settings.music * duck, audio.ctx.currentTime, 0.15);
  },
  schedule() {
    const ctx = audio.ctx;
    if (!ctx || !this.track) return;
    while (this.nextT < ctx.currentTime + 0.3) {
      this.playStep(this.step, this.nextT);
      this.nextT += 60 / this.track.bpm / 2; // eighth notes
      this.step = (this.step + 1) % (8 * this.track.chords.length);
    }
  },
  note(midi, t, dur, type, vol, filterFreq) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = midiFreq(midi);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let head = o;
    if (filterFreq) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = filterFreq;
      o.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(this.gainNode);
    o.start(t);
    o.stop(t + dur + 0.05);
  },
  playStep(step, t) {
    const tr = this.track;
    const chord = tr.chords[Math.floor(step / 8) % tr.chords.length];
    const beat = 60 / tr.bpm;
    const pi = tr.pat[step % 8];
    if (pi !== null) {
      const midi = pi === 3 ? chord[0] + 12 : chord[pi];
      this.note(midi, t, beat * 0.9, "sawtooth", 0.05, 1400); // arp lead
    }
    if (step % 8 === 0) { // once per bar: bass + pad
      this.note(chord[0] - 24, t, beat * 3.5, "triangle", 0.09);
      for (const n of chord) this.note(n - 12, t, beat * 3.8, "sine", 0.018);
    }
  },
};

// ----- Volume / effects settings (saved to localStorage) -----
const DEFAULT_SETTINGS = { music: 0.7, sfx: 0.7, vfx: 1.0 };
let settings = loadSettings();
function loadSettings() {
  try {
    const j = JSON.parse(localStorage.getItem("neonCanyon.settings"));
    if (j && ["music", "sfx", "vfx"].every((k) => typeof j[k] === "number")) return j;
  } catch (e) {}
  return { ...DEFAULT_SETTINGS };
}
function saveSettings() {
  try { localStorage.setItem("neonCanyon.settings", JSON.stringify(settings)); } catch (e) {}
}

// ----- Keybinds (rebindable, saved to localStorage) -----
const DEFAULT_BINDS = {
  left:  ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  jump:  ["ArrowUp", "KeyW", "Space"],
  dash:  ["ShiftLeft", "ShiftRight", "KeyX"],
};
let binds = loadBinds();
let bindCapture = null; // action id currently waiting for a key press

function loadBinds() {
  try {
    const j = JSON.parse(localStorage.getItem("neonCanyon.binds"));
    if (j && ["left", "right", "jump", "dash"].every((k) => Array.isArray(j[k]) && j[k].length)) return j;
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_BINDS));
}
function saveBinds() {
  try { localStorage.setItem("neonCanyon.binds", JSON.stringify(binds)); } catch (e) {}
}
function isBound(code) {
  return Object.values(binds).some((list) => list.includes(code));
}
function keyName(code) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "NUM " + code.slice(6);
  const map = {
    ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
    Space: "SPACE", Enter: "ENTER", Tab: "TAB", Backspace: "BKSP", CapsLock: "CAPS",
    ShiftLeft: "L-SHIFT", ShiftRight: "R-SHIFT", ControlLeft: "L-CTRL", ControlRight: "R-CTRL",
    AltLeft: "L-ALT", AltRight: "R-ALT", Semicolon: ";", Quote: "'", Comma: ",",
    Period: ".", Slash: "/", Backslash: "\\", BracketLeft: "[", BracketRight: "]",
    Minus: "-", Equal: "=", Backquote: "`",
  };
  return map[code] || code.toUpperCase();
}
function bindLabel(action) {
  return binds[action].map(keyName).join(" / ");
}

// ----- Mouse (for menu buttons) -----
const mouse = { x: -1, y: -1 };
let uiButtons = []; // rebuilt every frame by the menu draw functions
let uiSliders = [];
let uiHover = false;
let activeSlider = null;

function canvasCoords(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * VIEW_W / r.width, y: (e.clientY - r.top) * VIEW_H / r.height };
}
function setSlider(id, frac) {
  settings[id] = Math.round(clamp(frac, 0, 1) * 100) / 100;
  if (id === "music") music.sync(); // live volume while dragging
}
canvas.addEventListener("mousemove", (e) => {
  const c = canvasCoords(e);
  mouse.x = c.x; mouse.y = c.y;
  if (activeSlider) {
    const s = uiSliders.find((u) => u.id === activeSlider);
    if (s) setSlider(s.id, (c.x - s.x) / s.w);
  }
});
canvas.addEventListener("mousedown", (e) => {
  const c = canvasCoords(e);
  for (const s of uiSliders) {
    if (c.x >= s.x - 10 && c.x <= s.x + s.w + 10 && c.y >= s.y - 12 && c.y <= s.y + s.h + 12) {
      activeSlider = s.id;
      setSlider(s.id, (c.x - s.x) / s.w);
      break;
    }
  }
});
window.addEventListener("mouseup", () => {
  if (activeSlider) {
    saveSettings();
    if (activeSlider === "sfx") audio.coin(); // preview the new level
    activeSlider = null;
  }
});
canvas.addEventListener("click", (e) => {
  audio.init();
  const c = canvasCoords(e);
  for (const b of uiButtons) {
    if (c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h) { uiAction(b.id); break; }
  }
});

function uiAction(id) {
  if (id === "controls") { game.state = "binds"; }
  else if (id === "options") { game.state = "options"; }
  else if (id === "back") { game.state = "title"; bindCapture = null; }
  else if (id === "reset") { binds = JSON.parse(JSON.stringify(DEFAULT_BINDS)); saveBinds(); bindCapture = null; }
  else if (id.startsWith("bind:")) { bindCapture = id.slice(5); }
  music.sync();
}

// ----- Input -----
const keys = new Set();

window.addEventListener("keydown", (e) => {
  if (game.state === "binds" && bindCapture) {
    // capturing a new key: any key binds, Escape cancels
    e.preventDefault();
    if (e.code !== "Escape") {
      // steal the key from any other action that still has a spare key
      for (const a of Object.keys(binds)) {
        if (a !== bindCapture && binds[a].includes(e.code) && binds[a].length > 1) {
          binds[a] = binds[a].filter((c) => c !== e.code);
        }
      }
      binds[bindCapture] = [e.code];
      saveBinds();
    }
    bindCapture = null;
    return;
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  audio.init();
  if (keys.has(e.code)) return; // ignore key repeat
  keys.add(e.code);
  onKeyPressed(e.code);
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (binds.jump.includes(e.code) && game.player && game.player.vy < 0) {
    game.player.vy *= JUMP_CUT; // jump cut: release early = shorter hop
    game.player.jumpCut = true; // heavy deceleration until the rise ends
  }
});
window.addEventListener("blur", () => keys.clear());

function onKeyPressed(code) {
  if (game.state === "binds" || game.state === "options") {
    if (code === "Escape") { game.state = "title"; music.sync(); }
    return;
  }
  // system keys only act when not claimed by a custom bind
  if (code === "KeyM" && !isBound(code)) { audio.muted = !audio.muted; music.sync(); return; }

  if (game.state === "playing") {
    if (binds.jump.includes(code)) game.player.buffer = BUFFER_TIME;
    if (binds.dash.includes(code)) tryDash();
    if (code === "KeyR" && !isBound(code)) loadLevel(game.levelIndex);
  } else if (code === "Enter" || code === "Space") {
    if (game.state === "title") {
      game.totals = { coins: 0, coinsTotal: 0, deaths: 0 };
      loadLevel(0);
      game.state = "playing";
    } else if (game.state === "complete") {
      if (game.levelIndex + 1 < LEVELS.length) {
        loadLevel(game.levelIndex + 1);
        game.state = "playing";
      } else {
        game.state = "win";
      }
    } else if (game.state === "win") {
      game.state = "title";
    }
  }
  music.sync();
}

// ----- Game state -----
const game = {
  state: "title",   // title | playing | complete | win
  levelIndex: 0,
  grid: [], gw: 0, gh: 0,
  spikes: [], coins: [], checkpoints: [], exit: null,
  start: { x: 0, y: 0 },
  respawn: { x: 0, y: 0 },
  player: null,
  cam: { x: 0, y: 0 },
  particles: [],
  hearts: 3, deaths: 0,
  coinsGot: 0, coinsTotal: 0,
  totals: { coins: 0, coinsTotal: 0, deaths: 0 },
  time: 0,
  damageFlash: 0,
  runTime: 0,           // level timer (speedrun clock, keeps running through deaths)
  rec: [], recAcc: 0,   // current run recording for the ghost
  best: null,           // { time, samples } — best run for this level
  newRecord: false,
};
window.game = game; // handy for console debugging

function newPlayer(x, y) {
  return {
    x, y, vx: 0, vy: 0,
    onGround: false, facing: 1,
    coyote: 0, buffer: 0, iframes: 0,
    sy: 1, // squash/stretch scale
    dashTime: 0, dashCd: 0, dashDir: 1, canAirDash: true,
    jumpCut: false,
  };
}

function tryDash() {
  const p = game.player;
  if (!p || p.dashTime > 0 || p.dashCd > 0) return;
  if (!p.onGround && !p.canAirDash) return;
  if (!p.onGround) p.canAirDash = false;
  p.dashTime = DASH_TIME;
  p.dashCd = DASH_COOLDOWN;
  p.dashDir = p.facing;
  audio.dash();
}

// ----- Level loading -----
function loadLevel(index) {
  const lvl = LEVELS[index];
  game.levelIndex = index;
  game.grid = [];
  game.spikes = [];
  game.coins = [];
  game.checkpoints = [];
  game.exit = null;
  game.gh = lvl.map.length;
  game.gw = Math.max(...lvl.map.map((r) => r.length));

  for (let r = 0; r < game.gh; r++) {
    const row = [];
    for (let c = 0; c < game.gw; c++) {
      const ch = lvl.map[r][c] || " ";
      row.push(ch === "#" ? 1 : 0);
      const x = c * TILE, y = r * TILE;
      if (ch === "^") game.spikes.push({ x: x + 5, y: y + 16, w: 22, h: 16, cx: x + 16, tx: c, ty: r });
      if (ch === "o") game.coins.push({ x: x + 16, y: y + 16, taken: false, phase: (r * 7 + c * 13) % 6 });
      if (ch === "C") game.checkpoints.push({ x, y, active: false });
      if (ch === "E") game.exit = { x, y: y - TILE * 3, w: TILE, h: TILE * 4 }; // tall hitbox: can't jump over the flag
      if (ch === "P") game.start = { x: x + (TILE - PLAYER_W) / 2, y: y + TILE - PLAYER_H };
    }
    game.grid.push(row);
  }

  game.player = newPlayer(game.start.x, game.start.y);
  game.respawn = { x: game.start.x, y: game.start.y };
  game.hearts = 3;
  game.deaths = 0;
  game.coinsGot = 0;
  game.coinsTotal = game.coins.length;
  game.particles = [];
  game.runTime = 0;
  game.rec = [];
  game.recAcc = 0;
  game.newRecord = false;
  game.best = loadBest(index);
  game.cam.x = clamp(game.player.x - VIEW_W * 0.4, 0, Math.max(0, game.gw * TILE - VIEW_W));
  game.cam.y = clamp(game.player.y - VIEW_H * 0.5, 0, Math.max(0, game.gh * TILE - VIEW_H));
}

function solid(c, r) {
  if (c < 0 || c >= game.gw) return true; // level edges are walls
  if (r < 0 || r >= game.gh) return false;
  return game.grid[r][c] === 1;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ----- Best-run storage (per level, survives closing the browser) -----
function loadBest(index) {
  try {
    const j = localStorage.getItem("neonCanyon.best." + index);
    return j ? JSON.parse(j) : null;
  } catch (e) { return null; }
}
function saveBest(index, best) {
  try { localStorage.setItem("neonCanyon.best." + index, JSON.stringify(best)); } catch (e) {}
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m > 0 ? m + ":" + s.toFixed(2).padStart(5, "0") : s.toFixed(2);
}

function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ----- Physics -----
function updatePlayer(dt) {
  const p = game.player;
  const left = binds.left.some((c) => keys.has(c));
  const right = binds.right.some((c) => keys.has(c));
  const dir = (right ? 1 : 0) - (left ? 1 : 0);

  // dash timers
  p.dashCd -= dt;
  if (p.onGround) p.canAirDash = true;
  const dashing = p.dashTime > 0;
  if (dashing) {
    p.dashTime -= dt;
    p.vx = p.dashDir * DASH_SPEED;
    p.vy = 0; // dash freezes gravity — straight neon line
    if (p.dashTime <= 0) p.vx = p.dashDir * RUN_SPEED; // exit dash at run speed
    spawnParticle(p.x + PLAYER_W / 2, p.y + PLAYER_H / 2 + (Math.random() - 0.5) * 14,
      -p.dashDir * 60, 0, 0.25, 4, C.player, 0);
    if (dir !== 0) p.facing = dir; // allow pre-steering the next move
  } else {
    // horizontal: accelerate toward input, friction when idle
    const acc = p.onGround ? GROUND_ACC : AIR_ACC;
    const fri = p.onGround ? GROUND_FRI : AIR_FRI;
    if (dir !== 0) {
      p.vx = clamp(p.vx + dir * acc * dt, -RUN_SPEED, RUN_SPEED);
      p.facing = dir;
    } else if (p.vx !== 0) {
      const s = Math.sign(p.vx);
      p.vx -= s * fri * dt;
      if (Math.sign(p.vx) !== s) p.vx = 0;
    }
  }

  // timers
  p.coyote = p.onGround ? COYOTE_TIME : p.coyote - dt;
  p.buffer -= dt;
  p.iframes -= dt;

  // jump (with coyote time + input buffer) — cancels a dash
  if (p.buffer > 0 && p.coyote > 0) {
    p.dashTime = 0;
    p.jumpCut = false;
    p.vy = -JUMP_VEL;
    p.buffer = 0;
    p.coyote = 0;
    p.onGround = false;
    p.sy = 1.35; // stretch
    audio.jump();
    dust(p.x + PLAYER_W / 2, p.y + PLAYER_H, 5);
  }

  // gravity — heavier falling, much heavier after a cut, soft at the apex
  if (p.dashTime <= 0) {
    let g = GRAV;
    if (p.vy > 0) { g *= FALL_MULT; p.jumpCut = false; }
    else if (p.jumpCut) g *= CUT_GRAV_MULT;
    if (!p.onGround && Math.abs(p.vy) < APEX_HANG_VY) g *= APEX_HANG_MULT;
    p.vy = Math.min(p.vy + g * dt, MAX_FALL);
  }

  // move & collide, one axis at a time
  moveX(p, dt);
  const fallSpeed = p.vy;
  const wasGround = p.onGround;
  p.onGround = false;
  moveY(p, dt);
  if (p.onGround && !wasGround && fallSpeed > 350) {
    p.sy = 0.62; // squash on hard landing
    dust(p.x + PLAYER_W / 2, p.y + PLAYER_H, 8);
  }

  // squash/stretch springs back to 1
  p.sy += (1 - p.sy) * Math.min(1, 14 * dt);

  checkHazards(p);
}

function tileRange(p) {
  return {
    c0: Math.floor(p.x / TILE),
    c1: Math.floor((p.x + PLAYER_W - 0.01) / TILE),
    r0: Math.floor(p.y / TILE),
    r1: Math.floor((p.y + PLAYER_H - 0.01) / TILE),
  };
}

function moveX(p, dt) {
  p.x += p.vx * dt;
  p.x = clamp(p.x, 0, game.gw * TILE - PLAYER_W);
  const t = tileRange(p);
  for (let r = t.r0; r <= t.r1; r++) {
    for (let c = t.c0; c <= t.c1; c++) {
      if (!solid(c, r)) continue;
      if (p.vx > 0) p.x = c * TILE - PLAYER_W;
      else if (p.vx < 0) p.x = c * TILE + TILE;
      p.vx = 0;
      return;
    }
  }
}

function moveY(p, dt) {
  p.y += p.vy * dt;
  const t = tileRange(p);
  for (let r = t.r0; r <= t.r1; r++) {
    for (let c = t.c0; c <= t.c1; c++) {
      if (!solid(c, r)) continue;
      if (p.vy > 0) {
        p.y = r * TILE - PLAYER_H;
        p.onGround = true;
      } else if (p.vy < 0) {
        p.y = r * TILE + TILE;
      }
      p.vy = 0;
      return;
    }
  }
}

// ----- Hazards, pickups, goals -----
function checkHazards(p) {
  // spikes
  if (p.iframes <= 0) {
    for (const s of game.spikes) {
      if (overlap(p.x, p.y, PLAYER_W, PLAYER_H, s.x, s.y, s.w, s.h)) {
        damage(s.cx);
        break;
      }
    }
  }

  // coins
  for (const coin of game.coins) {
    if (coin.taken) continue;
    if (overlap(p.x, p.y, PLAYER_W, PLAYER_H, coin.x - 10, coin.y - 10, 20, 20)) {
      coin.taken = true;
      game.coinsGot++;
      audio.coin();
      sparkle(coin.x, coin.y);
    }
  }

  // checkpoints
  for (const cp of game.checkpoints) {
    if (cp.active) continue;
    if (overlap(p.x, p.y, PLAYER_W, PLAYER_H, cp.x, cp.y - TILE * 2, TILE, TILE * 3)) {
      game.checkpoints.forEach((o) => (o.active = false));
      cp.active = true;
      game.respawn = { x: cp.x + (TILE - PLAYER_W) / 2, y: cp.y + TILE - PLAYER_H };
      audio.checkpoint();
      sparkle(cp.x + 16, cp.y + 8, C.cpOn);
    }
  }

  // exit
  const e = game.exit;
  if (e && overlap(p.x, p.y, PLAYER_W, PLAYER_H, e.x, e.y, e.w, e.h)) {
    game.totals.coins += game.coinsGot;
    game.totals.coinsTotal += game.coinsTotal;
    game.totals.deaths += game.deaths;
    if (!game.best || game.runTime < game.best.time) {
      game.best = { time: game.runTime, samples: game.rec };
      saveBest(game.levelIndex, game.best);
      game.newRecord = true;
    }
    game.state = "complete";
    audio.win();
    music.sync();
    return;
  }

  // fell off the bottom
  if (p.y > game.gh * TILE + 80) {
    game.hearts--;
    audio.hurt();
    if (game.hearts <= 0) {
      game.hearts = 3;
      game.deaths++;
    }
    respawnPlayer();
  }
}

function damage(srcX) {
  const p = game.player;
  game.hearts--;
  game.damageFlash = 0.3;
  p.dashTime = 0;
  p.iframes = 1.0;
  p.vy = -380; // knockback: up and away from the hazard
  p.vx = p.x + PLAYER_W / 2 < srcX ? -300 : 300;
  audio.hurt();
  burst(p.x + PLAYER_W / 2, p.y + PLAYER_H / 2);
  if (game.hearts <= 0) {
    game.hearts = 3;
    game.deaths++;
    respawnPlayer();
  }
}

function respawnPlayer() {
  const p = game.player;
  p.x = game.respawn.x;
  p.y = game.respawn.y;
  p.vx = 0;
  p.vy = 0;
  p.iframes = 1.5;
  game.damageFlash = 0.3;
}

// ----- Particles -----
function spawnParticle(x, y, vx, vy, life, size, color, grav) {
  // EFFECTS slider statistically thins particles (1 = all, 0 = none)
  if (settings.vfx < 0.99 && Math.random() > settings.vfx) return;
  game.particles.push({ x, y, vx, vy, life, max: life, size, color, grav });
}
function dust(x, y, n) {
  for (let i = 0; i < n; i++) {
    spawnParticle(x + (Math.random() - 0.5) * 16, y,
      (Math.random() - 0.5) * 120, -Math.random() * 60,
      0.35, 2 + Math.random() * 2, "#8fd8e8", 300);
  }
}
function sparkle(x, y, color) {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    spawnParticle(x, y, Math.cos(a) * 90, Math.sin(a) * 90,
      0.4, 2.5, color || C.coin, 0);
  }
}
function burst(x, y) {
  for (let i = 0; i < 14; i++) {
    spawnParticle(x, y, (Math.random() - 0.5) * 300, -Math.random() * 250,
      0.5, 3, C.spike, 600);
  }
}
function updateParticles(dt) {
  const ps = game.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.grav * dt;
    p.life -= dt;
    if (p.life <= 0) ps.splice(i, 1);
  }
}

// ----- Camera -----
function updateCamera(dt) {
  const p = game.player;
  const tx = clamp(p.x + PLAYER_W / 2 - VIEW_W * 0.42, 0, Math.max(0, game.gw * TILE - VIEW_W));
  const ty = clamp(p.y + PLAYER_H / 2 - VIEW_H * 0.55, 0, Math.max(0, game.gh * TILE - VIEW_H));
  const k = Math.min(1, 8 * dt);
  game.cam.x += (tx - game.cam.x) * k;
  game.cam.y += (ty - game.cam.y) * k;
}

// ----- Rendering -----
// deterministic pseudo-random for stars
const stars = (() => {
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = [];
  for (let i = 0; i < 110; i++) {
    out.push({ x: rnd() * VIEW_W, y: rnd() * 380, r: 0.6 + rnd() * 1.5, tw: rnd() * 6.28 });
  }
  return out;
})();

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  grad.addColorStop(0, C.skyTop);
  grad.addColorStop(1, C.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // stars (slowest layer)
  ctx.fillStyle = "#cfeaff";
  for (const s of stars) {
    let x = (s.x - game.cam.x * 0.1) % VIEW_W;
    if (x < 0) x += VIEW_W;
    const a = 0.35 + 0.35 * Math.sin(game.time * 1.5 + s.tw);
    ctx.globalAlpha = a;
    ctx.fillRect(x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  drawHills(C.hillFar, 0.35, 400, 60, 0.006, 0.013);
  drawHills(C.hillNear, 0.65, 460, 50, 0.009, 0.021);
}

function drawHills(color, factor, base, amp, f1, f2) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, VIEW_H);
  for (let sx = 0; sx <= VIEW_W; sx += 12) {
    const wx = sx + game.cam.x * factor;
    const y = base - Math.abs(Math.sin(wx * f1)) * amp - Math.sin(wx * f2) * amp * 0.4;
    ctx.lineTo(sx, y);
  }
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.closePath();
  ctx.fill();
}

function drawWorld() {
  ctx.save();
  ctx.translate(-Math.round(game.cam.x), -Math.round(game.cam.y));

  // visible tile range only
  const c0 = Math.max(0, Math.floor(game.cam.x / TILE));
  const c1 = Math.min(game.gw - 1, Math.floor((game.cam.x + VIEW_W) / TILE));

  // platforms
  for (let r = 0; r < game.gh; r++) {
    for (let c = c0; c <= c1; c++) {
      if (game.grid[r][c] !== 1) continue;
      const x = c * TILE, y = r * TILE;
      ctx.fillStyle = C.platFill;
      ctx.fillRect(x, y, TILE, TILE);
      // neon top edge where exposed
      if (!solid(c, r - 1) || r === 0) {
        ctx.fillStyle = C.platTop;
        ctx.fillRect(x, y, TILE, 3);
      }
      ctx.fillStyle = C.platSide;
      if (c === 0 || game.grid[r][c - 1] !== 1) ctx.fillRect(x, y, 2, TILE);
      if (c === game.gw - 1 || game.grid[r][c + 1] !== 1) ctx.fillRect(x + TILE - 2, y, 2, TILE);
    }
  }

  drawCheckpoints();
  drawExit();
  drawSpikes();
  drawCoins();
  drawParticles();
  drawGhost();
  drawPlayer();

  ctx.restore();
}

function drawSpikes() {
  ctx.fillStyle = C.spike;
  ctx.shadowColor = C.spike;
  ctx.shadowBlur = 8;
  for (const s of game.spikes) {
    const bx = s.tx * TILE, by = s.ty * TILE + TILE;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const x0 = bx + i * (TILE / 3);
      ctx.moveTo(x0, by);
      ctx.lineTo(x0 + TILE / 6, by - 18);
      ctx.lineTo(x0 + TILE / 3, by);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawCoins() {
  for (const coin of game.coins) {
    if (coin.taken) continue;
    const bob = Math.sin(game.time * 3 + coin.phase) * 3;
    const spin = Math.abs(Math.cos(game.time * 2.2 + coin.phase));
    ctx.save();
    ctx.translate(coin.x, coin.y + bob);
    ctx.scale(0.35 + spin * 0.65, 1);
    ctx.shadowColor = C.coin;
    ctx.shadowBlur = 12;
    ctx.fillStyle = C.coin;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = C.coinCore;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawCheckpoints() {
  for (const cp of game.checkpoints) {
    const x = cp.x + 16, yBase = cp.y + TILE;
    const col = cp.active ? C.cpOn : C.cpOff;
    ctx.strokeStyle = "#3a3a5c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, yBase);
    ctx.lineTo(x, yBase - 40);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = cp.active ? 14 : 5;
    ctx.beginPath();
    ctx.arc(x, yBase - 40, cp.active ? 6.5 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (cp.active) {
      const pulse = 8 + Math.sin(game.time * 5) * 3;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, yBase - 40, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

function drawExit() {
  const e = game.exit;
  if (!e) return;
  const x = e.x + 8, yBase = e.y + e.h;
  ctx.strokeStyle = "#c8c8e8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, yBase);
  ctx.lineTo(x, yBase - 56);
  ctx.stroke();
  // waving flag
  const wave = Math.sin(game.time * 6) * 3;
  ctx.fillStyle = C.exitFlag;
  ctx.shadowColor = C.exitFlag;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(x, yBase - 56);
  ctx.lineTo(x + 24, yBase - 48 + wave);
  ctx.lineTo(x, yBase - 40);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawParticles() {
  for (const p of game.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawGhost() {
  const b = game.best;
  if (!b || !b.samples || !b.samples.length || game.state !== "playing") return;
  const fi = game.runTime * GHOST_HZ;
  const i = Math.floor(fi);
  if (i >= b.samples.length) return; // ghost already finished
  const s0 = b.samples[i];
  const s1 = b.samples[Math.min(i + 1, b.samples.length - 1)];
  const f = fi - i;
  const x = s0[0] + (s1[0] - s0[0]) * f;
  const y = s0[1] + (s1[1] - s0[1]) * f;
  ctx.save();
  ctx.translate(x + PLAYER_W / 2, y + PLAYER_H);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#9fd8ff";
  knightCloak(1, 0, 0.8); // ghost wears the same cloak
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Little knight: hooded cloak silhouette with a fluttering jagged hem.
// Local coords: origin at the feet center, up = negative y.
function knightCloak(flare, skew, flutterAmp) {
  const t = game.time;
  const hw = 11 * flare; // hem half-width
  ctx.beginPath();
  ctx.moveTo(-hw, 0);
  for (let i = 1; i <= 3; i++) {
    const hx = -hw + (i * hw * 2) / 4 + skew;
    const hy = (i % 2 === 1 ? -3 : 0) + Math.sin(t * 13 + i * 2.1) * flutterAmp;
    ctx.lineTo(hx, hy);
  }
  ctx.lineTo(hw, 0);
  ctx.quadraticCurveTo(hw + 1, -14, 2, -29);  // right side up to the hood
  ctx.quadraticCurveTo(0, -30.5, -2, -29);    // hood point
  ctx.quadraticCurveTo(-hw - 1, -14, -hw, 0); // left side back down
  ctx.closePath();
}

function drawPlayer() {
  const p = game.player;
  if (!p) return;
  // flash while invincible
  if (p.iframes > 0 && Math.floor(game.time * 16) % 2 === 0) return;

  const t = game.time;
  const dashing = p.dashTime > 0;
  const running = p.onGround && Math.abs(p.vx) > 40;
  const falling = !p.onGround && p.vy > 150;
  const idle = p.onGround && !running;

  ctx.save();
  ctx.translate(p.x + PLAYER_W / 2, p.y + PLAYER_H);
  ctx.scale(2 - p.sy, p.sy); // squash & stretch
  if (dashing) ctx.scale(1.12, 0.88);
  // lean into the run, tip back when rising, nose-down when falling
  ctx.rotate(running ? p.facing * 0.09 : !p.onGround ? p.facing * (p.vy > 0 ? -0.06 : 0.05) : 0);
  ctx.translate(0, running ? Math.sin(t * 18) * 1.5 : Math.sin(t * 2.5) * 0.7); // bob / breathe

  // little legs peeking under the hem
  if (running) {
    ctx.fillStyle = "#123818";
    const ph = Math.sin(t * 18) > 0;
    ctx.fillRect(ph ? -7 : -4, -3, 4, 4);
    ctx.fillRect(ph ? 3 : 0, -3, 4, 4);
  }

  // cloak: flares when falling, streams back when dashing
  ctx.fillStyle = C.player;
  ctx.shadowColor = C.player;
  ctx.shadowBlur = dashing ? 18 : 12;
  knightCloak(falling ? 1.18 : 1, dashing ? -p.facing * 5 : 0, falling ? 2.2 : running ? 1.4 : 0.7);
  ctx.fill();
  ctx.shadowBlur = 0;

  // horn nubs
  ctx.strokeStyle = "#eef7ee";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-4.5, -26);
  ctx.quadraticCurveTo(-7.5, -31, -11, -32.5);
  ctx.moveTo(4.5, -26);
  ctx.quadraticCurveTo(7.5, -31, 11, -32.5);
  ctx.stroke();

  // pale mask, shifted toward facing
  const fx = p.facing * 2.5;
  ctx.fillStyle = "#f2fff0";
  ctx.beginPath();
  ctx.ellipse(fx, -19.5, 6.5, 7.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // visor strip: emotes by shape — narrow slit dashing, wide when falling,
  // quick blink while idle
  let vh = 2.6;
  if (dashing) vh = 1.4;
  else if (falling) vh = 4.2;
  else if (idle && (t % 3.3) < 0.12) vh = 0.8;
  ctx.fillStyle = dashing ? "#356e3d" : "#0c2412";
  roundRect(fx + p.facing * 1.2 - 3.5, -20 - vh / 2, 7, vh, vh / 2);
  ctx.fill();

  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

// ----- HUD & screens -----
function drawHeart(x, y, size, filled) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 16, size / 16);
  ctx.beginPath();
  ctx.moveTo(0, 5);
  ctx.bezierCurveTo(-1, 1, -8, -1, -8, -6);
  ctx.bezierCurveTo(-8, -11, -1, -11, 0, -6);
  ctx.bezierCurveTo(1, -11, 8, -11, 8, -6);
  ctx.bezierCurveTo(8, -1, 1, 1, 0, 5);
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = "#ff4d6d";
    ctx.shadowColor = "#ff4d6d";
    ctx.shadowBlur = 8;
    ctx.fill();
  } else {
    ctx.strokeStyle = "#7a3648";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawHUD() {
  // hearts
  for (let i = 0; i < 3; i++) {
    drawHeart(30 + i * 30, 30, 18, i < game.hearts);
  }
  // coin counter
  ctx.save();
  ctx.shadowColor = C.coin;
  ctx.shadowBlur = 8;
  ctx.fillStyle = C.coin;
  ctx.beginPath();
  ctx.arc(VIEW_W - 105, 28, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = C.text;
  ctx.font = "bold 20px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillText(`${game.coinsGot}/${game.coinsTotal}`, VIEW_W - 88, 35);
  // level name + timer
  ctx.fillStyle = "rgba(207,232,255,0.55)";
  ctx.font = "14px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(LEVELS[game.levelIndex].name, VIEW_W / 2, 26);
  ctx.fillStyle = C.accent;
  ctx.font = "bold 16px Consolas, monospace";
  ctx.fillText("TIME " + fmtTime(game.runTime) + (game.best ? "   BEST " + fmtTime(game.best.time) : ""), VIEW_W / 2, 48);
  if (audio.muted) {
    ctx.textAlign = "right";
    ctx.fillText("MUTED (M)", VIEW_W - 14, VIEW_H - 14);
  }
}

function drawPanel(w, h) {
  const x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
  ctx.fillStyle = "rgba(5,5,20,0.72)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = "rgba(13,24,48,0.95)";
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.shadowColor = C.accent;
  ctx.shadowBlur = 18;
  roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  return { x, y };
}

function blinkText(text, x, y, font, color) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(game.time * 4);
  ctx.fillStyle = color || C.text;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

function uiButton(id, x, y, w, h, label, font) {
  uiButtons.push({ id, x, y, w, h });
  const hover = mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
  if (hover) uiHover = true;
  ctx.fillStyle = hover ? "rgba(25,45,85,0.95)" : "rgba(13,24,48,0.9)";
  ctx.strokeStyle = hover ? "#8ff4ff" : C.accent;
  ctx.lineWidth = hover ? 2 : 1.5;
  if (hover) { ctx.shadowColor = C.accent; ctx.shadowBlur = 12; }
  roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = hover ? "#eaffff" : C.text;
  ctx.font = font || "bold 15px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, x + w / 2, y + h / 2 + 5);
}

function drawTitle() {
  ctx.textAlign = "center";
  ctx.fillStyle = C.accent;
  ctx.shadowColor = C.accent;
  ctx.shadowBlur = 24;
  ctx.font = "bold 64px Consolas, monospace";
  ctx.fillText("NEON CANYON", VIEW_W / 2, 190);
  ctx.shadowBlur = 0;
  ctx.fillStyle = C.exitFlag;
  ctx.font = "bold 18px Consolas, monospace";
  ctx.fillText("a tiny neon platformer", VIEW_W / 2, 224);

  ctx.fillStyle = C.text;
  ctx.font = "16px Consolas, monospace";
  const lines = [
    "MOVE   " + bindLabel("left") + "  |  " + bindLabel("right"),
    "JUMP   " + bindLabel("jump") + "  (hold = higher)",
    "DASH   " + bindLabel("dash") + "  (one per jump)",
    "R restart level      M mute",
    "",
    "race your blue ghost — beat your best time!",
  ];
  lines.forEach((t, i) => ctx.fillText(t, VIEW_W / 2, 300 + i * 28));

  blinkText("PRESS ENTER TO START", VIEW_W / 2, 485, "bold 22px Consolas, monospace");
  uiButton("controls", VIEW_W - 190, 16, 174, 40, "⌨ CHANGE KEYS");
  uiButton("options", VIEW_W - 190, 64, 174, 40, "🔊 SOUND & FX");
}

function drawSlider(id, label, x, y, w) {
  uiSliders.push({ id, x, y, w, h: 8 });
  const v = settings[id];
  ctx.fillStyle = C.text;
  ctx.font = "bold 17px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillText(label, x - 185, y + 10);
  // track
  ctx.fillStyle = "rgba(63,232,255,0.15)";
  roundRect(x, y, w, 8, 4);
  ctx.fill();
  // fill
  if (v > 0) {
    ctx.fillStyle = C.accent;
    ctx.shadowColor = C.accent;
    ctx.shadowBlur = 6;
    roundRect(x, y, Math.max(8, w * v), 8, 4);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  // knob
  const dragging = activeSlider === id;
  ctx.fillStyle = dragging ? "#ffffff" : "#cfeaff";
  ctx.shadowColor = C.accent;
  ctx.shadowBlur = dragging ? 14 : 8;
  ctx.beginPath();
  ctx.arc(x + w * v, y + 4, dragging ? 9 : 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // percent
  ctx.fillStyle = "rgba(207,232,255,0.7)";
  ctx.font = "15px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillText(Math.round(v * 100) + "%", x + w + 18, y + 10);
}

function drawOptions() {
  const { x, y } = drawPanel(620, 340);
  ctx.textAlign = "center";
  ctx.fillStyle = C.accent;
  ctx.shadowColor = C.accent;
  ctx.shadowBlur = 14;
  ctx.font = "bold 32px Consolas, monospace";
  ctx.fillText("SOUND & EFFECTS", VIEW_W / 2, y + 52);
  ctx.shadowBlur = 0;

  drawSlider("music", "MUSIC", x + 240, y + 95, 260);
  drawSlider("sfx", "SOUNDS", x + 240, y + 157, 260);
  drawSlider("vfx", "EFFECTS", x + 240, y + 219, 260);

  uiButton("back", x + 210, y + 262, 200, 42, "BACK  (ESC)");
  ctx.fillStyle = "rgba(207,232,255,0.5)";
  ctx.font = "13px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText("EFFECTS = particles & screen flash   |   M still mutes everything", VIEW_W / 2, y + 325);
}

const BIND_ROWS = [
  ["left", "MOVE LEFT"],
  ["right", "MOVE RIGHT"],
  ["jump", "JUMP"],
  ["dash", "DASH"],
];

function drawBinds() {
  const { x, y } = drawPanel(620, 420);
  ctx.textAlign = "center";
  ctx.fillStyle = C.accent;
  ctx.shadowColor = C.accent;
  ctx.shadowBlur = 14;
  ctx.font = "bold 32px Consolas, monospace";
  ctx.fillText("CONTROLS", VIEW_W / 2, y + 52);
  ctx.shadowBlur = 0;

  BIND_ROWS.forEach(([action, label], i) => {
    const rowY = y + 90 + i * 58;
    ctx.fillStyle = C.text;
    ctx.font = "bold 17px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(label, x + 55, rowY + 26);
    const capturing = bindCapture === action;
    if (capturing) {
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(game.time * 6);
      uiButton("bind:" + action, x + 240, rowY, 325, 40, "PRESS ANY KEY...  (ESC cancels)");
      ctx.restore();
    } else {
      uiButton("bind:" + action, x + 240, rowY, 325, 40, bindLabel(action));
    }
  });

  uiButton("reset", x + 90, y + 340, 200, 42, "RESET DEFAULTS");
  uiButton("back", x + 330, y + 340, 200, 42, "BACK  (ESC)");
  ctx.fillStyle = "rgba(207,232,255,0.5)";
  ctx.font = "13px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText("click a key box, then press the key you want — any key works", VIEW_W / 2, y + 405);
}

function drawComplete() {
  const { y } = drawPanel(480, 320);
  ctx.textAlign = "center";
  ctx.fillStyle = C.cpOn;
  ctx.shadowColor = C.cpOn;
  ctx.shadowBlur = 16;
  ctx.font = "bold 36px Consolas, monospace";
  ctx.fillText("LEVEL COMPLETE!", VIEW_W / 2, y + 64);
  ctx.shadowBlur = 0;
  ctx.fillStyle = C.text;
  ctx.font = "20px Consolas, monospace";
  ctx.fillText(`Coins  ${game.coinsGot} / ${game.coinsTotal}`, VIEW_W / 2, y + 115);
  ctx.fillText(`Deaths  ${game.deaths}`, VIEW_W / 2, y + 145);
  ctx.fillText(`Time  ${fmtTime(game.runTime)}`, VIEW_W / 2, y + 175);
  if (game.newRecord) {
    blinkText("★ NEW RECORD! ★", VIEW_W / 2, y + 207, "bold 22px Consolas, monospace", C.coin);
  } else if (game.best) {
    ctx.fillStyle = "rgba(207,232,255,0.6)";
    ctx.font = "16px Consolas, monospace";
    ctx.fillText(`Best  ${fmtTime(game.best.time)}`, VIEW_W / 2, y + 205);
  }
  const last = game.levelIndex + 1 >= LEVELS.length;
  blinkText(last ? "ENTER — FINISH" : "ENTER — NEXT LEVEL", VIEW_W / 2, y + 270, "bold 20px Consolas, monospace");
}

function drawWin() {
  const { y } = drawPanel(520, 280);
  ctx.textAlign = "center";
  ctx.fillStyle = C.coin;
  ctx.shadowColor = C.coin;
  ctx.shadowBlur = 18;
  ctx.font = "bold 44px Consolas, monospace";
  ctx.fillText("YOU WIN!", VIEW_W / 2, y + 80);
  ctx.shadowBlur = 0;
  ctx.fillStyle = C.text;
  ctx.font = "20px Consolas, monospace";
  ctx.fillText(`Total coins  ${game.totals.coins} / ${game.totals.coinsTotal}`, VIEW_W / 2, y + 135);
  ctx.fillText(`Total deaths  ${game.totals.deaths}`, VIEW_W / 2, y + 165);
  blinkText("ENTER — TITLE SCREEN", VIEW_W / 2, y + 230, "bold 20px Consolas, monospace");
}

// ----- Main loop -----
let lastTime = performance.now();

function frame(now) {
  const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.033)); // clamp: no tunneling on lag
  lastTime = now;
  game.time += dt;

  if (game.state === "playing") {
    game.runTime += dt;
    updatePlayer(dt);
    updateCamera(dt);
    // record this run for the ghost, at fixed rate
    game.recAcc += dt;
    while (game.recAcc >= 1 / GHOST_HZ && game.rec.length < GHOST_MAX) {
      game.rec.push([Math.round(game.player.x), Math.round(game.player.y), game.player.facing]);
      game.recAcc -= 1 / GHOST_HZ;
    }
  }
  updateParticles(dt);
  game.damageFlash = Math.max(0, game.damageFlash - dt);

  uiButtons = [];
  uiSliders = [];
  uiHover = false;
  drawBackground();
  if (game.state !== "title" && game.state !== "binds" && game.state !== "options") {
    drawWorld();
    drawHUD();
  }
  if (game.damageFlash > 0 && settings.vfx > 0.01) {
    ctx.fillStyle = `rgba(255,40,80,${game.damageFlash * 0.6 * settings.vfx})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (game.state === "title") drawTitle();
  else if (game.state === "binds") drawBinds();
  else if (game.state === "options") drawOptions();
  else if (game.state === "complete") drawComplete();
  else if (game.state === "win") drawWin();
  canvas.style.cursor = uiHover ? "pointer" : "default";

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
