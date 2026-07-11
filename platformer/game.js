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
const JUMP_CUT = 0.45;      // velocity kept when jump key released early
const COYOTE_TIME = 0.09;   // seconds you can still jump after leaving a ledge
const BUFFER_TIME = 0.11;   // seconds a jump press is remembered before landing
const PLAYER_W = 22, PLAYER_H = 30;

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
    if (!this.ctx || this.muted) return;
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

// ----- Input -----
const keys = new Set();
const JUMP_KEYS = ["ArrowUp", "KeyW", "Space"];

window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  audio.init();
  if (keys.has(e.code)) return; // ignore key repeat
  keys.add(e.code);
  onKeyPressed(e.code);
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (JUMP_KEYS.includes(e.code) && game.player && game.player.vy < 0) {
    game.player.vy *= JUMP_CUT; // jump cut: release early = shorter hop
  }
});
window.addEventListener("blur", () => keys.clear());

function onKeyPressed(code) {
  if (code === "KeyM") { audio.muted = !audio.muted; return; }

  if (game.state === "playing") {
    if (JUMP_KEYS.includes(code)) game.player.buffer = BUFFER_TIME;
    if (code === "KeyR") loadLevel(game.levelIndex);
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
};
window.game = game; // handy for console debugging

function newPlayer(x, y) {
  return {
    x, y, vx: 0, vy: 0,
    onGround: false, facing: 1,
    coyote: 0, buffer: 0, iframes: 0,
    sy: 1, // squash/stretch scale
  };
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
  game.cam.x = clamp(game.player.x - VIEW_W * 0.4, 0, Math.max(0, game.gw * TILE - VIEW_W));
  game.cam.y = clamp(game.player.y - VIEW_H * 0.5, 0, Math.max(0, game.gh * TILE - VIEW_H));
}

function solid(c, r) {
  if (c < 0 || c >= game.gw) return true; // level edges are walls
  if (r < 0 || r >= game.gh) return false;
  return game.grid[r][c] === 1;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ----- Physics -----
function updatePlayer(dt) {
  const p = game.player;
  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");
  const dir = (right ? 1 : 0) - (left ? 1 : 0);

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

  // timers
  p.coyote = p.onGround ? COYOTE_TIME : p.coyote - dt;
  p.buffer -= dt;
  p.iframes -= dt;

  // jump (with coyote time + input buffer)
  if (p.buffer > 0 && p.coyote > 0) {
    p.vy = -JUMP_VEL;
    p.buffer = 0;
    p.coyote = 0;
    p.onGround = false;
    p.sy = 1.35; // stretch
    audio.jump();
    dust(p.x + PLAYER_W / 2, p.y + PLAYER_H, 5);
  }

  // gravity — heavier on the way down for a snappy arc
  const g = GRAV * (p.vy > 0 ? FALL_MULT : 1);
  p.vy = Math.min(p.vy + g * dt, MAX_FALL);

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
    game.state = "complete";
    audio.win();
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

function drawPlayer() {
  const p = game.player;
  if (!p) return;
  // flash while invincible
  if (p.iframes > 0 && Math.floor(game.time * 16) % 2 === 0) return;

  const cx = p.x + PLAYER_W / 2;
  const bottom = p.y + PLAYER_H;
  const sy = p.sy;
  const sx = 2 - sy; // squash one axis, stretch the other

  ctx.save();
  ctx.translate(cx, bottom);
  ctx.scale(sx, sy);
  ctx.shadowColor = C.player;
  ctx.shadowBlur = 12;
  ctx.fillStyle = C.player;
  roundRect(-PLAYER_W / 2, -PLAYER_H, PLAYER_W, PLAYER_H, 6);
  ctx.fill();
  ctx.shadowBlur = 0;
  // eye
  ctx.fillStyle = "#0a1a0a";
  const ex = p.facing * 4;
  ctx.beginPath();
  ctx.arc(ex, -PLAYER_H + 10, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(ex + p.facing, -PLAYER_H + 9, 1.2, 0, Math.PI * 2);
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
  // level name
  ctx.fillStyle = "rgba(207,232,255,0.55)";
  ctx.font = "14px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(LEVELS[game.levelIndex].name, VIEW_W / 2, 26);
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

function blinkText(text, x, y, font) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(game.time * 4);
  ctx.fillStyle = C.text;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
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
    "MOVE   arrows / A D",
    "JUMP   up / W / space  (hold = higher)",
    "R restart level      M mute",
  ];
  lines.forEach((t, i) => ctx.fillText(t, VIEW_W / 2, 300 + i * 28));

  blinkText("PRESS ENTER TO START", VIEW_W / 2, 430, "bold 22px Consolas, monospace");
}

function drawComplete() {
  const { y } = drawPanel(480, 260);
  ctx.textAlign = "center";
  ctx.fillStyle = C.cpOn;
  ctx.shadowColor = C.cpOn;
  ctx.shadowBlur = 16;
  ctx.font = "bold 36px Consolas, monospace";
  ctx.fillText("LEVEL COMPLETE!", VIEW_W / 2, y + 70);
  ctx.shadowBlur = 0;
  ctx.fillStyle = C.text;
  ctx.font = "20px Consolas, monospace";
  ctx.fillText(`Coins  ${game.coinsGot} / ${game.coinsTotal}`, VIEW_W / 2, y + 125);
  ctx.fillText(`Deaths  ${game.deaths}`, VIEW_W / 2, y + 155);
  const last = game.levelIndex + 1 >= LEVELS.length;
  blinkText(last ? "ENTER — FINISH" : "ENTER — NEXT LEVEL", VIEW_W / 2, y + 215, "bold 20px Consolas, monospace");
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
  const dt = Math.min((now - lastTime) / 1000, 0.033); // clamp: no tunneling on lag
  lastTime = now;
  game.time += dt;

  if (game.state === "playing") {
    updatePlayer(dt);
    updateCamera(dt);
  }
  updateParticles(dt);
  game.damageFlash = Math.max(0, game.damageFlash - dt);

  drawBackground();
  if (game.state !== "title") {
    drawWorld();
    drawHUD();
  }
  if (game.damageFlash > 0) {
    ctx.fillStyle = `rgba(255,40,80,${game.damageFlash * 0.6})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (game.state === "title") drawTitle();
  else if (game.state === "complete") drawComplete();
  else if (game.state === "win") drawWin();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
