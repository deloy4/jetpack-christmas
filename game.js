// Jetpack Christmas Special, rebuilt for the browser. The rules come from reading the original
// program (../analysis/santa-movement.md, monsters.md, mechanisms.md); the art is new (art.js).
// Positions and speeds use the original's units: 1/32 pixel, so a 12-pixel tile is 384.

const COLS = 28, ROWS = 18, U = 384;
const PLAY_W = 312, PLAY_H = 192, HUD_H = 16;

// The original paces itself with a delay that depends on the machine. Measured in DOSBox on
// level 1, it runs at about 31.6 frames a second at the default speed of 5; each speed step
// changes the frame by 45 / (2 + 6) ms there.
const frameMs = (speed) => 31.25 + (5 - speed) * 5.625;

// ---------- Borland C rand(), which every random choice in the original goes through ----------

let seed = 1;
function srand(s) { seed = s & 0xffff; }
function rand() {
  seed = (Math.imul(seed, 0x015a4e35) + 1) >>> 0;
  return (seed >>> 16) & 0x7fff;
}

// ---------- state ----------

const G = {
  screen: 'title', level: 0, score: 0, lives: 3, speed: 5, skips: 0, newLife: 0,
  grid: null, door: null, start: null, monsters: [], pads: [[], [], []], digs: [], pickups: [],
  gifts: 0, giftsTotal: 0, doorCount: 0, doorOpen: false, shield: 0, stun: 0, request: 0,
  info: 0, t: 0, timer: 0, names: [],
};
let S = null; // Santa

function cellIndex(c, r) { return r * COLS + c; }

// Tile under a pixel in grid space, with dug bricks and switched-off barriers (bit 0x80) read as 0.
function tileAt(px, py) {
  const c = Math.floor(px / 12), r = Math.floor(py / 12);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return 60;
  const v = G.grid[cellIndex(c, r)];
  return v & 0x80 ? 0 : v;
}
function rawAt(px, py) {
  const c = Math.floor(px / 12), r = Math.floor(py / 12);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return 60;
  return G.grid[cellIndex(c, r)];
}
const solid = (t) => t >= 40;
const ladder = (t) => t >= 1 && t <= 3;
const solidOrLadder = (t) => t >= 40 || ladder(t);
const sign = (v) => (v > 0) - (v < 0);
const toward0 = (v, d) => (Math.abs(v) <= d ? 0 : v - d * sign(v));

// ---------- level setup (048f:2820, 0856:0bc0, 0c7b:0007) ----------

function loadLevel() {
  const L = LEVELS[G.level];
  G.grid = new Uint8Array(COLS * ROWS).fill(60);
  for (let r = 0; r < 16; r++) for (let c = 0; c < 26; c++) G.grid[cellIndex(c + 1, r + 1)] = L.tiles[r * 26 + c];
  // a colour starts open if any of its buttons is placed in the "off" picture
  for (let k = 0; k < 3; k++) {
    if (!G.grid.some((v) => v === 10 + 2 * k)) continue;
    G.grid.forEach((v, i) => {
      if (v === 74 + 2 * k || v === 75 + 2 * k) G.grid[i] = v | 0x80;
      if (v === 9 + 2 * k) G.grid[i] = 10 + 2 * k;
    });
  }
  let [dc, dr] = L.door;
  if (dc < 1 || dc > 25) dc = 1;
  if (dr < 1 || dr > 15) dr = 1;
  G.door = [dc, dr];
  let [sc, sr] = L.start;
  if (sc < 1 || sc > 26 || sr < 1 || sr > 16) { sc = 1; sr = 1; }
  G.start = [sc, sr];
  const FIRST = { 1: 4, 2: 0, 3: 13, 4: 21, 5: 16, 6: 33, 7: 19, 8: 42 };
  G.monsters = L.monsters.slice(0, 20).map(([type, c, r]) => ({
    type, frame: FIRST[type] ?? 0, x: c * U, y: r * U, vx: 0, vy: 0, st: 0, fl: 0x11, stuck: 0, px: c * U, py: r * U,
  }));
  G.pads = [[], [], []];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const v = G.grid[cellIndex(c, r)];
    if (v >= 6 && v <= 8) G.pads[v - 6].push([c, r]);
  }
  G.giftsTotal = G.grid.filter((v) => v === 4).length;
  G.gifts = 0;
  G.doorCount = G.giftsTotal === 0 ? 1 : 0;
  G.doorOpen = false;
  G.digs = []; G.pickups = []; G.shield = 0; G.stun = 0; G.request = 0;
  S = {
    x: sc * U, y: sr * U, vx: 0, vy: 0, lastvx: 0, fuel: 0, mode: 0, jetCount: 0, phaseCount: 0,
    dying: 0, teleport: 0, tpDest: null, frame: 0, pxPrev: sc * U, pyPrev: sr * U,
    buttonLatch: false, switchLatch: false, padLatch: false, wallLatch: false, jet: false, shifter: false,
  };
  G.staticDirty = true;
}

// ---------- input ----------

const held = new Set();
const pressed = [];
const KEYS = {
  left: ['ArrowLeft', 'KeyJ', 'Numpad4'], right: ['ArrowRight', 'KeyL', 'Numpad6'],
  up: ['ArrowUp', 'KeyI', 'Numpad8'], down: ['ArrowDown', 'KeyK', 'Numpad2'],
  jet: ['AltLeft', 'AltRight', 'KeyZ', 'Insert', 'Numpad0', 'v-jet'],
  shifter: ['ControlLeft', 'ControlRight', 'Enter', 'KeyX', 'Delete', 'NumpadDecimal', 'v-phase'],
};
const isHeld = (name) => KEYS[name].some((k) => held.has(k));

// ---------- one frame of play, in the original's order (santa-movement.md "The frame, in order") ----------

