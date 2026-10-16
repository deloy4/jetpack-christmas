// Art for the rebuild. Everything is drawn with canvas paths in the original's pixel units
// (a tile is 12 x 12), so the caller scales the context and the shapes stay sharp at any size.
// Layout, colours and which tile looks like what follow the original sprite sheet.

const T = 12;

const PAINT = {
  caveTop: '#2a1810', caveBottom: '#120a07', rock: 'rgba(255, 210, 160, 0.035)', rockDark: 'rgba(0, 0, 0, 0.18)',
  red: '#c42a2a', redLight: '#ec5a4a', redDark: '#7d1420', redMortar: '#3b1a16',
  dark: '#9a4418', darkLight: '#d4732c', darkDark: '#5a2410', darkMortar: '#1c120e',
  stone: '#8f98a2', stoneLight: '#cfd6dc', stoneDark: '#58616b', stoneMortar: '#3a4047',
  ice: '#bfe3ff', iceLight: '#f2fbff', iceDark: '#7fb2ec',
  moss: '#2f8a2c', mossLight: '#6ccf4a', mossDark: '#185a1a',
  ladder: '#e9edf2', ladderShade: '#9aa4b0', ladderGrey: '#9aa1aa', ladderGreyShade: '#5d646c',
  gold: '#ffc83a', goldLight: '#fff2a0', goldDark: '#b07a10',
  wood: '#8a5a2c', woodLight: '#b98250', woodDark: '#4e3016',
  ribbon: '#2fa84a', ribbonLight: '#7fe08a', box: '#e0303a', boxLight: '#ff7a6a', boxDark: '#8a1420',
  steel: '#a9b2bc', steelLight: '#e6ebf0', steelDark: '#5c646e',
  glow: 'rgba(255, 220, 140, 0.35)',
};

// Small deterministic hash so the brick texture and cave specks don't shimmer between redraws.
function hash(x, y, k = 0) {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function grad(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  return gr;
}

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

// ---------- the cave behind everything ----------

function drawCave(g, cols, rows) {
  const W = cols * T, H = rows * T;
  g.fillStyle = grad(g, 0, 0, 0, H, [[0, PAINT.caveTop], [1, PAINT.caveBottom]]);
  g.fillRect(0, 0, W, H);
  // loose stones in the cave wall, in the original's brown
  for (let i = 0; i < cols * rows * 3; i++) {
    const x = hash(i, 1) * W, y = hash(i, 2) * H, r = 0.6 + hash(i, 3) * 2.2;
    g.fillStyle = hash(i, 4) < 0.5 ? PAINT.rock : PAINT.rockDark;
    g.beginPath();
    g.ellipse(x, y, r * 1.4, r, hash(i, 5) * 3, 0, Math.PI * 2);
    g.fill();
  }
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

// ---------- bricks and stone ----------

const BODY = {
  R: { base: PAINT.red, light: PAINT.redLight, dark: PAINT.redDark, mortar: PAINT.redMortar, rows: 4, len: 6 },
  D: { base: PAINT.dark, light: PAINT.darkLight, dark: PAINT.darkDark, mortar: PAINT.darkMortar, rows: 4, len: 4 },
  S: { base: PAINT.stone, light: PAINT.stoneLight, dark: PAINT.stoneDark, mortar: PAINT.stoneMortar, rows: 2, len: 6 },
};

// The block's outline: a square with the original's rounded corners (cut mask NW1 NE2 SE4 SW8).
function blockPath(g, x, y, cut) {
  const r = 4;
  const c = [cut & 1 ? r : 0, cut & 2 ? r : 0, cut & 4 ? r : 0, cut & 8 ? r : 0];
  g.beginPath();
  g.roundRect(x, y, T, T, c);
}

// Bricks are laid on a grid that runs across the whole level, so neighbouring tiles join up.
function brickCourse(g, x, y, w, h, b, cx, cy) {
  const rowH = T / b.rows;
  g.fillStyle = b.mortar;
  g.fillRect(x, y, w, h);
  for (let r = 0; r < b.rows; r++) {
    const ry = y + r * rowH;
    const row = cy * b.rows + r;
    const off = (row % 2) * (b.len / 2);
    for (let bx = -b.len; bx < T + b.len; bx += b.len) {
      const left = x + bx - off;
      const x0 = Math.max(left + 0.35, x), x1 = Math.min(left + b.len - 0.35, x + w);
      if (x1 <= x0) continue;
      const n = hash(Math.floor((cx * T + bx - off) / b.len), row, 7);
      g.fillStyle = grad(g, 0, ry, 0, ry + rowH, [[0, b.light], [0.35, b.base], [1, b.dark]]);
      g.globalAlpha = 0.82 + n * 0.18;
      rrect(g, x0, ry + 0.35, x1 - x0, rowH - 0.7, 0.6);
      g.fill();
      g.globalAlpha = 1;
    }
  }
}

function stoneCourse(g, x, y, w, h, b, cx, cy) {
  g.fillStyle = b.mortar;
  g.fillRect(x, y, w, h);
  const rowH = T / b.rows;
  for (let r = 0; r < b.rows; r++) {
    const ry = y + r * rowH, row = cy * b.rows + r, off = (row % 2) * 3;
    for (let bx = -6; bx < T + 6; bx += 6) {
      const left = x + bx - off;
      const x0 = Math.max(left + 0.4, x), x1 = Math.min(left + 6 - 0.4, x + w);
      if (x1 <= x0) continue;
      const n = hash(Math.floor((cx * T + bx - off) / 6), row, 9);
      g.fillStyle = grad(g, x0, ry, x0 + 2, ry + rowH, [[0, b.light], [0.45, b.base], [1, b.dark]]);
      g.globalAlpha = 0.85 + n * 0.15;
      rrect(g, x0, ry + 0.4, x1 - x0, rowH - 0.8, 1);
      g.fill();
      g.globalAlpha = 1;
    }
  }
}

function drawBlock(g, x, y, shape, cx, cy) {
  const [body, trim, cut, top] = shape;
  const b = BODY[body];
  g.save();
  blockPath(g, x, y, cut);
  g.clip();
  (body === 'S' ? stoneCourse : brickCourse)(g, x, y, T, T, b, cx, cy);
  // grey stone edging on the sides the original has it
  const S = BODY.S, e = 2.2;
  const edges = [[x, y, T, e], [x + T - e, y, e, T], [x, y + T - e, T, e], [x, y, e, T]];
  edges.forEach((r, i) => {
    if (!(trim & (1 << i))) return;
    g.fillStyle = grad(g, r[0], r[1], r[0] + r[2], r[1] + r[3], [[0, S.light], [0.5, S.base], [1, S.dark]]);
    g.fillRect(...r);
  });
  if (top === 'ice') drawIceCoat(g, x, y, cx);
  if (top === 'moss') drawMossCoat(g, x, y, cx);
  g.restore();
}

function drawIceCoat(g, x, y, cx) {
  g.fillStyle = grad(g, 0, y, 0, y + 4, [[0, PAINT.iceLight], [0.6, PAINT.ice], [1, PAINT.iceDark]]);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + T, y);
  g.lineTo(x + T, y + 3);
  for (let i = 4; i >= 0; i--) {
    const px = x + i * 3, d = 3 + hash(cx * 5 + i, 3, 11) * 2.4;
    g.quadraticCurveTo(px + 1.5, y + d + 1, px, y + 3);
  }
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillRect(x, y + 0.4, T, 0.5);
}

// Sludge on top of a brick (tiles 97-99): green goo with rounded drips.
function drawMossCoat(g, x, y, cx) {
  g.fillStyle = grad(g, 0, y, 0, y + 6, [[0, PAINT.mossLight], [0.45, PAINT.moss], [1, PAINT.mossDark]]);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + T, y);
  g.lineTo(x + T, y + 2.5);
  for (let i = 3; i >= 0; i--) {
    const px = x + i * 3, d = 2.5 + hash(cx * 7 + i, 5, 13) * 3.2;
    g.quadraticCurveTo(px + 1.5, y + d + 1.5, px, y + 2.5);
  }
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(220,255,200,0.55)';
  g.beginPath(); g.ellipse(x + 3 + hash(cx, 9, 2) * 6, y + 1, 1.4, 0.4, 0, 0, 7); g.fill();
}

// ---------- ladders and simple fixtures ----------

function drawLadder(g, x, y, kind, t = 0) {
  const grey = kind !== 1;
  const rail = grey ? PAINT.ladderGrey : PAINT.ladder, shade = grey ? PAINT.ladderGreyShade : PAINT.ladderShade;
  g.lineCap = 'round';
  // tile 2 carries you up and tile 3 down, so their rungs scroll that way
  const drift = kind === 2 ? -((t * 10) % 4) : kind === 3 ? (t * 10) % 4 : 0;
  g.save();
  if (drift) { g.beginPath(); g.rect(x, y, T, T); g.clip(); }
  for (let i = drift ? -1 : 0; i < (drift ? 4 : 3); i++) {
    const ry = y + 2 + i * 4 + drift;
    g.strokeStyle = shade;
    g.lineWidth = kind === 3 ? 2.2 : 1.4;
    g.beginPath(); g.moveTo(x + 2, ry + 0.4); g.lineTo(x + 10, ry + 0.4); g.stroke();
    g.strokeStyle = rail;
    g.lineWidth = kind === 3 ? 1.6 : 1;
    g.beginPath(); g.moveTo(x + 2, ry); g.lineTo(x + 10, ry); g.stroke();
  }
  g.restore();
  for (const rx of [x + 1.6, x + 10.4]) {
    g.fillStyle = grad(g, rx - 1, 0, rx + 1, 0, [[0, rail], [1, shade]]);
    rrect(g, rx - 0.9, y, 1.8, T, 0.5);
    g.fill();
  }
}

function drawTable(g, x, y) {
  g.fillStyle = grad(g, 0, y + 9, 0, y + 10.5, [[0, PAINT.woodLight], [1, PAINT.wood]]);
  rrect(g, x + 1.5, y + 9, 9, 1.6, 0.6);
  g.fill();
  g.fillStyle = PAINT.woodDark;
  g.fillRect(x + 5.3, y + 10.4, 1.4, 1.6);
  g.fillRect(x + 3.5, y + 11.4, 5, 0.6);
}

function drawGift(g, x, y, t) {
  drawTable(g, x, y);
  const bob = Math.sin(t * 3 + x * 0.3) * 0.3;
  g.save();
  g.translate(0, bob);
  g.shadowColor = 'rgba(255, 90, 80, 0.55)';
  g.shadowBlur = 3;
  g.fillStyle = grad(g, x + 3, 0, x + 9, 0, [[0, PAINT.boxLight], [0.4, PAINT.box], [1, PAINT.boxDark]]);
  rrect(g, x + 3, y + 3.6, 6, 5.4, 0.7);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = PAINT.ribbon;
  g.fillRect(x + 5.4, y + 3.6, 1.2, 5.4);
  g.fillRect(x + 3, y + 5.6, 6, 1);
  g.fillStyle = PAINT.ribbonLight;
  g.beginPath(); g.ellipse(x + 4.9, y + 3.1, 1.2, 0.8, -0.5, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(x + 7.1, y + 3.1, 1.2, 0.8, 0.5, 0, Math.PI * 2); g.fill();
  g.restore();
}

// Gems on the cave floor: tiles 9-14 and 33-35. c is 'b', 'r' or 'g'; withGrey adds the grey nugget.
const GEM = { b: ['#7fb8ff', '#2050e0', '#0c1f80'], r: ['#ff8a8a', '#e01c2a', '#7a0810'], g: ['#8affd6', '#10b08a', '#06604a'] };
function drawGem(g, x, y, c, size, withGrey) {
  if (withGrey) {
    g.fillStyle = grad(g, x + 2, y + 6, x + 6, y + 10, [[0, PAINT.steelLight], [1, PAINT.steelDark]]);
    g.beginPath(); g.ellipse(x + 4, y + 8, 2.2, 1.7, 0.4, 0, Math.PI * 2); g.fill();
  }
  const [l, m, d] = GEM[c];
  const cx = x + (withGrey ? 7.5 : 6), cy = y + (size > 1 ? 6 : 9), s = size > 1 ? 2.6 : 1.7;
  g.save();
  g.shadowColor = m;
  g.shadowBlur = 3;
  g.fillStyle = grad(g, cx - s, cy - s, cx + s, cy + s, [[0, l], [0.5, m], [1, d]]);
  g.beginPath();
  g.moveTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s, cy);
  g.closePath(); g.fill();
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); g.ellipse(cx - s * 0.35, cy - s * 0.35, s * 0.3, s * 0.18, -0.7, 0, Math.PI * 2); g.fill();
}

function drawTank(g, x, y, double) {
  const one = (ox, w) => {
    g.fillStyle = grad(g, ox, 0, ox + w, 0, [[0, PAINT.steelDark], [0.35, PAINT.steelLight], [1, PAINT.steelDark]]);
    rrect(g, ox, y + 3.5, w, 7.5, 1.2);
    g.fill();
    g.fillStyle = '#e23b3b';
    g.fillRect(ox, y + 6.2, w, 1.4);
    g.fillStyle = PAINT.steelDark;
    g.fillRect(ox + w / 2 - 0.8, y + 2.4, 1.6, 1.3);
  };
  if (double) { one(x + 1.5, 4.2); one(x + 6.3, 4.2); } else one(x + 3.8, 4.4);
}

// Tiles 17 and 18: the refuelling grid and its broken twin that drains fuel.
function drawGrid(g, x, y, broken, t) {
  g.strokeStyle = broken ? '#8d949c' : '#cfd6dc';
  g.lineWidth = 1;
  g.save();
  if (!broken) { g.shadowColor = 'rgba(120, 220, 255, 0.8)'; g.shadowBlur = 2 + Math.sin(t * 6) * 1.5; }
  for (const [ox, oy] of [[1, 1], [6.5, 1], [1, 6.5], [6.5, 6.5]]) {
    if (broken && hash(x + ox, y + oy, 3) < 0.35) continue;
    rrect(g, x + ox + 0.5, y + oy + 0.5, 4, 4, 0.6);
    g.stroke();
  }
  g.restore();
}