let step = function () {
  let points = 0;
  const L = LEVELS[G.level];

  // 1. one-shot keys
  while (pressed.length) {
    const k = pressed.shift();
    if (k === 'Escape' && !S.dying) S.dying = 1;
    if (k === 'Minus' || k === 'NumpadSubtract') { G.speed = Math.max(0, G.speed - 1); G.info = 150; }
    if (k === 'Equal' || k === 'NumpadAdd') { G.speed = Math.min(9, G.speed + 1); G.info = 150; }
    if (k === 'Space') G.info = G.info ? 0 : 150;
    if (k === 'KeyQ') return endLife('quit');
    if (held.has('Tab') && held.has('Digit2')) {
      if (['KeyS', 'KeyL', 'KeyF', 'KeyI'].includes(k)) G.cheated = true;
      if (k === 'KeyS') return endLife('skip');
      if (k === 'KeyL') { G.lives = Math.min(100, G.lives + 1); sfx('life'); }
      if (k === 'KeyF') { S.fuel = 10000; sfx('fuel'); }
      if (k === 'KeyI') { G.shield = 60000; sfx('shield'); }
    }
    if (((k === 'Quote' && held.has('Backspace')) || (k === 'Backspace' && held.has('Quote'))) && G.skips < 2) {
      G.skips++;
      return endLife('skip');
    }
  }

  // 2. held controls; all forced off while dying
  let dx = 0, dy = 0, jet = false, shifter = false;
  if (!S.dying) {
    if (isHeld('left')) dx = -1;
    if (isHeld('right')) dx = 1;
    if (isHeld('up')) dy = -1;
    if (isHeld('down')) dy = 1;
    jet = isHeld('jet');
    shifter = isHeld('shifter');
  }
  S.jet = jet; S.shifter = shifter; S.digging = false;

  // 3. last non-zero vx
  if (S.vx !== 0) S.lastvx = S.vx;

  // 4. tile samples from the start-of-frame position
  let px = S.x >> 5, py = S.y >> 5;
  const aboveL = tileAt(px + 2, py - 1), aboveR = tileAt(px + 9, py - 1);
  const rightTop = tileAt(px + 11, py), rightBot = tileAt(px + 11, py + 11);
  const belowR = tileAt(px + 9, py + 12), belowC = tileAt(px + 6, py + 12), belowL = tileAt(px + 2, py + 12);
  const leftBot = tileAt(px, py + 11), leftTop = tileAt(px, py);
  const ladderTop = tileAt(px + 6, py + 10);
  const centre = tileAt(px + 6, py + 6);
  const cc = Math.floor((px + 6) / 12), cr = Math.floor((py + 6) / 12), ci = cellIndex(cc, cr);
  const standingOn = solid(belowR) || solid(belowL);

  // 5. centre-tile pickups (jump table at 0c7b:6430)
  S.pad = null;
  switch (centre) {
    case 4:
      points += 5; G.gifts++; G.grid[ci] = 5; sfx('gift');
      if (G.gifts === G.giftsTotal) G.doorCount = 1;
      break;
    case 15: case 16:
      if (S.fuel === 0) S.vy = 0;
      S.fuel = Math.min(10000, S.fuel + (centre === 15 ? 10000 : 5000));
      points += centre === 15 ? 20 : 10; G.grid[ci] = 0; sfx('fuel');
      break;
    case 17:
      if (S.fuel < 10000) { S.pad = 'charge'; S.fuel = Math.min(10000, S.fuel + 30); if (S.fuel === 10000) sfx('full'); }
      break;
    case 18: if (S.fuel > 0) S.pad = 'drain'; S.fuel = Math.max(0, S.fuel - 20); break;
    case 19: points += 25; G.stun = Math.min(60000, G.stun + 400); G.grid[ci] = 0; sfx('stunner'); break;
    case 20: points += 10; G.grid[ci] = 0; sfx('coin'); break;
    case 21: points += 25; G.grid[ci] = 0; sfx('coin'); break;
    case 22: points += 50; G.grid[ci] = 0; sfx('coin'); break;
    case 23: points += 100; G.newLife++; G.grid[ci] = 0; sfx('life'); break;
    case 24:
      if (standingOn) {
        if (!G.shield && !S.dying) S.dying = 1;
        G.grid[ci] = 38; sfx('trap');
      }
      break;
  }
  if (centre === 4 || (centre >= 15 && centre <= 24 && centre !== 17 && centre !== 18)) G.staticDirty = true;

  // 6. movement mode and velocity
  const anyLadder = (v) => centre === v || belowR === v || belowL === v;
  if (jet && S.fuel > 0 && S.mode !== 2) {
    // jetpack (1de3)
    S.mode = 0; S.jetCount++;
    S.fuel = Math.max(0, S.fuel - 10);
    const hold = dy > 0 || (dy === 0 && dx !== 0 && shifter);
    if (hold) S.vy = toward0(S.vy, 6); else S.vy -= 4;
    S.vy = Math.max(S.vy, -64);
    if (dx) S.vx += 6 * dx; else S.vx = toward0(S.vx, 3);
    S.vx = Math.max(-64, Math.min(64, S.vx));
    const k = (S.jetCount >> 1) % 3;
    S.frame = dx > 0 ? 7 + k : dx < 0 ? 31 + k : (S.frame < 24 ? 4 : 28) + k;
  } else if (!(S.mode >= 2 && jet) && (ladder(centre) || (ladder(belowC) && (ladder(belowR) || ladder(belowL))))) {
    // ladder (1f53)
    if (S.mode === 0) S.mode = 1;
    if (S.mode >= 2 && !jet) S.mode = 1;
    if (anyLadder(2)) S.vy = dy < 0 ? -64 : dy > 0 ? 20 : -25;
    else if (anyLadder(3)) S.vy = dy > 0 ? 64 : dy < 0 ? -20 : 25;
    else S.vy = 45 * dy;
    if (S.vy < 0 && !ladder(centre) && !ladder(tileAt(px + 2, py + 11)) && !ladder(tileAt(px + 9, py + 11))) S.vy = 0;
    if (S.vy < -32 && !ladder(ladderTop)) S.vy = -32;
    S.vx = 55 * dx;
    if (jet && S.fuel === 0 && S.mode < 3) { S.vy = -68; S.mode = 2; }
    if (S.vy === 0 && ((dx > 0 && (solid(rightTop) || solid(rightBot))) || (dx < 0 && (solid(leftTop) || solid(leftBot))))) {
      const r = py % 12;
      if (r >= 6) S.vy = 32; else if (r >= 1) S.vy = -32;
    }
    if ((S.vx > 0 && (solid(rightTop) || solid(rightBot))) || (S.vx < 0 && (solid(leftTop) || solid(leftBot)))) S.vx = 0;
    if (dx === 0 && S.vy !== 0) {
      const r = px % 12;
      if (r >= 6 && ladder(rightBot)) S.vx = 32;
      else if (r >= 1 && ladder(leftBot)) S.vx = -32;
      else S.vx = 0;
    }
    if (S.vx !== 0) S.frame = ((px >> 1) % 4) + (S.vx < 0 ? 24 : 0);
    else if (dy !== 0 && S.vy !== 0) S.frame = 48 + (Math.floor(S.y / 200) % 4);
    else if (!(S.frame >= 48 && S.frame <= 51) && !standFrame(S.frame)) S.frame = S.frame >= 24 ? 24 : 0;
  } else if (standingOn) {
    // standing (2243)
    if (S.mode === 0) S.mode = 1;
    if (S.mode >= 2 && !jet) S.mode = 1;
    S.vy = 0;
    S.vx = 55 * dx;
    if (jet && S.fuel === 0 && S.mode < 3) { S.vy = -68; S.mode = 2; sfx('jump'); }
    if (S.vx !== 0) S.frame = ((px >> 1) % 4) + (S.vx < 0 ? 24 : 0);
    else if (!standFrame(S.frame)) S.frame = S.frame >= 24 ? 24 : 0;
  } else {
    // in the air (22fb)
    if (S.mode === 1) { S.mode = 0; S.vx = 0; S.vy = 64; }
    else if (S.mode === 2) { if (dx) { S.mode = 3; S.vx = 64 * dx; } else S.mode = 4; }
    else if ((S.mode === 3 || S.mode === 4) && jet) S.vy += 5;
    else S.vy += 6;
    S.vy = Math.min(S.vy, 64);
    if (S.mode === 3 && Math.abs(S.vx) > 6 && dx !== 0 && dx !== sign(S.vx)) S.vx = -S.vx;
    else if (dx !== 0 && Math.abs(S.vx) <= 20) S.vx = Math.max(-20, Math.min(20, S.vx + 5 * dx));
    else S.vx = toward0(S.vx, S.mode === 3 ? 2 : 3);
    if (S.mode === 3) {
      const left = S.vx < 0;
      S.frame = (Math.abs(S.vx) <= 20 ? 17 : 16) + (left ? 24 : 0);
    } else if (S.mode === 4) S.frame = 61;
    else {
      const left = dx ? dx < 0 : S.frame >= 24 && S.frame < 48 ? true : S.frame < 24 ? false : S.lastvx < 0;
      S.frame = left ? 24 : 0;
    }
  }

  // 7. an empty tank turns the jet off for the rest of the frame
  if (S.fuel === 0) jet = false;

  // 8. floor effects, only when standing
  if (S.mode === 1) {
    const feet = (a, b) => (belowL >= a && belowL <= b) || (belowR >= a && belowR <= b);
    if (feet(94, 96)) {
      const d = dx || sign(S.lastvx) || (S.frame >= 24 && S.frame < 48 ? -1 : 1);
      S.vx = 55 * d; S.frame = d < 0 ? 24 : 0;
    }
    if (feet(97, 99)) S.vx = Math.trunc(S.vx * 0.6);
    if (feet(114, 116)) { S.vx = dx < 0 ? -60 : dx > 0 ? 25 : -40; S.frame = (Math.floor(S.x / 200) % 4) + (S.vx < 0 ? 24 : 0); }
    if (feet(117, 119)) { S.vx = dx > 0 ? 60 : dx < 0 ? -25 : 40; S.frame = (Math.floor(S.x / 200) % 4) + (S.vx < 0 ? 24 : 0); }
  }

  // 9. floor switches, teleporters, buttons
  if (centre >= 33 && centre <= 35) {
    if (!S.switchLatch) { G.request = centre - 32; S.switchLatch = true; }
  } else S.switchLatch = false;
  if (dy > 0 && !shifter && !jet && centre >= 6 && centre <= 8 && !S.teleport) {
    if (!S.padLatch) { S.teleport = (centre - 6) * 1000 + 1; S.padLatch = true; }
  } else if (!(centre >= 6 && centre <= 8) || dy <= 0) S.padLatch = false;
  if (dy > 0 && !jet && centre >= 9 && centre <= 14) {
    if (!S.buttonLatch) { G.request = ((centre - 9) >> 1) + 1; S.buttonLatch = true; }
  } else S.buttonLatch = false;

  // 10. pop-up Shield, Stunner and fuel
  if (Math.floor((rand() * 5000) / 32768) === 0 && G.pickups.length < 9) {
    for (let tries = 0; tries < 10; tries++) {
      const c = rand() % 26, r = rand() % 16;
      const underDoor = (c === G.door[0] - 1 || c === G.door[0]) && (r === G.door[1] - 1 || r === G.door[1]);
      if (G.grid[cellIndex(c + 1, r + 1)] < 40 && !underDoor) {
        G.pickups.push({ kind: rand() % 3, timer: 400, c, r });
        sfx('popup');
        break;
      }
    }
  }
  const sc = Math.floor(((S.x >> 5) + 6) / 12) - 1, sr = Math.floor(((S.y >> 5) + 6) / 12) - 1;
  for (let i = 0; i < G.pickups.length; i++) {
    const p = G.pickups[i];
    if (p.c === sc && p.r === sr) {
      p.timer = 0;
      if (p.kind === 0) { G.shield = Math.min(60000, G.shield + 400); points += 25; sfx('shield'); }
      if (p.kind === 1) { G.stun = Math.min(60000, G.stun + 400); points += 25; sfx('stunner'); }
      if (p.kind === 2) { S.fuel = Math.min(10000, S.fuel + 5000); points += 10; sfx('fuel'); }
    } else p.timer--;
    if (p.timer <= 0) G.pickups.splice(i, 1);
  }

  // 11. timers
  if (G.stun > 0) G.stun--;
  if (G.shield > 0) G.shield--;

  // 12. spikes, and being inside a wall
  if (centre >= 36 && centre <= 39 && !S.dying && !G.shield && !S.teleport) S.dying = 1;
  if (solid(centre) && !S.teleport) {
    S.vx = 0; S.vy = 0;
    if (G.shield) { if (!S.wallLatch) { S.wallLatch = true; sfx('stuck'); } }
    else if (!S.dying) S.dying = 1;
  } else S.wallLatch = false;

  // 13. walls, floors and ceilings
  let f = 0;
  if (S.vx < 0) {
    if (solid(leftBot) && !solid(tileAt(px, py - 1)) && solid(tileAt(px, py - 2))) { S.y -= 32; S.x -= 32; S.vy = 0; f = 1; }
    else if (solid(leftTop) && !solid(tileAt(px, py + 12)) && solid(tileAt(px, py + 13))) { S.y += 32; S.x -= 32; S.vy = 0; f = 1; }
    else if (solid(leftTop) || solid(leftBot)) S.vx = 0;
  } else if (S.vx > 0) {
    if (solid(rightBot) && !solid(tileAt(px + 11, py - 1)) && solid(tileAt(px + 11, py - 2))) { S.y -= 32; S.x += 32; S.vy = 16; f = 1; }
    else if (solid(rightTop) && !solid(tileAt(px + 11, py + 12)) && solid(tileAt(px + 11, py + 13))) { S.y += 32; S.x += 32; S.vy = 0; f = 1; }
    else if (solid(rightTop) || solid(rightBot)) S.vx = 0;
  }
  px = S.x >> 5; py = S.y >> 5;
  if (S.vy < 0) {
    // the original compares |vx| > vy here, which is always true while vy is negative
    if (!f && solid(aboveR) && !solid(tileAt(px + 8, py - 1))) { S.x -= 32; S.vx = 0; }
    else if (!f && solid(aboveL) && !solid(tileAt(px + 3, py - 1))) { S.x += 32; S.vx = 0; }
    else if (solid(aboveL) || solid(aboveR)) S.vy = 0;
  } else if (S.vy > 0) {
    if (!f && Math.abs(S.vx) < S.vy && solid(belowR) && !solid(tileAt(px + 8, py + 12))) { S.x -= 32; S.vx = 0; }
    else if (!f && Math.abs(S.vx) < S.vy && solid(belowL) && !solid(tileAt(px + 3, py + 12))) { S.x += 32; S.vx = 0; }
    else if (solid(belowL) || solid(belowR)) S.vy = 0;
  }
  px = S.x >> 5; py = S.y >> 5;
  if (S.vy > 32 && (solid(tileAt(px + 2, py + 13)) || solid(tileAt(px + 9, py + 13)))) S.vy = 32;
  if (S.vy > 32 && ((ladder(tileAt(px + 2, py + 13)) && !ladder(belowL)) || (ladder(tileAt(px + 9, py + 13)) && !ladder(belowR)))) S.vy = 32;
  if (S.vy < -32 && (solid(tileAt(px + 2, py - 2)) || solid(tileAt(px + 9, py - 2)))) S.vy = -32;

  // 14. Phase Shifter, then every brick being dug
  let digCell = -1;
  if (shifter && G.digs.length < 20) {
    const faceLeft = S.frame >= 24 && S.frame <= 47, faceRight = S.frame < 24;
    let dir = 0;
    if (dx < 0 || (!dx && !dy && !jet && faceLeft) || (jet && dy > 0 && faceLeft)) dir = 1;
    else if (dx > 0 || (!dx && !dy && !jet && faceRight) || (jet && dy > 0 && faceRight)) dir = 2;
    else if (dy < 0 || (jet && !dx)) dir = 3;
    else if (dy > 0 && !jet) dir = 4;
    if (dir) {
      S.phaseCount++;
      const k = (S.phaseCount >> 1) % 3, j = jet ? 3 : 0;
      S.frame = [0, 34 + j, 10 + j, 52 + j, 58][dir] + k;
      const [tx, ty] = [null, [px - 1, py + 6], [px + 12, py + 6], [px + 6, py - 1], [px + 6, py + 12]][dir];
      if ((dir >= 3) && !dx) { const r = px % 12; S.vx = r >= 6 ? 32 : r >= 1 ? -32 : 0; }
      if (dir <= 2 && !dy && ((jet && S.fuel > 0) || ladder(centre))) { const r = py % 12; S.vy = r >= 6 ? 32 : r >= 1 ? -32 : 0; }
      const tc = Math.floor(tx / 12), tr = Math.floor(ty / 12);
      if (tc >= 0 && tr >= 0 && tc < COLS && tr < ROWS) {
        const cell = cellIndex(tc, tr), T0 = G.grid[cell];
        const type = digType(T0, dir);
        let d = G.digs.find((e) => e.cell === cell);
        if (!d && type >= 0) { d = { cell, counter: type >= 2 ? 1 : 0, type, tile: T0 }; G.digs.push(d); sfx('phase'); }
        if (d) { digCell = cell; S.digging = true; if (d.type < 2 && d.counter < DIG[d.type].hold) d.counter++; }
      }
    }
  }
  advanceDigs(digCell);

  // 15. monsters: touch test, then each one's own update
  for (const m of G.monsters) {
    if (!G.stun && !G.shield && !S.dying && !S.teleport && Math.abs(S.y - m.y) < 192 && Math.abs(S.x - m.x) < 192) S.dying = 1;
    updateMonster(m);
  }

  // 16. barrier toggle
  if (G.request > 0) toggleBarriers(G.request - 1);
  G.request = 0;

  // 17. death, door and teleport animations
  if (S.dying === 1) { S.dying = (rand() % 4) * 100 + 2; sfx('die'); }
  else if (S.dying > 1 && S.dying < 1000) {
    S.dying++;
    const p = S.dying % 100, T4 = Math.floor(S.dying / 100);
    S.frame = p < 36 ? 72 + 6 * T4 + Math.floor(p / 6) : T4 === 0 ? 71 : 77 + 6 * T4;
    if (p >= 70) { S.dying = 1000; S.frame = 71; }
  }
  if (G.doorCount > 0) {
    if (G.doorCount === 1) sfx('door');
    G.doorCount++;
    if (G.doorCount >= 40) { G.doorCount = 0; G.doorOpen = true; }
  }
  if (S.teleport) {
    const e = S.teleport % 1000, pad = Math.floor(S.teleport / 1000);
    if (e === 1) {
      sfx('teleport');
      const list = G.pads[pad];
      const myC = Math.floor(((S.x + 192) >> 5) / 12), myR = Math.floor(((S.y + 192) >> 5) / 12);
      for (let tries = 0; tries < 10 && list.length; tries++) {
        S.tpDest = list[rand() % list.length];
        if (S.tpDest[0] !== myC || S.tpDest[1] !== myR) break;
      }
    }
    if (e === 20 && S.tpDest) { S.x = S.tpDest[0] * U; S.y = S.tpDest[1] * U; S.vx = 0; S.vy = 0; S.pxPrev = S.x; S.pyPrev = S.y; }
    S.teleport++;
    if (S.teleport % 1000 >= 40) S.teleport = 0;
  }

  // 18. move: monsters first, then Santa
  for (const m of G.monsters) { m.px = m.x; m.py = m.y; m.x += m.vx; m.y += m.vy; }
  S.pxPrev = S.x; S.pyPrev = S.y;
  S.x += S.vx; S.y += S.vy;

  // score and lives (56e1): one extra life each time the thousands figure changes
  if (points) {
    const before = Math.floor(G.score / 1000);
    G.score += points;
    if (Math.floor(G.score / 1000) !== before) { G.newLife++; sfx('life'); }
  }
  if (G.newLife) { G.lives = Math.min(100, G.lives + 1); G.newLife = 0; }
  if (G.info > 0) G.info--;

  // 20. end checks
  if (S.dying >= 1000) return endLife('died');
  if (G.gifts === G.giftsTotal && G.doorCount === 0 &&
      Math.abs(((S.x + 180) >> 5) - (G.door[0] * 12 + 12)) < 6 && Math.abs(((S.y + 180) >> 5) - (G.door[1] * 12 + 18)) < 2) {
    return endLife('door');
  }
}
;
function standFrame(f) { return (f >= 0 && f <= 3) || (f >= 24 && f <= 27); }

// What the Phase Shifter can dig (35c7), and how long each kind takes (santa-movement.md).
const DIG = [
  { hold: 20, open: 25, regrow: [110, 120, 130, 140], back: 150 },
  { hold: 50, open: 55, regrow: [260, 270, 280, 290], back: 300 },
  { hold: 0, open: 5, regrow: null, back: 0 },
  { hold: 0, open: 5, regrow: [20, 25, 30, 35], back: 40 },
];
const DENSE = new Set([95, 98, 115, 118, 119]);
// for tiles 80-119, d = (t - 80) % 20: which directions (1 left, 2 right, 3 up, 4 down) are refused
const EDGE_REFUSE = { 0: [3, 4], 1: [1, 2], 2: [4], 3: [1], 4: [3], 5: [2], 6: [1, 4], 7: [1, 3], 8: [2, 3], 9: [2, 4],
  10: [1, 2, 4], 11: [1, 3, 4], 12: [1, 2, 3], 13: [2, 3, 4], 16: [1, 2, 3, 4], 19: [1, 2, 3, 4] };

function digType(t, dir) {
  if (t & 0x80) return -1;
  if (t >= 40 && t <= 49) return 0;
  if (t >= 50 && t <= 59) return 1;
  if (t === 70) return 2;
  if (t === 71) return 3;
  if (t >= 80 && t <= 119) {
    if ((EDGE_REFUSE[(t - 80) % 20] || []).includes(dir)) return -1;
    return (t >= 100 && t <= 113) || DENSE.has(t) ? 1 : 0;
  }
  return -1;
}