function drawCoin(g, x, y, t) {
  const w = Math.abs(Math.cos(t * 2.5 + x)) * 3 + 0.6;
  g.save();
  g.shadowColor = PAINT.glow; g.shadowBlur = 4;
  g.fillStyle = grad(g, x + 6 - w, y + 3, x + 6 + w, y + 9, [[0, PAINT.goldLight], [0.5, PAINT.gold], [1, PAINT.goldDark]]);
  g.beginPath(); g.ellipse(x + 6, y + 6, w, 3.4, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}

function drawGoldPile(g, x, y) {
  g.save();
  g.shadowColor = PAINT.glow; g.shadowBlur = 4;
  g.fillStyle = grad(g, 0, y + 6, 0, y + 12, [[0, PAINT.goldLight], [0.5, PAINT.gold], [1, PAINT.goldDark]]);
  g.beginPath();
  g.moveTo(x + 1, y + 12); g.quadraticCurveTo(x + 6, y + 3, x + 11, y + 12); g.closePath();
  g.fill();
  g.restore();
  g.fillStyle = PAINT.goldLight;
  [[4, 9.5], [6.5, 8], [8, 10.5]].forEach(([a, b]) => { g.beginPath(); g.arc(x + a, y + b, 0.7, 0, 7); g.fill(); });
}

function drawVase(g, x, y) {
  g.save();
  g.shadowColor = PAINT.glow; g.shadowBlur = 4;
  g.fillStyle = grad(g, x + 2, 0, x + 10, 0, [[0, PAINT.goldDark], [0.35, PAINT.goldLight], [0.6, PAINT.gold], [1, PAINT.goldDark]]);
  g.beginPath();
  g.moveTo(x + 4.6, y + 1.5); g.lineTo(x + 7.4, y + 1.5);
  g.quadraticCurveTo(x + 6.6, y + 4, x + 8.6, y + 6);
  g.quadraticCurveTo(x + 11, y + 9.5, x + 8, y + 12);
  g.lineTo(x + 4, y + 12);
  g.quadraticCurveTo(x + 1, y + 9.5, x + 3.4, y + 6);
  g.quadraticCurveTo(x + 5.4, y + 4, x + 4.6, y + 1.5);
  g.fill();
  g.restore();
}

// Tile 23: the gold Santa statue, worth an extra life.
function drawStatue(g, x, y, t) {
  g.save();
  g.shadowColor = 'rgba(255, 220, 100, 0.7)'; g.shadowBlur = 4 + Math.sin(t * 4) * 2;
  g.fillStyle = grad(g, x + 2, y, x + 10, y + 12, [[0, PAINT.goldLight], [0.5, PAINT.gold], [1, PAINT.goldDark]]);
  g.beginPath(); g.arc(x + 6, y + 3, 2.2, 0, 7); g.fill();
  rrect(g, x + 3.2, y + 4.6, 5.6, 5, 1.6); g.fill();
  g.fillRect(x + 3.6, y + 9.4, 1.8, 2.6); g.fillRect(x + 6.6, y + 9.4, 1.8, 2.6);
  g.beginPath(); g.moveTo(x + 3.8, y + 2.2); g.lineTo(x + 8.6, y + 0.6); g.lineTo(x + 8.2, y + 2.6); g.fill();
  g.restore();
}

function drawStunner(g, x, y, t) {
  g.save();
  g.shadowColor = 'rgba(180, 220, 255, 0.8)'; g.shadowBlur = 3;
  g.fillStyle = grad(g, x + 3, y + 3, x + 9, y + 9, [[0, PAINT.steelLight], [1, PAINT.steelDark]]);
  g.beginPath(); g.arc(x + 6, y + 6.5, 3.6, 0, 7); g.fill();
  g.restore();
  g.strokeStyle = '#7fd0ff';
  g.lineWidth = 0.6;
  g.beginPath();
  const a = t * 5;
  g.moveTo(x + 6 + Math.cos(a) * 2, y + 6.5 + Math.sin(a) * 2);
  g.lineTo(x + 6 - Math.cos(a) * 2, y + 6.5 - Math.sin(a) * 2);
  g.stroke();
}

function drawPillar(g, x, y) {
  g.fillStyle = grad(g, x + 2, 0, x + 10, 0, [[0, PAINT.stoneDark], [0.3, PAINT.stoneLight], [0.7, PAINT.stone], [1, PAINT.stoneDark]]);
  g.fillRect(x + 3, y + 1.5, 6, 9);
  g.fillStyle = PAINT.stoneLight;
  g.fillRect(x + 1.5, y, 9, 1.6);
  g.fillRect(x + 1.5, y + 10.4, 9, 1.6);
  g.strokeStyle = 'rgba(0,0,0,0.2)';
  g.lineWidth = 0.4;
  for (const fx of [5, 7]) { g.beginPath(); g.moveTo(x + fx, y + 2); g.lineTo(x + fx, y + 10); g.stroke(); }
}

// Tile 26: the icy ledge you can stand on.
function drawIceLedge(g, x, y) {
  g.save();
  g.shadowColor = 'rgba(160, 220, 255, 0.6)'; g.shadowBlur = 2;
  g.fillStyle = grad(g, 0, y + 4, 0, y + 8, [[0, PAINT.iceLight], [1, PAINT.iceDark]]);
  rrect(g, x, y + 4, T, 2.4, 1); g.fill();
  rrect(g, x + 1, y + 6.4, 2, 1.6, 0.5); g.fill();
  rrect(g, x + 9, y + 6.4, 2, 1.6, 0.5); g.fill();
  g.restore();
}

function drawVines(g, x, y, cx, cy) {
  g.strokeStyle = PAINT.moss;
  g.lineWidth = 1.2;
  g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const sx = x + 2 + i * 4 + hash(cx, cy, i) * 2;
    g.beginPath();
    g.moveTo(sx, y);
    g.bezierCurveTo(sx + 3, y + 4, sx - 3, y + 8, sx + 1, y + T);
    g.stroke();
  }
  g.fillStyle = PAINT.mossLight;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.ellipse(x + hash(cx, cy, 20 + i) * 12, y + hash(cx, cy, 30 + i) * 12, 1.2, 0.6, hash(cx, cy, 40 + i) * 3, 0, 7);
    g.fill();
  }
  g.fillStyle = '#c05ad8';
  for (let i = 0; i < 2; i++) { g.beginPath(); g.arc(x + hash(cx, cy, 50 + i) * 12, y + hash(cx, cy, 60 + i) * 12, 0.7, 0, 7); g.fill(); }
}

// Tiles 36-39: icicles hanging down, and frozen spikes pointing up, left and right.
function drawIcicles(g, x, y, dir) {
  g.save();
  g.translate(x + 6, y + 6);
  g.rotate([0, Math.PI / 2, Math.PI, -Math.PI / 2][dir]);
  g.fillStyle = grad(g, 0, -6, 0, 6, [[0, PAINT.iceLight], [1, PAINT.iceDark]]);
  g.beginPath();
  g.moveTo(-6, -6);
  for (let i = 0; i < 4; i++) {
    const len = [8, 11, 7, 10][i];
    g.lineTo(-6 + i * 3 + 1.5, -6 + len);
    g.lineTo(-6 + (i + 1) * 3, -6);
  }
  g.closePath();
  g.fill();
  g.restore();
}

function drawCrate(g, x, y) {
  g.fillStyle = grad(g, x, y, x + T, y + T, [[0, PAINT.woodLight], [1, PAINT.woodDark]]);
  rrect(g, x + 0.3, y + 0.3, T - 0.6, T - 0.6, 0.8); g.fill();
  g.strokeStyle = PAINT.woodDark;
  g.lineWidth = 1;
  g.strokeRect(x + 1.2, y + 1.2, T - 2.4, T - 2.4);
  g.beginPath(); g.moveTo(x + 1.5, y + 1.5); g.lineTo(x + T - 1.5, y + T - 1.5);
  g.moveTo(x + T - 1.5, y + 1.5); g.lineTo(x + 1.5, y + T - 1.5); g.stroke();
}

function drawSteelGem(g, x, y, t) {
  g.fillStyle = grad(g, x, y, x + T, y + T, [[0, PAINT.steelLight], [0.5, PAINT.steel], [1, PAINT.steelDark]]);
  rrect(g, x + 0.3, y + 0.3, T - 0.6, T - 0.6, 1.2); g.fill();
  g.fillStyle = PAINT.steelDark;
  [[1.8, 1.8], [10.2, 1.8], [1.8, 10.2], [10.2, 10.2]].forEach(([a, b]) => { g.beginPath(); g.arc(x + a, y + b, 0.6, 0, 7); g.fill(); });
  g.save();
  g.shadowColor = '#3ad0ff'; g.shadowBlur = 3 + Math.sin(t * 3) * 1.5;
  g.fillStyle = grad(g, x + 4, y + 4, x + 8, y + 8, [[0, '#bff2ff'], [0.5, '#22b8e8'], [1, '#08506a']]);
  rrect(g, x + 4, y + 4, 4, 4, 0.8); g.fill();
  g.restore();
}

function drawGoldBlock(g, x, y) {
  g.fillStyle = grad(g, x, y, x + T, y + T, [[0, PAINT.goldLight], [0.4, PAINT.gold], [1, PAINT.goldDark]]);
  rrect(g, x + 0.3, y + 0.3, T - 0.6, T - 0.6, 1.2); g.fill();
  g.strokeStyle = 'rgba(120, 70, 0, 0.6)';
  g.lineWidth = 0.6;
  g.strokeRect(x + 2.5, y + 2.5, T - 5, T - 5);
}

// Coloured blocks 71 and 74-79, teleporter pads 6-8 and floor switches 33-35. Colour names follow the original.
const HUE = {
  magenta: ['#ff8af0', '#d020c0', '#600060'], blue: ['#6a8cff', '#1630d8', '#06106a'],
  red: ['#ff7a7a', '#d81020', '#600008'], teal: ['#8affff', '#10b0b0', '#055a5a'],
  orange: ['#ffd08a', '#f08a10', '#7a3a00'], green: ['#9aff8a', '#20c020', '#0a5a0a'],
};
const BARRIER_HUE = ['blue', 'red', 'teal'];
const PAD_HUE = ['orange', 'magenta', 'green'];

function drawColorBlock(g, x, y, hue, t, pulse) {
  const [l, m, d] = HUE[hue];
  g.save();
  if (pulse) { g.shadowColor = m; g.shadowBlur = 3 + Math.sin(t * 5) * 1.5; }
  g.fillStyle = grad(g, x, y, x + T, y + T, [[0, l], [0.45, m], [1, d]]);
  rrect(g, x + 0.3, y + 0.3, T - 0.6, T - 0.6, 1.4); g.fill();
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.25)';
  rrect(g, x + 1.5, y + 1.2, T - 3, 2, 1); g.fill();
}