function advanceDigs(current) {
  for (let i = G.digs.length - 1; i >= 0; i--) {
    const d = G.digs[i], D = DIG[d.type];
    if (d.type < 2 && d.counter < D.hold) {
      // let go too early and the brick starts again from nothing
      if (d.cell !== current) G.digs.splice(i, 1);
      continue;
    }
    if (d.type >= 2 || d.counter >= D.hold) d.counter++;
    if (d.counter === D.open) {
      if (d.type === 2) { G.grid[d.cell] = 0; G.digs.splice(i, 1); }
      else G.grid[d.cell] |= 0x80;
      G.staticDirty = true;
      continue;
    }
    if (D.regrow && d.counter === D.back) {
      G.grid[d.cell] &= 0x7f;
      G.digs.splice(i, 1);
      G.staticDirty = true;
    }
  }
}

// How a brick being dug looks this frame, for the renderer.
function digStage(d) {
  const D = DIG[d.type];
  if (d.type < 2 && d.counter < D.hold) return { kind: 'hold', k: d.counter / D.hold };
  const start = d.type < 2 ? D.hold : 0;
  if (d.counter < D.open) return { kind: 'crumble', k: (d.counter - start) / (D.open - start) };
  if (D.regrow && d.counter >= D.regrow[0]) return { kind: 'regrow', k: (d.counter - D.regrow[0]) / (D.back - D.regrow[0]) };
  return null;
}

function toggleBarriers(c) {
  if (c < 0 || c > 2) return;
  const isBarrier = (v) => (v & 0x7f) === 74 + 2 * c || (v & 0x7f) === 75 + 2 * c;
  let on = false;
  // scan columns outer, rows inner, and let the first barrier found decide
  scan: for (let col = 1; col <= 26; col++) for (let row = 1; row <= 16; row++) {
    const v = G.grid[cellIndex(col, row)];
    if (isBarrier(v)) { on = !(v & 0x80); break scan; }
  }
  G.grid.forEach((v, i) => {
    if (on) {
      if ((v & 0x7f) === 9 + 2 * c) G.grid[i] = 10 + 2 * c;
      if (isBarrier(v)) G.grid[i] = v | 0x80;
    } else {
      if ((v & 0x7f) === 10 + 2 * c) G.grid[i] = 9 + 2 * c;
      if (isBarrier(v)) G.grid[i] = v & 0x7f;
    }
  });
  sfx(on ? 'barrierOff' : 'barrierOn');
  G.staticDirty = true;
}

// ---------- monsters (monsters.md) ----------

function sense(m, dx, dy) { return tileAt((m.x >> 5) + dx, (m.y >> 5) + dy); }

function updateMonster(m) {
  m.vx = 0; m.vy = 0;
  switch (m.type) {
    case 1: return trackbot(m);
    case 2: return steelBall(m);
    case 3: return spring(m);
    case 4: return missile(m);
    case 5: return spikes(m);
    case 6: return flitzer(m);
    case 7: return homer(m);
    case 8: return batbot(m);
  }
}

// Floor switches, teleporters and the stuck check, shared by every type but the Homer.
function monsterEnd(m, cdx, cdy, switchOk, padOk, stuckFrame) {
  const px = m.x >> 5, py = m.y >> 5;
  const c = tileAt(px + cdx, py + cdy);
  if (c >= 33 && c <= 35) {
    if (switchOk(px, py) && !(m.fl & 0x10)) {
      G.request = m.type === 8 ? c - 0x21 : c - 0x20; // the Batbot's off-by-one is in the original
      m.fl |= 0x10;
    }
  } else m.fl &= ~0x10;
  if (c >= 6 && c <= 8 && !G.stun) {
    const cd = m.fl & 0x0f;
    if (cd === 0 && padOk(px, py)) {
      m.fl = (m.fl & 0xf0) | 1;
      const list = G.pads[c - 6];
      for (let tries = 0, dest; tries < 10 && list.length; tries++) {
        dest = list[rand() % list.length];
        m.x = dest[0] * U; m.y = dest[1] * U;
        if (dest[0] !== Math.floor((px + 6) / 12) || dest[1] !== Math.floor((py + 11) / 12)) break;
      }
      m.vx = 0; m.vy = 0; m.px = m.x; m.py = m.y;
      sfx('teleport');
    } else if (cd > 0) m.fl = cd + 1 >= 16 ? 0 : (m.fl & 0xf0) | (cd + 1);
  } else m.fl &= 0xf0;
  if (solid(tileAt((m.x >> 5) + cdx, (m.y >> 5) + cdy))) {
    m.vx = 0; m.vy = 0;
    if (stuckFrame !== undefined) m.frame = stuckFrame;
    if (!m.stuck) { m.stuck = 1; }
  } else m.stuck = 0;
}

const aligned = (px, py) => px % 12 < 2 && py % 12 < 2;
const lowInCell = (px, py) => (py - 1) % 12 > 10;

function trackbot(m) {
  const px = m.x >> 5, py = m.y >> 5;
  const aL = sense(m, 2, -1), aR = sense(m, 9, -1), rT = sense(m, 12, 0), rB = sense(m, 12, 11);
  const fR = sense(m, 9, 12), cB = sense(m, 6, 11), fL = sense(m, 2, 12), lB = sense(m, -1, 11), lT = sense(m, -1, 0);
  const b2 = sense(m, 6, 13), c10 = sense(m, 6, 10), c = sense(m, 6, 6);
  const dR = rawAt(px + 12, py + 12), dL = rawAt(px - 1, py + 12); // not cleared: a dug brick still counts as floor
  const dx = (m.x - S.x) >> 5, dy = (m.y - S.y) >> 5;
  const can = {
    1: !solid(lB) && !solid(lT),
    2: !solid(rT) && !solid(rB),
    4: !solid(aL) && !solid(aR) && px % 12 < 2 && ladder(cB),
    8: !solid(fR) && !solid(fL) && px % 12 < 2 && (ladder(c) || (ladder(fR) && ladder(fL))),
  };
  let dir = m.st;
  if ((dir === 4 && can[4]) || (dir === 8 && can[8])) {
    const away = (dy > 0 && dir === 8) || (dy < 0 && dir === 4);
    if (away || rand() % 3 === 0) {
      let done = false;
      if ((dx > 0 || rand() % 20 === 0) && can[1] && solidOrLadder(dL)) { dir = 1; done = true; }
      if (!done && (dx < 0 || rand() % 20 === 0) && can[2] && solidOrLadder(dR)) dir = 2;
    }
  } else if ((dir === 1 && can[1]) || (dir === 2 && can[2])) {
    const away = (dir === 2 && dx > 0) || (dir === 1 && dx < 0);
    if (away || rand() % 3 === 0) {
      let done = false;
      if ((dy > 0 || rand() % 20 === 0) && can[4]) { dir = 4; done = true; }
      if (!done && (dy < 0 || rand() % 20 === 0) && can[8]) dir = 8;
    }
  } else {
    const nv = dir !== 4 && dir !== 8, nh = dir !== 1 && dir !== 2;
    if (nv && dy > 0 && can[4]) dir = 4;
    else if (nv && dy < 0 && can[8]) dir = 8;
    else if (nh && dx > 0 && can[1]) dir = 1;
    else if (nh && dx < 0 && can[2]) dir = 2;
    else if (nv && can[4]) dir = 4;
    else if (nv && can[8]) dir = 8;
    else if (nh && can[1]) dir = 1;
    else if (nh && can[2]) dir = 2;
    else dir = 0;
  }
  if (ladder(c) || solidOrLadder(fR) || solidOrLadder(fL)) {
    if (dir === 1) m.vx = -50;
    if (dir === 2) m.vx = 50;
    if (dir === 4) m.vy = -40;
    if (dir === 8) m.vy = 40;
    // moving ladders only change the speed of a robot that is climbing (0c7b:6c42 skips them at vy = 0)
    if (m.vy !== 0) {
      if ((c === 2 || fR === 2 || fL === 2) && can[4]) m.vy = -25 - 36 * (m.vy < 0) + 41 * (m.vy > 0);
      if ((c === 3 || fR === 3 || fL === 3) && can[8]) m.vy = 25 + 36 * (m.vy > 0) - 41 * (m.vy < 0);
    }
    if (dir === 4 || dir === 8) { const r = px % 12; if (r >= 6) m.vx = 32; else if (r >= 1) m.vx = -32; }
  } else { dir = 0; m.vx = 0; m.vy = 64; }
  m.st = dir;
  if (G.stun) { m.vx = 0; if (m.vy !== 64) m.vy = 0; }
  if (m.vy === 64) { if (m.frame >= 10) m.frame = 4; }
  else if (m.vy !== 0) m.frame = 10 + ((py >> 1) & 1);
  else if (m.vx !== 0) m.frame = 4 + 3 * (m.vx < 0) + ((px >> 1) % 3);
  const both = (a, b) => fR >= a && fR <= b && fL >= a && fL <= b;
  if (both(94, 96)) m.frame = 4 + 3 * (m.vx < 0);
  if (both(97, 99)) m.vx = Math.trunc(m.vx * 0.6);
  if (both(114, 116)) m.vx = -40 - 15 * (m.vx < 0) + 60 * (m.vx > 0);
  if (both(117, 119)) m.vx = 40 + 15 * (m.vx > 0) - 60 * (m.vx < 0);
  if (m.vy < -32 && !(ladder(c10) && !solid(sense(m, 6, -2)))) m.vy = -32;
  if (m.vy > 32 && (solid(b2) || (!ladder(c) && ladder(b2)))) m.vy = 32;
  monsterEnd(m, 6, 6, lowInCell, aligned, 10);
}

function steelBall(m) {
  const r = sense(m, 12, 11), b1 = sense(m, 1, 12), b2 = sense(m, 10, 12), l = sense(m, -1, 11);
  m.st++;
  if (m.st % 64 === 63) m.st &= 0x40;
  let falling = false;
  if (!solidOrLadder(b1) && !solidOrLadder(b2)) { m.vy = 64; m.frame = 3; falling = true; }
  else {
    if (solid(l)) m.st = 0x40; else if (solid(r)) m.st = 0;
    const right = m.st & 0x40;
    if (!right && !solid(l)) m.vx = -59;
    else if (right && !solid(r)) m.vx = 59;
    m.frame = right ? (m.st >> 1) % 3 : 2 - ((m.st >> 1) % 3);
  }
  if (G.stun) { m.vx = 0; if (!falling) { m.vy = 0; m.frame = 0; } }
  if (b1 >= 97 && b1 <= 99) m.vx = Math.trunc(m.vx * 0.6);
  if (b1 >= 114 && b1 <= 116) m.vx = -40 - 22 * (m.vx < 0) + 67 * (m.vx > 0);
  if (b1 >= 117 && b1 <= 119) m.vx = 40 + 22 * (m.vx > 0) - 67 * (m.vx < 0);
  monsterEnd(m, 6, 11, lowInCell, (px, py) => (px % 12 < 2 || px % 12 >= 11) && py % 12 < 2);
}

function spring(m) {
  if (m.st >= 10) {
    if (m.st % 10 === 4) m.st = 2 - Math.floor(m.st / 10);
    else m.st++;
  }
  if (m.st === 0) {
    if (solid(sense(m, 6, 8))) { m.st = 10; m.frame = 12; }
    else { m.vy = 64; m.frame = 13 + (Math.floor(m.y / 200) & 1); }
  } else if (m.st === 1) {
    if (solid(sense(m, 6, -1))) { m.st = 20; m.frame = 15; }
    else { m.vy = -64; m.frame = 13 + (Math.floor(m.y / 200) & 1); }
  }
  if (G.stun) { m.vx = 0; m.vy = 0; }
  monsterEnd(m, 6, 4, (px, py) => (py - 1) % 12 < 4, aligned, 13);
}

function missile(m) {
  const blocked = [solid(sense(m, 6, -2)), solid(sense(m, 13, 6)), solid(sense(m, 6, 13)), solid(sense(m, -2, 6))];
  let d = Math.floor(m.st / 10);
  if (blocked[d]) {
    const cw = (d + 1) % 4, ccw = (d + 3) % 4;
    d = !blocked[cw] ? cw : ccw;
    m.st = 10 * d;
  } else {
    const [sx, sy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][d];
    m.vx = sx * 64; m.vy = sy * 64;
  }
  m.st++;
  if (m.st % 10 >= 6) m.st -= 6;
  m.frame = 21 + 3 * Math.floor(m.st / 10) + ((m.st >> 1) % 3);
  if (G.stun) { m.vx = 0; m.vy = 0; }
  monsterEnd(m, 6, 6, lowInCell, (px, py) => py % 12 < 2);
}

function spikes(m) {
  const S_ = (dx, dy) => solid(sense(m, dx, dy));
  const t = S_(6, -1), tr = S_(8, 0), r = S_(9, 3), br = S_(8, 5), b = S_(6, 6), bl = S_(3, 5), l = S_(2, 3), tl = S_(3, 0);
  if (m.st === 0) m.st = (rand() % 4) + 1;
  const rules = {
    1: [[t && l, 3], [t, 4], [l, 2], [tl, 3], [-1, -1]],
    2: [[t && r, 4], [t, 3], [r, 1], [tr, 4], [1, -1]],
    3: [[r && b, 1], [r, 4], [b, 2], [br, 1], [1, 1]],
    4: [[b && l, 2], [b, 1], [l, 3], [bl, 2], [-1, 1]],
  }[m.st];
  let bounced = false;
  for (let i = 0; i < 4; i++) if (rules[i][0]) { m.st = rules[i][1]; bounced = true; break; }
  if (!bounced) { m.vx = rules[4][0] * 25; m.vy = rules[4][1] * 25; }
  m.frame = 16 + ((m.x >> 5) % 3);
  if (G.stun) { m.vx = 0; m.vy = 0; }
  monsterEnd(m, 6, 3, (px, py) => (py - 1) % 12 > 6, aligned);
}