// A barrier is a wall of coloured light between two emitters; switched off, only the emitters stay.
function drawBarrier(g, x, y, c, on, t) {
  const [l, m, d] = HUE[BARRIER_HUE[c]];
  if (on) {
    g.save();
    g.shadowColor = m; g.shadowBlur = 4;
    g.fillStyle = grad(g, x, 0, x + T, 0, [[0, d], [0.5, m], [1, d]]);
    g.globalAlpha = 0.85;
    g.fillRect(x + 1.2, y, T - 2.4, T);
    g.globalAlpha = 1;
    g.restore();
    g.strokeStyle = l; g.lineWidth = 0.5;
    for (let i = 0; i < 3; i++) {
      const yy = y + ((t * 14 + i * 4 + x) % 12);
      g.globalAlpha = 0.6;
      g.beginPath(); g.moveTo(x + 1.5, yy); g.lineTo(x + T - 1.5, yy); g.stroke();
    }
    g.globalAlpha = 1;
  }
  g.fillStyle = grad(g, x, 0, x + 2, 0, [[0, PAINT.steelLight], [1, PAINT.steelDark]]);
  g.fillRect(x, y, 1.4, T);
  g.fillRect(x + T - 1.4, y, 1.4, T);
  g.fillStyle = on ? l : d;
  g.fillRect(x + 0.3, y + 5, 0.8, 2);
  g.fillRect(x + T - 1.1, y + 5, 0.8, 2);
}

// Wall buttons 9-14: a coloured jewel in a steel plate, with the lever up while that colour's barriers are on.
function drawButton(g, x, y, c, on, t) {
  const [l, m, d] = HUE[BARRIER_HUE[c]];
  g.fillStyle = grad(g, x + 2, y + 2, x + 10, y + 10, [[0, PAINT.steelLight], [1, PAINT.steelDark]]);
  rrect(g, x + 2, y + 2.5, 8, 8, 1.6); g.fill();
  g.save();
  g.shadowColor = m; g.shadowBlur = on ? 3 + Math.sin(t * 4) : 1;
  g.fillStyle = grad(g, x + 4, y + 4.5, x + 8, y + 8.5, [[0, l], [0.5, m], [1, d]]);
  g.beginPath(); g.arc(x + 6, y + 6.5, 2.2, 0, 7); g.fill();
  g.restore();
  g.strokeStyle = PAINT.steelDark; g.lineWidth = 0.9; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x + 9, y + 6.5);
  g.lineTo(x + 11, on ? y + 3.5 : y + 9.5); g.stroke();
}

// Teleporter pads 6-8: a glowing ring on the floor with sparks rising off it.
function drawPad(g, x, y, c, t) {
  const [l, m] = HUE[PAD_HUE[c]];
  g.save();
  g.shadowColor = m; g.shadowBlur = 4;
  g.fillStyle = grad(g, 0, y + 9.5, 0, y + 12, [[0, l], [1, m]]);
  g.beginPath(); g.ellipse(x + 6, y + 10.8, 5.4, 1.2, 0, 0, 7); g.fill();
  g.restore();
  for (let i = 0; i < 4; i++) {
    const k = (t * 0.8 + i / 4 + hash(x, y, i)) % 1;
    g.globalAlpha = 0.8 * (1 - k);
    g.fillStyle = l;
    g.beginPath(); g.arc(x + 2 + hash(x, i, 3) * 8, y + 10 - k * 9, 0.5, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}

// Floor switches 33-35: a small jewel set in the floor; monsters press them too.
function drawFloorSwitch(g, x, y, c, t) {
  drawGem(g, x, y, ['b', 'r', 'g'][c], 1, false);
  const [, m] = HUE[BARRIER_HUE[c]];
  g.strokeStyle = m; g.globalAlpha = 0.5 + 0.3 * Math.sin(t * 3); g.lineWidth = 0.4;
  g.beginPath(); g.ellipse(x + 6, y + 11.2, 3.5, 0.8, 0, 0, 7); g.stroke();
  g.globalAlpha = 1;
}

// Conveyors 114-119: rollers along the top edge, turning the way the belt carries you.
function drawConveyorTop(g, x, y, dir, t) {
  g.fillStyle = '#2b2f35';
  g.fillRect(x, y, T, 2.4);
  const off = ((t * 40 * dir) % 3 + 3) % 3;
  g.fillStyle = '#c9d0d6';
  for (let i = -1; i < 5; i++) {
    const cx = x + i * 3 + off;
    if (cx < x - 1 || cx > x + T + 1) continue;
    g.fillRect(Math.max(x, cx), y + 0.6, Math.min(1.2, x + T - cx), 1.2);
  }
}

// ---------- the exit door ----------

// open: 0 shut, 1 fully open. The door is 2 x 2 tiles with its top-left at x, y.
function drawDoor(g, x, y, open, t) {
  const W = 24;
  // stone arch
  g.fillStyle = grad(g, x, 0, x + W, 0, [[0, PAINT.stoneDark], [0.5, PAINT.stoneLight], [1, PAINT.stoneDark]]);
  g.beginPath();
  g.moveTo(x + 1, y + W); g.lineTo(x + 1, y + 10); g.arc(x + 12, y + 10, 11, Math.PI, 0); g.lineTo(x + 23, y + W);
  g.closePath(); g.fill();
  // the glow behind the doors
  g.save();
  g.beginPath();
  g.moveTo(x + 3.5, y + W); g.lineTo(x + 3.5, y + 10.5); g.arc(x + 12, y + 10.5, 8.5, Math.PI, 0); g.lineTo(x + 20.5, y + W);
  g.closePath();
  g.clip();
  g.fillStyle = grad(g, 0, y + 2, 0, y + W, [[0, '#1a2a8a'], [0.5, '#3a6aff'], [0.8, '#ff3a5a'], [1, '#c01030']]);
  g.fillRect(x, y, W, W);
  for (let i = 0; i < 6; i++) {
    const sx = x + 5 + hash(i, 1, 2) * 14, sy = y + 4 + ((hash(i, 2, 2) * 20 + t * 8) % 20);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.arc(sx, sy, 0.5, 0, 7); g.fill();
  }
  // two wooden doors that swing open
  const w = 8.5 * (1 - open);
  for (const side of [-1, 1]) {
    const hx = side < 0 ? x + 3.5 : x + 20.5;
    g.fillStyle = grad(g, hx, 0, hx - side * w, 0, [[0, PAINT.woodDark], [0.5, PAINT.woodLight], [1, PAINT.wood]]);
    g.fillRect(Math.min(hx, hx - side * w), y + 2, w, W - 2);
    if (w > 2) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let k = 1; k < 3; k++) g.fillRect(Math.min(hx, hx - side * w) + (w * k) / 3, y + 2, 0.4, W - 2);
      g.fillStyle = PAINT.gold;
      g.beginPath(); g.arc(hx - side * (w - 1.4), y + 15, 0.7, 0, 7); g.fill();
    }
  }
  g.restore();
  // garland with lights
  g.strokeStyle = PAINT.moss;
  g.lineWidth = 1.6;
  g.beginPath(); g.arc(x + 12, y + 10, 10, Math.PI, 0); g.stroke();
  const colors = ['#ff4040', '#ffd040', '#40c0ff', '#60ff60'];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    const on = (Math.floor(t * 3) + i) % 2 === 0;
    g.save();
    g.fillStyle = colors[i % 4];
    if (on) { g.shadowColor = colors[i % 4]; g.shadowBlur = 3; } else g.globalAlpha = 0.45;
    g.beginPath(); g.arc(x + 12 + Math.cos(a) * 10, y + 10 + Math.sin(a) * 10, 0.9, 0, 7); g.fill();
    g.restore();
  }
}

// ---------- tile dispatch ----------

// Tiles drawn every frame instead of into the level's backing canvas: they animate, change while
// playing, or (26-32) sit in front of Santa and the monsters.
const LIVE = new Set([2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 33, 34, 35, 74, 75, 76, 77, 78, 79]);
const FRONT = (t) => t >= 26 && t <= 32;