const EIGHT = [null, [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
function flitzer(m) {
  const S_ = (dx, dy) => solid(sense(m, dx, dy));
  const top = S_(6, -1), tr = S_(10, 0), right = S_(11, 6), br = S_(10, 10), bot = S_(6, 11), bl = S_(0, 10), left = S_(-1, 6), tl = S_(0, 0);
  m.st++;
  if (m.st % 20 === 7) m.st = 20 * ((rand() % 8) + 1);
  let d = Math.floor(m.st / 20);
  if (d) {
    const blocked = [false, top, tr || top || right, right, br || right || bot, bot, bl || bot || left, left, tl || left || top][d];
    if (blocked) {
      if (rand() % 10 === 0) m.st = 0;
      else { d += rand() & 1 ? 1 : -1; if (d === 0) d = 8; if (d === 9) d = 1; m.st = 20 * d; }
    } else { m.vx = EIGHT[d][0] * 15; m.vy = EIGHT[d][1] * 15; }
  }
  m.frame = 33 + Math.floor(m.st / 20);
  if (G.stun) { m.vx = 0; m.vy = 0; }
  monsterEnd(m, 6, 6, lowInCell, aligned);
}

function homer(m) {
  const dx = (m.x - S.x) >> 5, dy = (m.y - S.y) >> 5;
  m.vx = dx > 0 ? -5 : dx < 0 ? 5 : 0;
  m.vy = dy > 0 ? -5 : dy < 0 ? 5 : 0;
  m.st++;
  if (m.st === 64) m.st = 0;
  m.frame = 19 + (m.st >> 5);
  if (G.stun) { m.vx = 0; m.vy = 0; }
}

function batbot(m) {
  const S_ = (dx, dy) => solid(sense(m, dx, dy));
  const top = S_(6, -1), tr = S_(10, 0), right = S_(11, 1), br = S_(10, 3), bot = S_(6, 4), bl = S_(1, 3), left = S_(0, 1), tl = S_(1, 0);
  const upOk = !top && !tr && !tl, downOk = !br && !bot && !bl, leftOk = !bl && !left && !tl, rightOk = !tr && !right && !br;
  const dy = ((m.y + 4) - S.y) >> 5, dx = (m.x - S.x) >> 5;
  let bits = m.st & 0x0f, vx = 0, vy = 0;
  if (bits & 1) { if (upOk) vy = -1; else bits &= ~1; }
  else if (bits & 2) { if (downOk) vy = 1; else bits &= ~2; }
  if (bits & 4) { if (leftOk) vx = -1; else bits &= ~4; }
  else if (bits & 8) { if (rightOk) vx = 1; else bits &= ~8; }
  let blockedAxes = 0;
  if (!(bits & 3)) {
    if (dy > 0 && upOk) bits |= 1;
    else if (dy < 0 && downOk) bits |= 2;
    else if (dy !== 0) blockedAxes++;
  }
  if (!(bits & 12)) {
    if (dx > 0 && leftOk) bits |= 4;
    else if (dx < 0 && rightOk) bits |= 8;
    else if (dx !== 0) blockedAxes++;
  }
  if ((((bits & 1) && dy < 0) || ((bits & 2) && dy > 0)) && (((bits & 4) && dx < 0) || ((bits & 8) && dx > 0))) bits = 0;
  if (blockedAxes === 2) {
    bits = 0;
    if (m.y + 4 < S.y && upOk) bits = 1;
    else if (m.y + 4 > S.y && downOk) bits = 2;
    else if (m.x < S.x && leftOk) bits = 4;
    else if (m.x > S.x && rightOk) bits = 8;
  }
  let anim = ((m.st >> 4) + 1) & 15;
  m.st = (anim << 4) | bits;
  m.vx = vx * 14; m.vy = vy * 10;
  m.frame = m.vy > 0 ? 42 : 42 + Math.floor(anim / 3);
  if (G.stun) { m.vx = 0; m.vy = 0; }
  monsterEnd(m, 6, 1, (px, py) => py % 12 > 6, (px, py) => px % 12 < 2 && py % 12 >= 8);
}

// ---------- between lives and levels ----------

function endLife(why) {
  stopLoops();
  if (why === 'quit') return toTitle();
  if (why === 'skip') { nextLevel(); return toReady(); }
  if (why === 'door') { G.screen = 'bonus'; G.timer = 0; G.bonusStep = 0; sfx('win'); return; }
  G.screen = 'flash'; G.timer = 0;
}

function nextLevel() {
  G.level++;
  if (G.level >= LEVELS.length) { G.level = 0; G.screen = 'congrats'; G.timer = 0; G.afterCongrats = true; }
}

function toReady() {
  if (G.screen === 'congrats') return;
  loadLevel();
  G.screen = 'ready'; G.timer = 0;
}

function toTitle() {
  G.screen = 'title'; G.timer = 0;
  G.level = 0; loadLevel();
}

function newGame() {
  srand(Date.now() & 0xffff);
  G.level = 0; G.score = 0; G.lives = 3; G.skips = 0; G.speed = 5; G.cheated = false;
  toReady();
}

// ---------- high scores (JETPACK.HIS kept 15 on one PC; here everyone shares one board, see leaderboard.js) ----------

let best = null;
function refreshBest() { Leaderboard.best().then((b) => { best = b; }).catch(() => { /* offline */ }); }

function showScores(score = 0) {
  held.clear(); pressed.length = 0; stopLoops();
  const ended = score > 0 || G.screen === 'board';
  Leaderboard.open({
    score, cheated: G.cheated,
    closeLabel: ended ? 'Play again' : 'Back',
    onClose: () => { refreshBest(); if (ended) newGame(); },
  });
}

// ---------- sound: new effects, made with Web Audio ----------

let audio = null, muted = false, jetNode = null;
function ensureAudio() {
  if (audio) return;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
}
function tone(freq, dur, type = 'square', vol = 0.06, slide = 0, delay = 0) {
  if (!audio || muted) return;
  const t0 = audio.currentTime + delay;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(audio.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(dur, vol = 0.08, freq = 1200) {
  if (!audio || muted) return;
  const n = audio.createBufferSource(), b = audio.createBuffer(1, Math.ceil(audio.sampleRate * dur), audio.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  n.buffer = b;
  const f = audio.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
  const g = audio.createGain(); g.gain.setValueAtTime(vol, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
  n.connect(f).connect(g).connect(audio.destination);
  n.start();
}
const SFX = {
  gift: () => { tone(880, 0.08, 'triangle', 0.08); tone(1320, 0.12, 'triangle', 0.07, 0, 0.06); },
  coin: () => { tone(1568, 0.06, 'square', 0.04); tone(2093, 0.1, 'square', 0.04, 0, 0.05); },
  fuel: () => tone(300, 0.25, 'sawtooth', 0.05, 500),
  stunner: () => { for (let i = 0; i < 4; i++) tone(i % 2 ? 600 : 900, 0.07, 'square', 0.04, 0, i * 0.07); },
  shield: () => tone(500, 0.3, 'sine', 0.08, 700),
  life: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'triangle', 0.08, 0, i * 0.09)),
  door: () => [392, 494, 587, 784].forEach((f, i) => tone(f, 0.18, 'triangle', 0.07, 0, i * 0.12)),
  die: () => { tone(400, 0.6, 'sawtooth', 0.07, -340); noise(0.4, 0.06, 600); },
  trap: () => noise(0.15, 0.1, 3000),
  teleport: () => tone(200, 0.6, 'sine', 0.07, 1400),
  phase: () => noise(0.12, 0.05, 2400),
  popup: () => tone(1200, 0.08, 'sine', 0.05, 400),
  barrierOn: () => tone(220, 0.2, 'square', 0.05, 220),
  barrierOff: () => tone(440, 0.2, 'square', 0.05, -220),
  stuck: () => tone(120, 0.2, 'square', 0.06),
  jump: () => tone(300, 0.12, 'square', 0.04, 300),
  win: () => [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'triangle', 0.08, 0, i * 0.11)),
  tick: () => tone(1800, 0.02, 'square', 0.02),
  full: () => { tone(1047, 0.12, 'triangle', 0.08); tone(1568, 0.25, 'triangle', 0.07, 0, 0.1); },
  over: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.08, 0, i * 0.25)),
};
function sfx(name) { if (SFX[name]) SFX[name](); }

// Sounds that last as long as something is held or stood on: the jetpack's roar, the Phase
// Shifter's hum, and the refuel and drain pads (tiles 17 and 18), whose pitch follows the tank.
const loops = {};

function noiseSource() {
  const n = audio.createBufferSource(), b = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  n.buffer = b; n.loop = true;
  return n;
}

// An oscillator whose pitch wobbles (lfoHz, lfoDepth) and whose volume pulses (pulseHz).
function wobble(type, freq, lfoHz, lfoDepth, vol, pulseHz) {
  const o = audio.createOscillator(), g = audio.createGain(), lfo = audio.createOscillator(), depth = audio.createGain();
  o.type = type; o.frequency.value = freq;
  lfo.frequency.value = lfoHz; depth.gain.value = lfoDepth;
  lfo.connect(depth).connect(o.frequency);
  g.gain.value = vol;
  const nodes = [o, lfo];
  if (pulseHz) {
    const p = audio.createOscillator(), pd = audio.createGain();
    p.frequency.value = pulseHz; pd.gain.value = vol * 0.8;
    p.connect(pd).connect(g.gain);
    nodes.push(p);
  }
  o.connect(g).connect(audio.destination);
  nodes.forEach((n) => n.start());
  return { nodes, osc: o, gain: g };
}

const LOOP_MAKERS = {
  jet() {
    const n = noiseSource();
    const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = audio.createGain(); g.gain.value = 0.05;
    n.connect(f).connect(g).connect(audio.destination);
    n.start();
    return { nodes: [n] };
  },
  phase() {
    const hum = wobble('sawtooth', 150, 18, 60, 0.035, 0);
    const n = noiseSource();
    const f = audio.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 3;
    const g = audio.createGain(); g.gain.value = 0.02;
    n.connect(f).connect(g).connect(audio.destination);
    n.start();
    return { nodes: [...hum.nodes, n], osc: hum.osc, crackle: g };
  },
  charge() { return wobble('triangle', 300, 6, 12, 0.05, 10); },
  drain() { return wobble('square', 200, 4, 8, 0.025, 6); },
};

function setLoop(name, on) {
  if (!audio || muted) on = false;
  if (on && !loops[name]) loops[name] = LOOP_MAKERS[name]();
  else if (!on && loops[name]) {
    loops[name].nodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } });
    delete loops[name];
  }
  return loops[name];
}

function updateLoops() {
  const live = G.screen === 'play' && !G.paused && S && !S.dying;
  setLoop('jet', live && S.jet && S.fuel > 0);
  const ph = setLoop('phase', live && S.shifter);
  if (ph) {
    // louder and higher while it is cutting into a brick
    ph.osc.frequency.setTargetAtTime(S.digging ? 230 : 150, audio.currentTime, 0.03);
    ph.crackle.gain.setTargetAtTime(S.digging ? 0.05 : 0.015, audio.currentTime, 0.03);
  }
  const ch = setLoop('charge', live && S.pad === 'charge');
  if (ch) ch.osc.frequency.setTargetAtTime(260 + 700 * S.fuel / 10000, audio.currentTime, 0.05);
  const dr = setLoop('drain', live && S.pad === 'drain');
  if (dr) dr.osc.frequency.setTargetAtTime(110 + 300 * S.fuel / 10000, audio.currentTime, 0.05);
}

function stopLoops() { Object.keys(loops).forEach((k) => setLoop(k, false)); }

// ---------- drawing ----------

let canvas, ctx, scale = 1, staticLayer = null, caveLayer = null, staticScale = 0, snow = [];

function buildStatic() {
  const W = Math.ceil(PLAY_W * scale), H = Math.ceil(PLAY_H * scale);
  if (!staticLayer) staticLayer = document.createElement('canvas');
  staticLayer.width = W; staticLayer.height = H;
  const g = staticLayer.getContext('2d');
  g.setTransform(scale, 0, 0, scale, 0, 0);
  drawLevelStatic(g, 26, 16, (cx, cy) => (cx < 0 || cy < 0 || cx > 25 || cy > 15 ? -1 : G.grid[cellIndex(cx + 1, cy + 1)]),
    (v) => LIVE.has(v & 0x7f) || FRONT(v & 0x7f));
  // the bare cave, for painting over a brick while it is being dug
  if (staticScale !== scale || !caveLayer) {
    caveLayer = caveLayer || document.createElement('canvas');
    caveLayer.width = W; caveLayer.height = H;
    const c = caveLayer.getContext('2d');
    c.setTransform(scale, 0, 0, scale, 0, 0);
    drawCave(c, 26, 16);
  }
  staticScale = scale;
  G.staticDirty = false;
}

function drawPlay(alpha, t) {
  if (G.staticDirty || staticScale !== scale) buildStatic();
  ctx.drawImage(staticLayer, 0, 0, PLAY_W, PLAY_H);
  // live tiles
  for (let r = 1; r <= 16; r++) for (let c = 1; c <= 26; c++) {
    const v = G.grid[cellIndex(c, r)], tile = v & 0x7f;
    if (!LIVE.has(tile)) continue;
    if (G.screen === 'flash' && tile === 4 && G.flashHide) continue;
    drawTile(ctx, v, (c - 1) * T, (r - 1) * T, c - 1, r - 1, t);
  }
  // bricks being dug: cover the static picture and draw the dig stage
  for (const d of G.digs) {
    const st = digStage(d);
    if (!st) continue;
    const c = d.cell % COLS, r = Math.floor(d.cell / COLS), x = (c - 1) * T, y = (r - 1) * T;
    ctx.drawImage(caveLayer, x * scale, y * scale, T * scale, T * scale, x, y, T, T);
    drawDigState(ctx, d.tile, x, y, c - 1, r - 1, st, t);
  }
  drawDoor(ctx, (G.door[0] - 1) * T, (G.door[1] - 1) * T, G.doorOpen ? 1 : G.doorCount ? Math.floor(G.doorCount / 5) / 7 : 0, t);
  for (const p of G.pickups) drawPickup(ctx, p.kind, p.c * T, p.r * T, t, p.timer < 100);
  // monsters
  const flash = G.stun > 0 && G.stun < 50;
  for (const m of G.monsters) {
    const [x, y] = lerpPos(m.px, m.py, m.x, m.y, alpha);
    drawMonster(ctx, m.frame, x - T, y - T, t, flash);
    if (G.stun >= 50) drawDizzy(ctx, x - T, y - T, t);
  }
  // Santa
  if (G.screen === 'intro') {
    const k = Math.min(1, G.timer / 1120);
    const sx = (S.x >> 5) - T, sy = (S.y >> 5) - T;
    if (k < 1) drawSantaAssemble(ctx, sx, sy, k, t);
    else if (Math.floor((G.timer - 1120) / 150) % 2 === 0) drawSantaFrame(ctx, sx, sy, 0, t);
  } else if (G.screen !== 'flash' || S.dying < 1000) {
    const [x, y] = lerpPos(S.pxPrev, S.pyPrev, S.x, S.y, alpha);
    const shieldOn = G.shield > 50 || (G.shield > 0 && (G.shield & 2));
    const tp = S.teleport ? { pad: Math.floor(S.teleport / 1000), e: S.teleport % 1000 } : null;
    if (S.frame !== 71) drawSantaFrame(ctx, x - T, y - T, G.screen === 'bonus' ? 65 + (G.bonusStep % 6) : S.frame, t,
      { shield: shieldOn && !S.dying, shieldBlink: G.shield <= 50, teleport: tp });
  }
  // scenery in front (26-32)
  for (let r = 1; r <= 16; r++) for (let c = 1; c <= 26; c++) {
    const v = G.grid[cellIndex(c, r)];
    if (FRONT(v & 0x7f) && !(v & 0x80)) drawTile(ctx, v, (c - 1) * T, (r - 1) * T, c - 1, r - 1, t);
  }
}

function lerpPos(ax, ay, bx, by, a) {
  if (Math.abs(bx - ax) > U || Math.abs(by - ay) > U) return [bx >> 5, by >> 5];
  return [(ax + (bx - ax) * a) / 32, (ay + (by - ay) * a) / 32];
}

function drawDizzy(g, x, y, t) {
  for (let i = 0; i < 3; i++) {
    const a = t * 5 + (i * Math.PI * 2) / 3;
    g.fillStyle = '#ffe680';
    g.beginPath(); g.arc(x + 6 + Math.cos(a) * 4, y - 1 + Math.sin(a) * 1.2, 0.7, 0, 7); g.fill();
  }
}

const FONT_UI = '"Rubik", system-ui, sans-serif', FONT_TITLE = '"Mountains of Christmas", "Rubik", serif', FONT_DISPLAY = '"Bungee", "Rubik", sans-serif';

function drawHud(t) {
  const y = PLAY_H;
  ctx.fillStyle = grad(ctx, 0, y, 0, y + HUD_H, [[0, '#1b2238'], [1, '#0d1222']]);
  ctx.fillRect(0, y, PLAY_W, HUD_H);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, y, PLAY_W, 0.5);
  ctx.textBaseline = 'middle';
  ctx.font = `600 5px ${FONT_UI}`;
  const label = (s, x) => { ctx.fillStyle = '#8f9bbf'; ctx.fillText(s, x, y + 8); };
  if (G.info > 0) {
    ctx.fillStyle = '#e6e9f2';
    ctx.fillText(`LEVEL ${G.level + 1}   \u00b7   ${LEVELS[G.level].name.toUpperCase()}   \u00b7   SPEED ${G.speed}`, 6, y + 8);
    return;
  }
  label('FUEL', 6);
  // the original's gauge goes yellow under 3000 and red under 1500
  const fuel = S ? S.fuel : 0, w = 70 * fuel / 10000;
  ctx.fillStyle = '#0a0d18';
  rrect(ctx, 22, y + 5.5, 72, 5, 2.5); ctx.fill();
  const col = fuel >= 3000 ? ['#7dff8a', '#21b04a'] : fuel >= 1500 ? ['#ffe27a', '#d8a020'] : ['#ff8a7a', '#c8202a'];
  if (w > 0) {
    ctx.save();
    ctx.shadowColor = col[1]; ctx.shadowBlur = 3;
    ctx.fillStyle = grad(ctx, 0, y + 6, 0, y + 10, [[0, col[0]], [1, col[1]]]);
    rrect(ctx, 23, y + 6.5, Math.max(3, w), 3, 1.5); ctx.fill();
    ctx.restore();
  }
  // shield and stunner time left
  let ix = 100;
  if (G.shield > 0) { drawPickup(ctx, 0, ix - 2, y + 2, t, G.shield < 50); ix += 11; }
  if (G.stun > 0) { drawPickup(ctx, 1, ix - 2, y + 2, t, G.stun < 50); ix += 11; }
  label('GIFTS', 128);
  ctx.fillStyle = '#e6e9f2';
  ctx.fillText(`${G.gifts}/${G.giftsTotal}`, 146, y + 8);
  label('LIVES', 178);
  ctx.fillStyle = '#e6e9f2';
  ctx.fillText(String(Math.max(0, G.lives - 1)).padStart(2, '0'), 196, y + 8);
  label('SCORE', 236);
  ctx.fillStyle = '#ffd86a';
  ctx.fillText(String(G.score % 1000000).padStart(6, '0'), 257, y + 8);
  ctx.fillStyle = '#5d6890';
  ctx.font = `500 4px ${FONT_UI}`;
  ctx.fillText(muted ? 'M: sound off' : '', 290, y + 8);
}

function panel(x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(14, 18, 36, 0.92)';
  rrect(ctx, x, y, w, h, 6); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(226, 59, 59, 0.6)'; ctx.lineWidth = 0.6;
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 5.5); ctx.stroke();
}

function centerText(s, y, size, color, weight = 600, font = FONT_UI) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, PLAY_W / 2, y);
  ctx.textAlign = 'left';
}

function drawSnow(dt) {
  if (!snow.length) for (let i = 0; i < 90; i++) snow.push({ x: Math.random() * PLAY_W, y: Math.random() * (PLAY_H + HUD_H), r: 0.3 + Math.random() * 0.9, s: 6 + Math.random() * 14, w: Math.random() * 6 });
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const f of snow) {
    f.y += f.s * dt; f.x += Math.sin(G.t + f.w) * 4 * dt;
    if (f.y > PLAY_H + HUD_H) { f.y = -2; f.x = Math.random() * PLAY_W; }
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
  }
}

function drawTitle(dt, t) {
  drawPlay(1, t);
  ctx.fillStyle = 'rgba(6, 8, 18, 0.72)';
  ctx.fillRect(0, 0, PLAY_W, PLAY_H + HUD_H);
  drawSnow(dt);
  ctx.save();
  ctx.shadowColor = 'rgba(226,59,59,0.8)'; ctx.shadowBlur = 14;
  centerText('JETPACK', 44, 32, '#ff4a4a', 400, FONT_DISPLAY);
  ctx.restore();
  centerText('Christmas Special', 70, 15, '#f4f0e6', 700, FONT_TITLE);
  drawSanta(ctx, PLAY_W / 2 - 6, 88 + Math.sin(t * 2) * 3, { face: 1, walk: 0, mode: 'fly', thrust: 1 }, t);
  const blink = Math.floor(t * 2) % 2 === 0;
  centerText(blink ? 'Press Enter to start' : '', 120, 8, '#ffd86a', 600);
  centerText('Arrows move and climb  \u00b7  Alt or Z jetpack  \u00b7  Ctrl, Enter or X Phase Shifter', 140, 4.6, '#aab3cf', 500);
  centerText('Down presses buttons and uses teleporters  \u00b7  Esc loses this Santa  \u00b7  P pause  \u00b7  M sound', 148, 4.6, '#aab3cf', 500);
  if (best) centerText(`Best: ${best.name}  ${best.score}`, 166, 5, '#8f9bbf', 500);
  centerText('H high scores', 176, 4.6, '#8f9bbf', 500);
  centerText('Original game \u00a9 1993 Adam Pedersen, Software Creations. Rebuilt with new art and sound.', 200, 4, '#5d6890', 500);
}