// cell is the raw map byte: bit 0x80 marks a dug brick or a switched-off barrier.
function drawTile(g, cell, x, y, cx, cy, t = 0) {
  const tile = cell & 0x7f, off = cell & 0x80;
  if (tile >= 74 && tile <= 79) return drawBarrier(g, x, y, (tile - 74) >> 1, !off, t);
  if (off) return;
  if (SHAPES[tile]) {
    drawBlock(g, x, y, SHAPES[tile], cx, cy);
    if (tile >= 114) drawConveyorTop(g, x, y, tile <= 116 ? -1 : 1, t);
    return;
  }
  switch (tile) {
    case 0: return;
    case 1: case 2: case 3: return drawLadder(g, x, y, tile, t);
    case 4: return drawGift(g, x, y, t);
    case 5: return drawTable(g, x, y);
    case 6: case 7: case 8: return drawPad(g, x, y, tile - 6, t);
    case 9: case 10: case 11: case 12: case 13: case 14: return drawButton(g, x, y, (tile - 9) >> 1, tile % 2 === 1, t);
    case 15: return drawTank(g, x, y, true);
    case 16: return drawTank(g, x, y, false);
    case 17: return drawGrid(g, x, y, false, t);
    case 18: return drawGrid(g, x, y, true, t);
    case 19: return drawStunner(g, x, y, t);
    case 20: return drawCoin(g, x, y, t);
    case 21: return drawGoldPile(g, x, y);
    case 22: return drawVase(g, x, y);
    case 23: return drawStatue(g, x, y, t);
    case 24: g.fillStyle = 'rgba(200, 210, 220, 0.5)'; g.fillRect(x + 4.5, y + 11, 1.2, 1); g.fillRect(x + 7, y + 11, 1.2, 1); return;
    case 25: g.fillStyle = '#000'; g.fillRect(x, y, T, T); return;
    case 26: return drawIceLedge(g, x, y);
    case 27: return drawPillar(g, x, y);
    case 28: case 72: return drawSteelGem(g, x, y, t);
    case 29: return drawVines(g, x, y, cx, cy);
    case 33: case 34: case 35: return drawFloorSwitch(g, x, y, tile - 33, t);
    case 36: return drawIcicles(g, x, y, 0);
    case 37: return drawIcicles(g, x, y, 3);
    case 38: return drawIcicles(g, x, y, 2);
    case 39: return drawIcicles(g, x, y, 1);
    case 70: return drawCrate(g, x, y);
    case 71: return drawColorBlock(g, x, y, 'magenta', t, false);
    case 73: return drawGoldBlock(g, x, y);
  }
}

// ---------- shading for a whole level ----------

const SOLID_LOOK = (c) => c >= 0 && !(c & 0x80) && (!!SHAPES[c] || c === 25 || c === 70 || c === 71 || c === 72 || c === 73);

// Draws every static tile of a cols x rows map onto g, with soft shadows under the blocks and light
// on their exposed top edges. tileAt(cx, cy) returns the tile, or -1 off the map.
function drawLevelStatic(g, cols, rows, tileAt, skip) {
  drawCave(g, cols, rows);
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.6)';
  g.shadowBlur = 4;
  g.shadowOffsetY = 1.5 * (g.getTransform().a || 1);
  g.fillStyle = '#000';
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const t = tileAt(cx, cy);
    if (!SOLID_LOOK(t)) continue;
    blockPath(g, cx * T, cy * T, SHAPES[t] ? SHAPES[t][2] : 0);
    g.fill();
  }
  g.restore();
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const t = tileAt(cx, cy);
    if (skip && skip(t)) continue;
    drawTile(g, t, cx * T, cy * T, cx, cy, 0);
  }
  // exposed top edges catch the light, exposed bottoms fall into shade
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const t = tileAt(cx, cy);
    if (!SHAPES[t] || SHAPES[t][3]) continue;
    const x = cx * T, y = cy * T;
    g.save();
    blockPath(g, x, y, SHAPES[t][2]);
    g.clip();
    const up = tileAt(cx, cy - 1), down = tileAt(cx, cy + 1);
    if (up >= 0 && !SOLID_LOOK(up)) { g.fillStyle = grad(g, 0, y, 0, y + 2.5, [[0, 'rgba(255,240,220,0.45)'], [1, 'rgba(255,240,220,0)']]); g.fillRect(x, y, T, 2.5); }
    if (down >= 0 && !SOLID_LOOK(down)) { g.fillStyle = grad(g, 0, y + T - 3, 0, y + T, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.4)']]); g.fillRect(x, y + T - 3, T, 3); }
    g.restore();
  }
}

// ---------- Santa ----------

const SUIT = { red: '#d8262e', redLight: '#ff5a50', redDark: '#86101a', fur: '#f6f3ee', furShade: '#c9c2ba',
  skin: '#f2b48c', boot: '#1d1a1f', belt: '#1d1a1f', buckle: '#ffd040', pack: '#a3acb6', packDark: '#5d6670' };