function drawReady(t) {
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, 0, PLAY_W, PLAY_H + HUD_H);
  drawSnow(1 / 60);
  panel(76, 20, 160, 168);
  centerText('READY PLAYER 1', 36, 9, '#ff5a50', 800);
  centerText(`LEVEL ${G.level + 1}`, 50, 7, '#ffd86a', 700);
  // mini-map of the level
  if (G.staticDirty || staticScale !== scale) buildStatic();
  const mw = 130, mh = 80, mx = (PLAY_W - mw) / 2, my = 60;
  const k = Math.min(1, G.timer / 700);
  ctx.save();
  ctx.beginPath(); ctx.rect(mx + mw / 2 - (mw / 2) * k, my, mw * k, mh); ctx.clip();
  ctx.drawImage(staticLayer, mx, my, mw, mh);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.5;
  ctx.strokeRect(mx, my, mw, mh);
  centerText(LEVELS[G.level].name, 154, 9, '#f4f0e6', 700, FONT_TITLE);
  if (G.timer > 700 && Math.floor(t * 2) % 2 === 0) centerText('Press any key', 174, 5.5, '#aab3cf', 500);
}

function drawOverlayText(lines) {
  ctx.fillStyle = 'rgba(6, 8, 18, 0.6)';
  ctx.fillRect(0, 0, PLAY_W, PLAY_H + HUD_H);
  panel(46, 60, 220, 70 + (lines.length - 2) * 10);
  lines.forEach(([s, size, color, font], i) => centerText(s, 80 + i * 16, size, color, 700, font));
}

function draw(alpha, dt) {
  const t = G.t;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, PLAY_W, PLAY_H + HUD_H);
  switch (G.screen) {
    case 'title': drawTitle(dt, t); break;
    case 'ready': drawReady(t); break;
    case 'congrats':
      drawPlay(1, t); drawHud(t);
      drawOverlayText([['CONGRATULATIONS!', 12, '#ffd86a'], ['You have completed all ' + LEVELS.length + ' levels', 7, '#e6e9f2'], ['of the Jetpack Christmas Special', 7, '#e6e9f2'], ['Your game will continue. Press any key.', 5, '#aab3cf']]);
      break;
    case 'gameover': case 'board':
      drawPlay(1, t); drawHud(t);
      drawOverlayText([['GAME OVER', 14, '#ff5a50'], [`Score ${G.score}`, 8, '#ffd86a']]);
      break;
    default:
      drawPlay(alpha, t); drawHud(t);
      if (G.paused) drawOverlayText([['PAUSED', 12, '#ffd86a'], ['Press P to carry on', 6, '#aab3cf']]);
  }
}

// ---------- the main loop ----------

let acc = 0, last = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  if (document.hidden) return;
  G.t += dt;
  G.timer += dt * 1000;
  let alpha = 1;

  if (G.screen === 'play' && !G.paused) {
    acc += dt * 1000;
    const ms = frameMs(G.speed);
    let n = 0;
    while (acc >= ms && n < 5 && G.screen === 'play') { step(); acc -= ms; n++; }
    if (n === 5) acc = 0;
    alpha = Math.min(1, acc / ms);
  } else if (G.screen === 'intro') {
    if (G.timer > 1120 && pressed.length) { pressed.length = 0; G.screen = 'play'; acc = 0; }
    pressed.length = 0;
    if (G.timer > 1120 && (isHeld('jet') || isHeld('shifter') || isHeld('left') || isHeld('right') || isHeld('up') || isHeld('down'))) { G.screen = 'play'; acc = 0; }
  } else if (G.screen === 'flash') {
    // the original blinks the gifts that were left, 7 times 100 ms apart, then waits 300 ms
    G.flashHide = G.timer < 700 && Math.floor(G.timer / 100) % 2 === 0;
    if (G.timer > 1000) {
      G.lives--;
      if (G.lives <= 0) { G.screen = 'gameover'; G.timer = 0; sfx('over'); }
      else toReady();
    }
  } else if (G.screen === 'bonus') {
    // 100 points, one at a time, while Santa dances
    while (G.timer > (G.bonusStep + 1) * 18 && G.bonusStep < 100) {
      G.bonusStep++;
      const before = Math.floor(G.score / 1000);
      G.score++;
      if (Math.floor(G.score / 1000) !== before) { G.lives = Math.min(100, G.lives + 1); sfx('life'); }
      if (G.bonusStep % 4 === 0) sfx('tick');
    }
    if (G.bonusStep >= 100 && G.timer > 100 * 18 + 500) { nextLevel(); toReady(); }
  } else if (G.screen === 'gameover') {
    if (G.timer > 2000) { G.screen = 'board'; showScores(G.score); }
  } else if (G.screen === 'ready' || G.screen === 'title' || G.screen === 'congrats') {
    if (pressed.length) {
      const k = pressed.shift();
      pressed.length = 0;
      if (G.screen === 'title') {
        if (k === 'Enter' || k === 'KeyS' || k === 'Space') newGame();
        else if (k === 'KeyH') showScores();
      } else if (G.screen === 'ready' && G.timer > 300) {
        G.screen = 'intro'; G.timer = 0;
      } else if (G.screen === 'congrats') { G.screen = 'ready'; loadLevel(); G.timer = 0; }
    }
  }

  updateLoops();
  draw(alpha, dt);
}

function onKey(e, down) {
  if (Leaderboard.isOpen()) return;
  const code = e.code;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab', 'AltLeft', 'AltRight', 'Backspace', 'Quote', 'Enter', 'ControlLeft', 'ControlRight'].includes(code)) e.preventDefault();
  ensureAudio();
  if (audio && audio.state === 'suspended') audio.resume();
  if (!down) { held.delete(code); return; }
  if (e.repeat) return;
  held.add(code);
  if (code === 'KeyM') { muted = !muted; if (muted) stopLoops(); return; }
  if ((code === 'KeyP' || code === 'Pause') && G.screen === 'play') { G.paused = !G.paused; stopLoops(); return; }
  if (code === 'Digit2' && G.screen === 'intro') return; // the original ignores 2 here, so Tab+2 cheats don't start play
  pressed.push(code);
}

function resize() {
  const wrap = canvas.parentElement;
  const cssW = wrap.clientWidth;
  const cssH = cssW * (PLAY_H + HUD_H) / PLAY_W;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  scale = canvas.width / PLAY_W;
  G.staticDirty = true;
}

function wireTouch() {
  document.querySelectorAll('[data-key]').forEach((b) => {
    const code = b.dataset.key;
    const on = (ev) => { ev.preventDefault(); ensureAudio(); held.add(code); pressed.push(code); };
    const off = (ev) => { ev.preventDefault(); held.delete(code); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
  });
}

function start() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => { held.clear(); stopLoops(); if (G.screen === 'play') G.paused = true; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopLoops(); if (G.screen === 'play') G.paused = true; } });
  window.addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', () => { ensureAudio(); canvas.focus(); if (G.screen === 'title') pressed.push('Enter'); else pressed.push('Pointer'); });
  wireTouch();
  const scoresButton = document.querySelector('[data-scores]');
  scoresButton.hidden = false;
  scoresButton.addEventListener('click', () => { if (G.screen === 'title') showScores(); });
  resize();
  toTitle();
  refreshBest();
  // For checking the game from a script: ?level=3&keys=40:R,60:JD starts that level and holds keys
  // for so many frames each (L R U D J P = left, right, up, down, jet, Phase Shifter).
  const q = new URLSearchParams(location.search);
  if (q.get('level')) {
    G.level = +q.get('level') - 1; loadLevel(); G.screen = 'play'; G.cheated = true;
    if (q.get('fuel')) S.fuel = 10000;
    const plan = (q.get('keys') || '').split(',').filter(Boolean).map((p) => p.split(':'));
    const names = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown', J: 'KeyZ', P: 'KeyX' };
    let n = 0;
    const realStep = step;
    step = function () {
      let f = n++;
      held.clear();
      for (const [frames, keys = ''] of plan) { if (f < +frames) { for (const k of keys) held.add(names[k]); break; } f -= +frames; }
      return realStep();
    };
    for (let i = +(q.get('run') || 0); i > 0 && G.screen === 'play'; i--) step();
  }
  requestAnimationFrame(frame);
}

window.addEventListener('load', start);