// x, y is the top-left of Santa's 12 x 12 box. s: { face: 1 right / -1 left, walk: phase in radians,
// mode: 'stand' | 'walk' | 'fly' | 'climb', thrust: 0..1, shield: bool, blink: bool, phase: bool }
function drawSanta(g, x, y, s, t) {
  g.save();
  g.translate(x + 6, y + 12);
  if (s.mode === 'climb') { drawSantaClimbing(g, s, t); g.restore(); return; }
  g.scale(s.face, 1);
  const swing = s.mode === 'walk' ? Math.sin(s.walk) : 0;
  const tuck = s.mode === 'fly' ? 1 : 0;

  // jetpack flame
  if (s.thrust > 0) {
    const fl = 2.5 + s.thrust * 3 + Math.sin(t * 40) * 0.8;
    g.save();
    g.shadowColor = '#ffb040'; g.shadowBlur = 4;
    g.fillStyle = grad(g, 0, -4, 0, -4 + fl, [[0, '#fff6c0'], [0.4, '#ffb030'], [1, 'rgba(255,60,20,0)']]);
    g.beginPath();
    g.moveTo(-5.6, -4); g.quadraticCurveTo(-4.6, -4 + fl, -3.6, -4);
    g.fill();
    g.restore();
  }
  // jetpack on his back
  g.fillStyle = grad(g, -6, 0, -3, 0, [[0, SUIT.packDark], [0.5, SUIT.pack], [1, SUIT.packDark]]);
  rrect(g, -6.3, -9.5, 3, 6, 1); g.fill();
  g.fillStyle = '#e23b3b';
  g.fillRect(-6.3, -7.3, 3, 0.8);

  // legs and boots
  for (const [hip, k] of [[-1.3, swing], [1.3, -swing]]) {
    const fx = hip + k * 1.8 + tuck * 0.8, fy = -0.9 - tuck * 1.2;
    g.strokeStyle = SUIT.redDark; g.lineWidth = 1.9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(hip, -4); g.lineTo(fx, fy); g.stroke();
    g.fillStyle = SUIT.boot;
    rrect(g, fx - 1, fy - 0.4, 2.6, 1.4, 0.6); g.fill();
  }
  // body
  g.fillStyle = grad(g, -3, -9, 3, -3, [[0, SUIT.redLight], [0.5, SUIT.red], [1, SUIT.redDark]]);
  g.beginPath(); g.ellipse(0, -5.8, 3.6, 3.4, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = SUIT.fur;
  g.fillRect(-0.4, -9, 1.3, 5.6);
  g.fillStyle = SUIT.belt;
  g.fillRect(-3.4, -5, 6.8, 1.1);
  g.fillStyle = SUIT.buckle;
  g.fillRect(0.6, -5.1, 1.3, 1.3);
  // arm, reaching forward a little while flying
  g.strokeStyle = SUIT.red; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(1.5, -7.4); g.lineTo(3.4 + tuck, -5.6 - swing * 0.6 - tuck * 1.6); g.stroke();
  g.fillStyle = SUIT.fur;
  g.beginPath(); g.arc(3.6 + tuck, -5.4 - swing * 0.6 - tuck * 1.6, 0.8, 0, 7); g.fill();
  // head
  g.fillStyle = SUIT.skin;
  g.beginPath(); g.arc(0.6, -10, 1.9, 0, 7); g.fill();
  g.fillStyle = SUIT.fur;
  g.beginPath(); g.moveTo(-0.6, -10.2); g.quadraticCurveTo(1, -6.6, 3, -9.6); g.quadraticCurveTo(1.6, -9.4, -0.6, -10.2); g.fill();
  g.fillStyle = SUIT.boot;
  g.beginPath(); g.arc(1.6, -10.6, 0.35, 0, 7); g.fill();
  // hat, flopping backwards
  g.fillStyle = grad(g, -2, -14, 2, -11, [[0, SUIT.redLight], [1, SUIT.red]]);
  g.beginPath(); g.moveTo(-1.6, -11.2); g.quadraticCurveTo(-0.5, -14.4, 2.4, -11.6); g.lineTo(-1.6, -11.2);
  g.quadraticCurveTo(-3, -12.6, -3.4, -11.4); g.fill();
  g.fillStyle = SUIT.fur;
  rrect(g, -1.9, -11.9, 4.7, 1.1, 0.5); g.fill();
  g.beginPath(); g.arc(-3.5, -11.2, 0.9, 0, 7); g.fill();

  g.restore();
  if (s.shield) drawShield(g, x, y, t, s.blink);
}

function drawSantaClimbing(g, s, t) {
  const k = Math.sin(s.walk);
  // seen from behind: jetpack in the middle of his back, arms and legs alternating on the rungs
  g.strokeStyle = SUIT.redDark; g.lineWidth = 1.9; g.lineCap = 'round';
  for (const [hip, d] of [[-1.5, k], [1.5, -k]]) {
    g.beginPath(); g.moveTo(hip, -4); g.lineTo(hip * 1.3, -1 + d * 1.2); g.stroke();
    g.fillStyle = SUIT.boot; rrect(g, hip * 1.3 - 1.2, -1.4 + d * 1.2, 2.4, 1.4, 0.6); g.fill();
  }
  g.fillStyle = grad(g, -3, -9, 3, -3, [[0, SUIT.redLight], [0.5, SUIT.red], [1, SUIT.redDark]]);
  g.beginPath(); g.ellipse(0, -5.8, 3.6, 3.4, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = SUIT.red; g.lineWidth = 1.6;
  for (const [sx, d] of [[-2.6, -k], [2.6, k]]) {
    g.beginPath(); g.moveTo(sx, -7.6); g.lineTo(sx * 1.6, -9.6 + d * 1.4); g.stroke();
    g.fillStyle = SUIT.fur; g.beginPath(); g.arc(sx * 1.6, -9.8 + d * 1.4, 0.8, 0, 7); g.fill();
  }
  g.fillStyle = grad(g, -1.6, 0, 1.6, 0, [[0, SUIT.packDark], [0.5, SUIT.pack], [1, SUIT.packDark]]);
  rrect(g, -1.6, -9.2, 3.2, 5.6, 1); g.fill();
  g.fillStyle = SUIT.fur;
  g.beginPath(); g.arc(0, -10.2, 1.9, 0, 7); g.fill();
  g.fillStyle = SUIT.red;
  g.beginPath(); g.moveTo(-1.8, -11.2); g.quadraticCurveTo(0, -14.6, 1.8, -11.2); g.fill();
  g.fillStyle = SUIT.fur;
  rrect(g, -2, -11.8, 4, 1.1, 0.5); g.fill();
  g.beginPath(); g.arc(0.6, -13.6, 0.8, 0, 7); g.fill();
}

function drawShield(g, x, y, t, blink) {
  if (blink && Math.floor(t * 12) % 2) return;
  g.save();
  const r = 8 + Math.sin(t * 6) * 0.4;
  const gr = g.createRadialGradient(x + 6, y + 6, r * 0.5, x + 6, y + 6, r);
  gr.addColorStop(0, 'rgba(120, 220, 255, 0)');
  gr.addColorStop(0.8, 'rgba(120, 220, 255, 0.25)');
  gr.addColorStop(1, 'rgba(200, 245, 255, 0.7)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(x + 6, y + 6, r, 0, 7); g.fill();
  g.restore();
}

// Santa bursting apart when he dies: k runs 0..1.
function drawSantaBurst(g, x, y, k) {
  for (let i = 0; i < 16; i++) {
    const a = hash(i, 1, 4) * Math.PI * 2, d = k * (6 + hash(i, 2, 4) * 10);
    const px = x + 6 + Math.cos(a) * d, py = y + 6 + Math.sin(a) * d + k * k * 6;
    g.globalAlpha = 1 - k;
    g.fillStyle = [SUIT.red, SUIT.fur, SUIT.redDark, SUIT.pack][i % 4];
    g.beginPath(); g.arc(px, py, 1.2 * (1 - k * 0.5), 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}

// ---------- monsters ----------

// Drawn from the original's frame number (monsters.md, "Sprite frames"), so the game logic can
// pick frames exactly as the original does. x, y is the top-left of the monster's 12 x 12 box.
function drawMonster(g, f, x, y, t, flash) {
  g.save();
  g.translate(x + 6, y + 6);
  if (flash) g.globalAlpha = 0.45 + 0.4 * Math.abs(Math.sin(t * 30));
  if (f <= 3) drawSteelBall(g, f, t);
  else if (f <= 11) drawTrackbot(g, f, t);
  else if (f <= 15) drawSpring(g, f);
  else if (f <= 18) drawSpikes(g, f, t);
  else if (f <= 20) drawHomer(g, f, t);
  else if (f <= 32) drawMissile(g, f, t);
  else if (f <= 41) drawFlitzer(g, f, t);
  else drawBatbot(g, f, t);
  g.restore();
}

// A snow globe: blue glass over a silver base, with flakes that turn as it rolls.
function drawSteelBall(g, f, t) {
  const R = 5.8;
  g.save();
  g.beginPath(); g.arc(0, 0, R, 0, 7); g.clip();
  g.fillStyle = grad(g, 0, -R, 0, R, [[0, '#bff0ff'], [0.45, '#2aa8e8'], [0.55, '#dfe5ea'], [1, '#6c757e']]);
  g.fillRect(-R, -R, 2 * R, 2 * R);
  const spin = f === 3 ? 0 : f * 2.1;
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 5; i++) {
    const a = spin + i * 1.26;
    g.beginPath(); g.arc(Math.cos(a) * 3, -1.6 + Math.sin(a) * 1.6, 0.45, 0, 7); g.fill();
  }
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.beginPath(); g.ellipse(-2.2, -3.2, 1.8, 0.9, -0.6, 0, 7); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.4;
  g.beginPath(); g.arc(0, 0, R, 0, 7); g.stroke();
}

// Small tracked robot with a red beacon. 4-6 walk right, 7-9 walk left, 10-11 climb.
function drawTrackbot(g, f, t) {
  const climb = f >= 10, left = f >= 7 && f <= 9, step = climb ? f - 10 : (f - 4) % 3;
  if (left) g.scale(-1, 1);
  // tracks
  g.fillStyle = '#2b2f35';
  rrect(g, -5.5, 3, 11, 3, 1.5); g.fill();
  g.fillStyle = '#8b939c';
  for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(-4 + i * 2 + (climb ? 0 : step * 0.66), 4.5, 0.6, 0, 7); g.fill(); }
  // body
  g.fillStyle = grad(g, -4, -3, 4, 3, [[0, '#d7dde3'], [0.5, '#8f98a2'], [1, '#4d555e']]);
  rrect(g, -4, -3, 8, 6.5, 1.6); g.fill();
  // head and eyes
  g.fillStyle = grad(g, -2.5, -6, 2.5, -3, [[0, '#c8d0d8'], [1, '#6b737c']]);
  rrect(g, -2.6, -6, 5.2, 3.2, 1); g.fill();
  if (!climb) {
    g.fillStyle = '#ffd23a'; g.fillRect(0.6, -5, 1.3, 1.1);
    g.fillStyle = '#3a8aff'; g.fillRect(-1.6, -5, 1.3, 1.1);
  }
  // beacon
  g.save();
  g.shadowColor = '#ff3030'; g.shadowBlur = 3;
  g.fillStyle = Math.floor(t * 6) % 2 ? '#ff3030' : '#b01818';
  g.beginPath(); g.arc(0, -6.8, 0.9, 0, 7); g.fill();
  g.restore();
  if (climb) {
    g.strokeStyle = '#8f98a2'; g.lineWidth = 1; g.lineCap = 'round';
    const k = step ? 1 : -1;
    g.beginPath(); g.moveTo(-4, -1); g.lineTo(-5.5, -3 + k * 1.5); g.moveTo(4, -1); g.lineTo(5.5, -3 - k * 1.5); g.stroke();
  }
}

// A coiled spring: squashed at rest (12 on the floor, 15 under a ceiling), stretched in flight.
function drawSpring(g, f) {
  const rest = f === 12 || f === 15;
  const h = rest ? 4 : 10, top = f === 15 ? -6 : f === 12 ? 6 - h : -5;
  g.strokeStyle = grad(g, -4, 0, 4, 0, [[0, '#6b737c'], [0.5, '#eef2f5'], [1, '#6b737c']]);
  g.lineWidth = 1.3; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  const coils = 4;
  for (let i = 0; i <= coils * 2; i++) {
    const yy = top + (h * i) / (coils * 2), xx = i % 2 ? 3.4 : -3.4;
    if (i === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
  }
  g.stroke();
  g.fillStyle = '#4d555e';
  rrect(g, -4, f === 15 ? top - 1 : top + h - 0.2, 8, 1.2, 0.5); g.fill();
}

// A spinning burr of coloured spikes around a purple core.
function drawSpikes(g, f, t) {
  g.rotate((f - 16) * 0.7 + t * 2);
  const tips = ['#30e050', '#ffd23a', '#3a7aff', '#30e050', '#ffd23a', '#3a7aff'];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.fillStyle = '#b8c0c8';
    g.beginPath();
    g.moveTo(Math.cos(a - 0.35) * 2, Math.sin(a - 0.35) * 2);
    g.lineTo(Math.cos(a) * 5.6, Math.sin(a) * 5.6);
    g.lineTo(Math.cos(a + 0.35) * 2, Math.sin(a + 0.35) * 2);
    g.fill();
    g.fillStyle = tips[i];
    g.beginPath(); g.arc(Math.cos(a) * 5.2, Math.sin(a) * 5.2, 0.9, 0, 7); g.fill();
  }
  g.fillStyle = grad(g, -2.5, -2.5, 2.5, 2.5, [[0, '#d08aff'], [1, '#5a10a0']]);
  g.beginPath(); g.arc(0, 0, 2.6, 0, 7); g.fill();
}

// A small glowing eye that drifts through walls.
function drawHomer(g, f, t) {
  const open = f === 19;
  g.save();
  g.shadowColor = '#ff2040'; g.shadowBlur = 5 + Math.sin(t * 4) * 2;
  g.fillStyle = grad(g, 0, -3, 0, 3, [[0, '#ffffff'], [1, '#b8c0c8']]);
  g.beginPath(); g.ellipse(0, 0, open ? 2.4 : 3.2, open ? 3.2 : 2.4, 0, 0, 7); g.fill();
  g.restore();
  g.fillStyle = '#e01030';
  g.beginPath(); g.arc(0, 0, 1.3, 0, 7); g.fill();
  g.fillStyle = '#300008';
  g.beginPath(); g.arc(0, 0, 0.6, 0, 7); g.fill();
}

// Candy-cane rocket. 21-23 up, 24-26 right, 27-29 down, 30-32 left.
function drawMissile(g, f, t) {
  const d = Math.floor((f - 21) / 3), k = (f - 21) % 3;
  g.rotate(d * Math.PI / 2);
  // exhaust
  g.save();
  g.shadowColor = '#ffa030'; g.shadowBlur = 4;
  g.fillStyle = grad(g, 0, 4, 0, 7 + k, [[0, '#fff2a0'], [0.5, '#ff7020'], [1, 'rgba(255,40,0,0)']]);
  g.beginPath(); g.moveTo(-1.8, 4); g.quadraticCurveTo(0, 8 + k, 1.8, 4); g.fill();
  g.restore();
  // fins
  g.fillStyle = '#9aa3ad';
  g.beginPath(); g.moveTo(-1.8, 1); g.lineTo(-4.2, 4.4); g.lineTo(-1.8, 4); g.fill();
  g.beginPath(); g.moveTo(1.8, 1); g.lineTo(4.2, 4.4); g.lineTo(1.8, 4); g.fill();
  // striped body
  g.save();
  rrect(g, -2, -5, 4, 9.4, [2, 2, 0.6, 0.6]); g.clip();
  g.fillStyle = '#f6f3ee'; g.fillRect(-2, -6, 4, 11);
  for (let i = -4; i < 6; i++) {
    g.fillStyle = i % 2 ? '#20a040' : '#e02030';
    g.beginPath(); g.moveTo(-2, i * 2 - 1); g.lineTo(2, i * 2 - 2.4); g.lineTo(2, i * 2 - 1.6); g.lineTo(-2, i * 2 - 0.2); g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-1.6, -5, 0.8, 9);
  g.restore();
  g.fillStyle = '#e02030';
  g.beginPath(); g.moveTo(-2, -4.4); g.quadraticCurveTo(0, -7.4, 2, -4.4); g.fill();
}

// A blue snowflake with a pink dot showing where it is heading (33 stopped, 34-41 eight ways).
function drawFlitzer(g, f, t) {
  g.save();
  g.rotate(t * 1.5);
  g.shadowColor = '#5070ff'; g.shadowBlur = 4;
  g.strokeStyle = '#7a98ff'; g.lineWidth = 1.1; g.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(c * 5.2, s * 5.2); g.stroke();
    g.beginPath(); g.moveTo(c * 3.2, s * 3.2);
    g.lineTo(c * 3.2 + Math.cos(a + 0.9) * 1.4, s * 3.2 + Math.sin(a + 0.9) * 1.4);
    g.moveTo(c * 3.2, s * 3.2);
    g.lineTo(c * 3.2 + Math.cos(a - 0.9) * 1.4, s * 3.2 + Math.sin(a - 0.9) * 1.4);
    g.stroke();
  }
  g.restore();
  g.fillStyle = '#d8e0ff';
  g.beginPath(); g.arc(0, 0, 1.4, 0, 7); g.fill();
  if (f > 33) {
    const a = -Math.PI / 2 + (f - 34) * Math.PI / 4;
    g.save();
    g.shadowColor = '#ff4aa0'; g.shadowBlur = 3;
    g.fillStyle = '#ff4aa0';
    g.beginPath(); g.arc(Math.cos(a) * 4.6, Math.sin(a) * 4.6, 1.3, 0, 7); g.fill();
    g.restore();
  }
}

// A flat bat-winged drone hugging the top of its square; 42-47 flap.
function drawBatbot(g, f, t) {
  const flap = [0, 1, 2, 3, 2, 1][f - 42] / 3;
  g.translate(0, -3.5);
  g.fillStyle = grad(g, -6, 0, 6, 0, [[0, '#5d6670'], [0.5, '#c8d0d8'], [1, '#5d6670']]);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(s * 3, -1.5 - flap * 1.5, s * 6, -0.5 + flap * 2.5);
    g.lineTo(s * 4.2, 0.8 + flap);
    g.lineTo(s * 2.6, 0.4);
    g.lineTo(s * 1.5, 1.4);
    g.closePath();
    g.fill();
  }
  g.save();
  g.shadowColor = '#ff3a8a'; g.shadowBlur = 3;
  g.fillStyle = '#ff3a8a';
  g.beginPath(); g.ellipse(0, 0.6, 1.6, 1.1, 0, 0, 7); g.fill();
  g.restore();
  // radar ping
  const r = (t * 8) % 8;
  g.strokeStyle = `rgba(255, 90, 160, ${0.5 * (1 - r / 8)})`;
  g.lineWidth = 0.4;
  g.beginPath(); g.arc(0, 0.6, r, 0.2, Math.PI - 0.2); g.stroke();
}

// The random pickups: 0 Shield, 1 Stunner, 2 fuel can. They pulse so they stand out.
function drawPickup(g, kind, x, y, t, fading) {
  if (fading && Math.floor(t * 10) % 2) return;
  g.save();
  g.translate(x + 6, y + 6);
  const s = 1 + Math.sin(t * 6) * 0.06;
  g.scale(s, s);
  g.shadowColor = ['#60d0ff', '#ffffff', '#ffd040'][kind];
  g.shadowBlur = 5;
  if (kind === 0) {
    g.fillStyle = grad(g, -4, -5, 4, 5, [[0, '#c8f0ff'], [0.5, '#3aa8ff'], [1, '#1040a0']]);
    g.beginPath(); g.moveTo(0, -5); g.lineTo(4.4, -3.4); g.quadraticCurveTo(4, 2.6, 0, 5.4); g.quadraticCurveTo(-4, 2.6, -4.4, -3.4); g.closePath(); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(-0.5, -3, 1, 6); g.fillRect(-2.5, -0.8, 5, 1);
  } else if (kind === 1) {
    g.fillStyle = grad(g, -4, -4, 4, 4, [[0, '#ffffff'], [1, '#6c757e']]);
    g.beginPath(); g.arc(0, 0, 4, 0, 7); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#3ab0ff'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-2, -2.4); g.lineTo(0.6, -0.4); g.lineTo(-0.6, 0.4); g.lineTo(2, 2.4); g.stroke();
  } else {
    g.fillStyle = grad(g, -3, 0, 3, 0, [[0, '#8a6a10'], [0.4, '#ffe070'], [1, '#8a6a10']]);
    rrect(g, -3, -3.4, 6, 8, 1.2); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#5a4008'; g.fillRect(-1, -5, 2, 1.8);
    g.fillStyle = '#e23b3b'; g.fillRect(-3, -0.6, 6, 1.6);
  }
  g.restore();
}

// ---------- Santa, from the original's frame numbers ----------

// santa-movement.md "Santa's sprite frames": 0-3 / 24-27 walk, 4-9 / 28-33 jet, 10-15 / 34-39 and
// 52-60 Phase Shifter, 16-17 / 40-41 / 61 jump, 48-51 climb, 65-70 dance, 72-95 dying.
function santaPose(f) {
  const left = (f >= 24 && f < 48);
  const b = left ? f - 24 : f;
  if (f >= 65 && f <= 70) return { mode: 'dance', face: f % 2 ? 1 : -1, walk: f };
  if (f >= 48 && f <= 51) return { mode: 'climb', face: 1, walk: (f - 48) * Math.PI / 2 };
  if (f >= 52 && f <= 57) return { mode: f >= 55 ? 'fly' : 'stand', face: 1, thrust: f >= 55 ? 1 : 0, dig: 'up', walk: 0 };
  if (f >= 58 && f <= 60) return { mode: 'stand', face: 1, dig: 'down', walk: 0 };
  if (f === 61) return { mode: 'jump', face: 1, walk: 0 };
  const face = left ? -1 : 1;
  if (b <= 3) return { mode: b === 0 ? 'stand' : 'walk', face, walk: b * Math.PI / 2 };
  if (b <= 9) return { mode: 'fly', face, thrust: 1, walk: 0 };
  if (b <= 15) return { mode: b >= 13 ? 'fly' : 'stand', face, thrust: b >= 13 ? 1 : 0, dig: left ? 'left' : 'right', walk: 0 };
  if (b <= 17) return { mode: 'jump', face, walk: 0 };
  return { mode: 'stand', face, walk: 0 };
}

// The Phase Shifter beam: a crackle of light from Santa into the brick he's digging.
function drawPhaseBeam(g, x, y, dir, t) {
  const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  const sx = x + 6 + dx * 5, sy = y + 6 + dy * 5 - (dy === 0 ? 1 : 0);
  g.save();
  g.shadowColor = '#b080ff'; g.shadowBlur = 4;
  g.strokeStyle = '#e6d0ff'; g.lineWidth = 0.7;
  g.beginPath(); g.moveTo(sx, sy);
  for (let i = 1; i <= 4; i++) {
    const j = (hash(i, Math.floor(t * 30), 5) - 0.5) * 2;
    g.lineTo(sx + dx * i * 1.6 + dy * j, sy + dy * i * 1.6 + dx * j);
  }
  g.stroke();
  g.restore();
}

function drawSantaFrame(g, x, y, f, t, extra = {}) {
  if (f === 71) return;
  if (f >= 72) {
    const T4 = Math.floor((f - 72) / 6), k = ((f - 72) % 6 + 1) / 6;
    return drawSantaDeath(g, x, y, T4, k, t);
  }
  const p = santaPose(f);
  if (p.mode === 'dance') {
    g.save(); g.translate(x + 6, y + 12); g.rotate(Math.sin(t * 12) * 0.25); g.translate(-x - 6, -y - 12);
    drawSanta(g, x, y - Math.abs(Math.sin(t * 12)) * 2, { face: p.face, walk: t * 14, mode: 'walk', thrust: 0 }, t);
    g.restore();
    return;
  }
  if (extra.teleport) return drawSantaTeleport(g, x, y, p, extra.teleport, t);
  drawSanta(g, x, y, { face: p.face, walk: p.walk, mode: p.mode === 'jump' ? 'fly' : p.mode, thrust: p.thrust || 0, shield: extra.shield, blink: extra.shieldBlink }, t);
  if (p.dig) drawPhaseBeam(g, x, y, p.dig, t);
}

// The original draws a teleporting Santa in random colours of the pad's palette band. Here he
// glows in the pad's colour and fizzes, thinning out up to the jump at e = 20 and back after it.
function drawSantaTeleport(g, x, y, p, tp, t) {
  const [l, m] = HUE[PAD_HUE[tp.pad]];
  const k = Math.abs(tp.e - 20) / 20;
  g.save();
  g.globalAlpha = 0.25 + 0.75 * k;
  g.shadowColor = m; g.shadowBlur = 6;
  drawSanta(g, x, y, { face: p.face, walk: 0, mode: p.mode === 'climb' ? 'climb' : 'stand', thrust: 0 }, t);
  g.restore();
  for (let i = 0; i < 10; i++) {
    g.globalAlpha = 1 - k * 0.5;
    g.fillStyle = i % 2 ? l : m;
    g.beginPath(); g.arc(x + hash(i, Math.floor(t * 20), 1) * 12, y + hash(i, Math.floor(t * 20), 2) * 12, 0.5, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}

// The original has four death animations, picked at random. Here: burst, melt into a puddle,
// spin away, and fizzle to sparks. k runs 0..1.
function drawSantaDeath(g, x, y, kind, k, t) {
  if (kind === 0) return drawSantaBurst(g, x, y, k);
  g.save();
  if (kind === 1) {
    g.translate(x + 6, y + 12); g.scale(1 + k * 0.6, 1 - k * 0.85); g.translate(-x - 6, -y - 12);
    drawSanta(g, x, y, { face: 1, walk: 0, mode: 'stand', thrust: 0 }, t);
  } else if (kind === 2) {
    g.globalAlpha = 1 - k;
    g.translate(x + 6, y + 6); g.rotate(k * 12); g.scale(1 - k * 0.7, 1 - k * 0.7); g.translate(-x - 6, -y - 6);
    drawSanta(g, x, y, { face: 1, walk: 0, mode: 'stand', thrust: 0 }, t);
  } else {
    g.globalAlpha = 1 - k;
    drawSanta(g, x, y, { face: 1, walk: 0, mode: 'stand', thrust: 0 }, t);
    g.globalAlpha = 1;
    for (let i = 0; i < 12; i++) {
      g.fillStyle = '#ffe080';
      g.globalAlpha = k * (1 - k) * 4;
      g.beginPath(); g.arc(x + 6 + (hash(i, 7) - 0.5) * 14 * k, y + 6 - hash(i, 8) * 14 * k, 0.6, 0, 7); g.fill();
    }
  }
  g.restore();
}

// Santa assembling at the start of a life: specks fly in from random points. k runs 0..1.
function drawSantaAssemble(g, x, y, k, t) {
  g.save();
  g.globalAlpha = Math.max(0, (k - 0.6) / 0.4);
  drawSanta(g, x, y, { face: 1, walk: 0, mode: 'stand', thrust: 0 }, t);
  g.restore();
  for (let i = 0; i < 40; i++) {
    const a = hash(i, 3, 3) * Math.PI * 2, d = (1 - k) * (40 + hash(i, 4, 3) * 80);
    g.globalAlpha = Math.min(1, k * 3) * (1 - Math.max(0, (k - 0.8) / 0.2));
    g.fillStyle = [SUIT.red, SUIT.fur, '#ffd040'][i % 3];
    g.beginPath(); g.arc(x + 6 + Math.cos(a) * d + (hash(i, 5) - 0.5) * 8, y + 6 + Math.sin(a) * d + (hash(i, 6) - 0.5) * 10, 0.7, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}

// Dig progress on a brick: cracks while Santa holds the shifter, crumbling, and growing back.
// stage: { kind: 'hold' | 'crumble' | 'regrow', k: 0..1 }
function drawDigState(g, cell, x, y, cx, cy, stage, t) {
  const tile = cell & 0x7f;
  if (stage.kind === 'hold') {
    g.save();
    g.translate((hash(cx, cy, Math.floor(t * 40)) - 0.5) * stage.k, 0);
    drawTile(g, tile, x, y, cx, cy, t);
    g.restore();
    g.strokeStyle = `rgba(230, 200, 255, ${0.3 + stage.k * 0.6})`;
    g.lineWidth = 0.5;
    g.beginPath();
    for (let i = 0; i < 1 + stage.k * 5; i++) {
      const sx = x + hash(cx, cy, i) * 12, sy = y + hash(cy, cx, i) * 12;
      g.moveTo(sx, sy); g.lineTo(sx + (hash(i, cx, 2) - 0.5) * 6, sy + (hash(i, cy, 3) - 0.5) * 6);
    }
    g.stroke();
    return;
  }
  const show = stage.kind === 'crumble' ? 1 - stage.k : stage.k;
  g.save();
  g.globalAlpha = show;
  g.translate(x + 6, y + 6); g.scale(0.4 + show * 0.6, 0.4 + show * 0.6); g.translate(-x - 6, -y - 6);
  drawTile(g, tile, x, y, cx, cy, t);
  g.restore();
  if (stage.kind === 'crumble') {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `rgba(230, 200, 255, ${1 - stage.k})`;
      g.beginPath(); g.arc(x + 6 + (hash(i, cx, 1) - 0.5) * 16 * stage.k, y + 6 + (hash(i, cy, 2) - 0.5) * 16 * stage.k, 0.6, 0, 7); g.fill();
    }
  }
}
