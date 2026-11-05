'use strict';
/* Valico — generazione del mondo: terreno, vegetazione, rifugio, segnavia, ombre. */

const TN = 481;                       // vertici per lato
const TS = 2.7;                       // metri per cella
const HALF = ((TN - 1) * TS) / 2;     // 648 m
const HUT = { x: 0, z: 0, y: 42, hx: 2.6, hz: 3.4 };
const LAKE = { x: -170, z: 210, r: 115, bed: -5 };
const WATER_Y = 0;
const ALT_OFFSET = 1650;              // quota "reale" = y + offset

/* ---------- Terreno ---------- */
function rawHeight(x, z) {
  const d = Math.hypot(x, z) / HALF;
  const wall = sstep(0.18, 0.95, d);
  const ridge = ridged(x * 0.0042 + 3.1, z * 0.0042 - 1.7, 6);
  const base = fbm(x * 0.0016, z * 0.0016, 3);
  let h = 40 + base * 60 * wall + ridge * 430 * wall * wall * (0.6 + 0.7 * wall);
  h += (fbm(x * 0.011 + 9, z * 0.011, 4) - 0.5) * 22 * (1 - wall * 0.6);
  h += (fbm(x * 0.06, z * 0.06, 3) - 0.5) * 3.0;
  h += (fbm(x * 0.21 + 3, z * 0.21, 2) - 0.5) * 0.5;
  h += sstep(0.78, 1.0, d) * 260;
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  const lake = 1 - sstep(LAKE.r * 0.55, LAKE.r, ld);
  h = lerp(h, LAKE.bed + (fbm(x * 0.04, z * 0.04, 3) - 0.5) * 4, lake);
  const hd = Math.hypot(x - HUT.x, z - HUT.z);
  h = lerp(h, HUT.y, 1 - sstep(16, 34, hd));
  return h;
}

const Terrain = {
  H: new Float32Array(TN * TN),
  N: new Float32Array(TN * TN * 3),
  build() {
    const H = this.H;
    for (let iz = 0; iz < TN; iz++)
      for (let ix = 0; ix < TN; ix++) H[iz * TN + ix] = rawHeight(-HALF + ix * TS, -HALF + iz * TS);
    for (let iz = 0; iz < TN; iz++)
      for (let ix = 0; ix < TN; ix++) {
        const xl = H[iz * TN + Math.max(ix - 1, 0)], xr = H[iz * TN + Math.min(ix + 1, TN - 1)];
        const zl = H[Math.max(iz - 1, 0) * TN + ix], zr = H[Math.min(iz + 1, TN - 1) * TN + ix];
        const nx = (xl - xr) / (2 * TS), nz = (zl - zr) / (2 * TS);
        const l = Math.hypot(nx, 1, nz);
        const o = (iz * TN + ix) * 3;
        this.N[o] = nx / l; this.N[o + 1] = 1 / l; this.N[o + 2] = nz / l;
      }
  },
};

function heightAt(x, z) {
  let gx = (x + HALF) / TS, gz = (z + HALF) / TS;
  gx = clamp(gx, 0, TN - 1.001); gz = clamp(gz, 0, TN - 1.001);
  const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz;
  const H = Terrain.H, i = iz * TN + ix;
  return lerp(lerp(H[i], H[i + 1], fx), lerp(H[i + TN], H[i + TN + 1], fx), fz);
}
function gradAt(x, z) {
  const e = 0.9;
  return [(heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)];
}
function slopeAt(x, z) {
  const g = gradAt(x, z);
  return Math.hypot(g[0], g[1]);
}

function terrainMeshData() {
  const verts = new Float32Array(TN * TN * 6);
  for (let iz = 0; iz < TN; iz++)
    for (let ix = 0; ix < TN; ix++) {
      const i = iz * TN + ix, o = i * 6;
      verts[o] = -HALF + ix * TS; verts[o + 1] = Terrain.H[i]; verts[o + 2] = -HALF + iz * TS;
      verts[o + 3] = Terrain.N[i * 3]; verts[o + 4] = Terrain.N[i * 3 + 1]; verts[o + 5] = Terrain.N[i * 3 + 2];
    }
  const idx = new Uint32Array((TN - 1) * (TN - 1) * 6);
  let k = 0;
  for (let iz = 0; iz < TN - 1; iz++)
    for (let ix = 0; ix < TN - 1; ix++) {
      const a = iz * TN + ix, b = a + 1, c = a + TN, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  return { verts, idx };
}

/* ---------- Mesh builder (pos3 nrm3 col3 mat2 = 11 float) ---------- */
class MB {
  constructor() { this.v = []; }
  vert(p, n, c, m0, m1) { this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], m0, m1); }
  tri(a, b, c, col, m0, m1, n) {
    if (!n) n = V3.norm(V3.cross(V3.sub(b, a), V3.sub(c, a)));
    this.vert(a, n, col, m0, m1); this.vert(b, n, col, m0, m1); this.vert(c, n, col, m0, m1);
  }
  quadOut(a, b, c, d, col, m0, m1, ref) {
    let n = V3.norm(V3.cross(V3.sub(b, a), V3.sub(c, a)));
    const fc = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
    if (V3.dot(n, V3.sub(fc, ref)) < 0) n = V3.mul(n, -1);
    this.tri(a, b, c, col, m0, m1, n);
    this.tri(a, c, d, col, m0, m1, n);
  }
  box(cx, cy, cz, hx, hy, hz, col, m0 = 0, m1 = 0, ry = 0, rz = 0) {
    const cr = Math.cos(ry), sr = Math.sin(ry), cz_ = Math.cos(rz), sz = Math.sin(rz);
    const C = [];
    for (let i = 0; i < 8; i++) {
      let x = (i & 4 ? 1 : -1) * hx, y = (i & 2 ? 1 : -1) * hy, z = (i & 1 ? 1 : -1) * hz;
      let x2 = x * cz_ - y * sz, y2 = x * sz + y * cz_; x = x2; y = y2;
      x2 = x * cr + z * sr; const z2 = -x * sr + z * cr; x = x2; z = z2;
      C.push([cx + x, cy + y, cz + z]);
    }
    const ref = [cx, cy, cz];
    const F = [[4, 5, 7, 6], [0, 2, 3, 1], [2, 6, 7, 3], [0, 1, 5, 4], [1, 3, 7, 5], [0, 4, 6, 2]];
    for (const f of F) this.quadOut(C[f[0]], C[f[1]], C[f[2]], C[f[3]], col, m0, m1, ref);
  }
  cyl(cx, cy, cz, r0, r1, h, sides, col, m0 = 0, m1 = 0) {
    const ref = [cx, cy + h / 2, cz];
    const P = (i, y, r) => [cx + Math.cos((i / sides) * TAU) * r, cy + y, cz + Math.sin((i / sides) * TAU) * r];
    for (let i = 0; i < sides; i++) {
      this.quadOut(P(i, 0, r0), P(i + 1, 0, r0), P(i + 1, h, r1), P(i, h, r1), col, m0, m1, ref);
      this.tri(P(i, h, r1), P(i + 1, h, r1), [cx, cy + h, cz], col, m0, m1, [0, 1, 0]);
    }
  }
  /* cilindro orizzontale (tronco) lungo x o z, con testate chiare */
  hcyl(cx, cy, cz, len, r, sides, axis, col, m0 = 0, m1 = 1, cap = null) {
    const h = len / 2, ref = [cx, cy, cz];
    const P = (i, s) => {
      const a = (i / sides) * TAU, c = Math.cos(a) * r, d = Math.sin(a) * r;
      return axis === 'x' ? [cx + s * h, cy + c, cz + d] : [cx + c, cy + d, cz + s * h];
    };
    for (let i = 0; i < sides; i++) this.quadOut(P(i, -1), P(i + 1, -1), P(i + 1, 1), P(i, 1), col, m0, m1, ref);
    const cc = cap || [col[0] * 1.5 + 0.05, col[1] * 1.45 + 0.03, col[2] * 1.3 + 0.01];
    for (const s of [-1, 1]) {
      const ctr = axis === 'x' ? [cx + s * h, cy, cz] : [cx, cy, cz + s * h];
      const n = axis === 'x' ? [s, 0, 0] : [0, 0, s];
      for (let i = 0; i < sides; i++) this.tri(P(i, s), P(i + 1, s), ctr, cc, m0, m1, n);
    }
  }
  get count() { return this.v.length / 11; }
  buffer() { return new Float32Array(this.v); }
}

/* Pino a bassa definizione (LOD lontano e proxy per le ombre), alto ~9 m */
function buildPineLow() {
  const mb = new MB(), rnd = mulberry32(7);
  const bark = [0.09, 0.06, 0.04];
  const sides = 7;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * TAU, a1 = ((i + 1) / sides) * TAU;
    const p = (a, y, r) => [Math.cos(a) * r, y, Math.sin(a) * r];
    const n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
    const a = p(a0, 0, 0.32), b = p(a1, 0, 0.32), c = p(a1, 5.2, 0.16), d = p(a0, 5.2, 0.16);
    mb.vert(a, n0, bark, 0, 3); mb.vert(b, n1, bark, 0, 3); mb.vert(c, n1, bark, 0, 3);
    mb.vert(a, n0, bark, 0, 3); mb.vert(c, n1, bark, 0, 3); mb.vert(d, n0, bark, 0, 3);
  }
  const tiers = [[1.2, 4.2, 3.0], [2.8, 3.8, 2.6], [4.3, 3.4, 2.1], [5.7, 3.0, 1.6], [7.0, 2.5, 1.1], [8.1, 1.7, 0.6]];
  const S = 10;
  tiers.forEach((t, ti) => {
    const [by, h, R] = t;
    const rot = ti * 0.55;
    const ring = [];
    for (let i = 0; i < S; i++) {
      const a = rot + (i / S) * TAU;
      const r = R * (0.78 + 0.4 * rnd());
      ring.push({ a, p: [Math.cos(a) * r, by + (rnd() - 0.5) * 0.4 - 0.2, Math.sin(a) * r] });
    }
    const dark = [0.020 + ti * 0.003, 0.045 + ti * 0.005, 0.026], lite = [0.06, 0.115 + ti * 0.008, 0.045];
    const apex = [0, by + h, 0];
    for (let i = 0; i < S; i++) {
      const r0 = ring[i], r1 = ring[(i + 1) % S];
      const slope = R / h;
      const nn = (a) => V3.norm([Math.cos(a), slope * 0.9, Math.sin(a)]);
      mb.vert(r0.p, nn(r0.a), dark, 0, 3);
      mb.vert(apex, nn(r0.a + (r1.a - r0.a) * 0.5), lite, 0, 3);
      mb.vert(r1.p, nn(r1.a), dark, 0, 3);
      mb.vert(r0.p, [0, -1, 0], [0.012, 0.025, 0.015], 0, 3);
      mb.vert(r1.p, [0, -1, 0], [0.012, 0.025, 0.015], 0, 3);
      mb.vert([0, by - 0.1, 0], [0, -1, 0], [0.01, 0.02, 0.012], 0, 3);
    }
  });
  return mb.buffer();
}

/* Pino ad alta definizione: tronco con svasatura, 21 palchi di rami ricurvi,
   ogni ramo e' una fronda a V con aghi disegnati nello shader (alpha-to-coverage).
   aMat.x = -1 -> tronco;  altrimenti (u lungo il ramo 0..1, v attraverso -1..1). */
function buildPineHigh() {
  const mb = new MB(), rnd = mulberry32(11);
  const bark = [0.085, 0.058, 0.042];
  const sides = 10;
  const radiusAt = (y) => 0.3 * Math.pow(Math.max(1 - y / 9.6, 0.02), 0.85) + 0.025 + 0.2 * Math.exp(-y * 3.2);
  const rings = [];
  for (let y = -0.25; y < 9.1; y += 0.6) rings.push(y);
  rings.push(9.4);
  for (let r = 0; r < rings.length - 1; r++) {
    const y0 = rings[r], y1 = rings[r + 1], r0 = radiusAt(y0), r1 = radiusAt(y1);
    const cv = 0.8 + 0.4 * rnd();
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * TAU, a1 = ((i + 1) / sides) * TAU;
      const P = (a, y, rr) => [Math.cos(a) * rr, y, Math.sin(a) * rr];
      const N = (a) => [Math.cos(a), 0.12, Math.sin(a)];
      const col = [bark[0] * cv, bark[1] * cv, bark[2] * cv];
      const A = P(a0, y0, r0), B = P(a1, y0, r0), C = P(a1, y1, r1), D = P(a0, y1, r1);
      mb.vert(A, N(a0), col, -1, 0); mb.vert(B, N(a1), col, -1, 0); mb.vert(C, N(a1), col, -1, 0);
      mb.vert(A, N(a0), col, -1, 0); mb.vert(C, N(a1), col, -1, 0); mb.vert(D, N(a0), col, -1, 0);
    }
  }
  const NW = 21, S = 4;
  for (let i = 0; i < NW; i++) {
    const t = i / (NW - 1);
    const y0 = 1.5 + t * 7.2;
    const m = Math.round(lerp(9, 5, t));
    const Lb = lerp(3.2, 0.5, Math.pow(t, 0.8)) * (0.9 + 0.2 * rnd());
    const rot = i * 2.399;
    for (let k = 0; k < m; k++) {
      const a = rot + ((k + (rnd() - 0.5) * 0.5) / m) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const pa0 = lerp(-0.18, 0.5, t) + (rnd() - 0.5) * 0.18;
      const droop = 0.5 * (1 - 0.5 * t) * (0.85 + 0.3 * rnd());
      const tone = rnd();
      const base = V3.mix([0.016, 0.036, 0.019], [0.05, 0.1, 0.034], tone);
      const rowsP = [];
      for (let j = 0; j <= S; j++) {
        const s = j / S;
        const rr = Lb * Math.cos(pa0) * s * 0.98 + 0.04;
        const yy = y0 + Lb * (Math.sin(pa0) * s - droop * s * s);
        const hw = Lb * 0.36 * (0.3 + 0.7 * Math.sin(Math.PI * (0.08 + 0.84 * s))) * (1 - Math.pow(s, 4) * 0.85) + 0.03;
        const P = [ca * rr, yy, sa * rr], Sv = [-sa, 0, ca];
        const L = [P[0] + Sv[0] * hw, P[1] + hw * 0.38, P[2] + Sv[2] * hw];
        const Rr = [P[0] - Sv[0] * hw, P[1] + hw * 0.38, P[2] - Sv[2] * hw];
        const ao = (0.42 + 0.58 * s) * (0.72 + 0.28 * t);
        const col = [base[0] * ao * 1.6, base[1] * ao * 1.6, base[2] * ao * 1.6];
        const n = V3.norm([ca * 0.5, 0.85, sa * 0.5]);
        rowsP.push({ L, C: P, R: Rr, s, col, n });
      }
      const pv = (r, key, v) => mb.vert(r[key], r.n, r.col, r.s, v);
      for (let j = 0; j < S; j++) {
        const a_ = rowsP[j], b_ = rowsP[j + 1];
        // lato sinistro
        pv(a_, 'L', -1); pv(a_, 'C', 0); pv(b_, 'C', 0);
        pv(a_, 'L', -1); pv(b_, 'C', 0); pv(b_, 'L', -1);
        // lato destro
        pv(a_, 'C', 0); pv(a_, 'R', 1); pv(b_, 'R', 1);
        pv(a_, 'C', 0); pv(b_, 'R', 1); pv(b_, 'C', 0);
      }
    }
  }
  return mb.buffer();
}

/* Icosfera (non indicizzata) di raggio 1 */
function buildIcosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(V3.norm);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) {
    const cache = new Map(), NF = [];
    const mid = (a, b) => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (cache.has(k)) return cache.get(k);
      V.push(V3.norm(V3.mul(V3.add(V[a], V[b]), 0.5)));
      cache.set(k, V.length - 1);
      return V.length - 1;
    };
    for (const f of F) {
      const a = mid(f[0], f[1]), b = mid(f[1], f[2]), c = mid(f[2], f[0]);
      NF.push([f[0], a, c], [f[1], b, a], [f[2], c, b], [a, b, c]);
    }
    F = NF;
  }
  const out = [];
  for (const f of F) for (const i of f) out.push(V[i][0], V[i][1], V[i][2]);
  return new Float32Array(out);
}

/* Lama d'erba: 5 triangoli, (x attraverso -1..1, y altezza 0..1) */
function buildBlade() {
  const L0 = 1.0, L1 = 0.82, L2 = 0.46;
  const v = [
    [-L0, 0], [L0, 0], [-L1, 0.33], [L1, 0.33], [-L2, 0.66], [L2, 0.66], [0, 1],
  ];
  const tris = [[0, 1, 2], [1, 3, 2], [2, 3, 4], [3, 5, 4], [4, 5, 6]];
  const out = [];
  for (const t of tris) for (const i of t) out.push(v[i][0], v[i][1]);
  return new Float32Array(out);
}

/* ---------- Vegetazione e ostacoli ---------- */
const Props = {
  trees: [],     // {x,y,z,s,rot,seed}
  rocks: [],
  treeData: null, rockData: null,
  circles: { cell: 16, map: new Map() },
};

function addCircle(x, z, r) {
  const C = Props.circles, k = Math.floor(x / C.cell) + ',' + Math.floor(z / C.cell);
  let a = C.map.get(k);
  if (!a) { a = []; C.map.set(k, a); }
  a.push(x, z, r);
}
function nearCircles(x, z, out) {
  out.length = 0;
  const C = Props.circles, cx = Math.floor(x / C.cell), cz = Math.floor(z / C.cell);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const a = C.map.get(cx + i + ',' + (cz + j));
      if (a) for (let k = 0; k < a.length; k++) out.push(a[k]);
    }
  return out;
}

function placeVegetation() {
  const rng = mulberry32(20261103);
  const trees = Props.trees, rocks = Props.rocks;
  for (let gz = -HALF + 6; gz < HALF - 6; gz += 7) {
    for (let gx = -HALF + 6; gx < HALF - 6; gx += 7) {
      const x = gx + (rng() - 0.5) * 6.2, z = gz + (rng() - 0.5) * 6.2;
      const h = heightAt(x, z);
      if (h < 2.2 || h > 140) continue;
      if (Math.hypot(x - HUT.x, z - HUT.z) < 20) continue;
      if (slopeAt(x, z) > 0.55) continue;
      const cl = fbm(x * 0.012 + 50, z * 0.012 - 20, 3);
      const dens = sstep(0.36, 0.6, cl) * (1 - sstep(95, 140, h));
      if (rng() > dens * 0.95) continue;
      const s = (0.7 + rng() * 0.95) * (1 - sstep(80, 140, h) * 0.4);
      trees.push({ x, y: h - 0.15, z, s, rot: rng() * TAU, seed: rng() });
      addCircle(x, z, 0.42 * s);
    }
  }
  for (let gz = -HALF + 6; gz < HALF - 6; gz += 11) {
    for (let gx = -HALF + 6; gx < HALF - 6; gx += 11) {
      const x = gx + (rng() - 0.5) * 9, z = gz + (rng() - 0.5) * 9;
      const h = heightAt(x, z);
      if (h < 0.3) continue;
      if (Math.hypot(x - HUT.x, z - HUT.z) < 22) continue;
      const sl = slopeAt(x, z);
      const p = 0.05 + sstep(0.25, 0.7, sl) * 0.6 + sstep(90, 320, h) * 0.22;
      if (rng() > p) continue;
      const s = (0.45 + rng() * rng() * 3.4) * (1 + sstep(150, 400, h) * 0.6);
      rocks.push({ x, y: h - s * 0.1, z, s, rot: rng() * TAU, seed: rng() });
      if (s > 0.9) addCircle(x, z, 0.78 * s);
    }
  }
  /* sassi piccoli sparsi attorno al rifugio */
  for (let i = 0; i < 160; i++) {
    const a = rng() * TAU, d = 9 + rng() * 55;
    const x = HUT.x + Math.cos(a) * d, z = HUT.z + Math.sin(a) * d, h = heightAt(x, z);
    if (h < 0.4) continue;
    rocks.push({ x, y: h - 0.03, z, s: 0.14 + rng() * rng() * 0.5, rot: rng() * TAU, seed: rng() });
  }
  Props.treeData = new Float32Array(trees.length * 6);
  trees.forEach((t, i) => Props.treeData.set([t.x, t.y, t.z, t.s, t.rot, t.seed], i * 6));
  Props.rockData = new Float32Array(rocks.length * 6);
  rocks.forEach((t, i) => Props.rockData.set([t.x, t.y, t.z, t.s, t.rot, t.seed], i * 6));
}

/* ---------- Rifugio ---------- */
const Hut = {
  y0: HUT.y + 0.2,           // quota del pavimento
  aabb: [],                  // [x0,x1,z0,z1]
  fire: [0, HUT.y + 0.9, -HUT.hz + 0.95],
  chimney: [0, 0, 0],
  inside(x, z, m = 0) { return Math.abs(x - HUT.x) < HUT.hx - 0.2 - m && Math.abs(z - HUT.z) < HUT.hz - 0.2 - m; },
  onFloor(x, z) { return Math.abs(x - HUT.x) < HUT.hx + 0.17 && Math.abs(z - HUT.z) < HUT.hz + 0.17; },
};

function buildHut(mb) {
  const { hx, hz } = HUT, y0 = Hut.y0, t = 0.17, rnd = mulberry32(5);
  const stoneC = () => { const g = 0.26 + rnd() * 0.12; return [g * 1.04, g, g * 0.92]; };
  const woodC = () => { const g = 0.75 + rnd() * 0.5; return [0.21 * g, 0.115 * g, 0.06 * g]; };
  const dwood = [0.12, 0.075, 0.045], wood2 = [0.26, 0.15, 0.08];
  const baseH = 1.1, R = 0.14, sp = 0.27, rows = 5;
  const wallH = baseH + rows * sp;                   // 2.45
  const free = (a, b, gaps) => {
    let out = [[a, b]];
    for (const [g0, g1] of gaps) {
      const n = [];
      for (const [s0, s1] of out) {
        if (g1 <= s0 || g0 >= s1) n.push([s0, s1]);
        else { if (g0 > s0) n.push([s0, g0]); if (g1 < s1) n.push([g1, s1]); }
      }
      out = n;
    }
    return out.filter((s) => s[1] - s[0] > 0.05);
  };
  const DOOR = [-0.62, 0.62];
  const WIN = [[-2.1, -1.1], [0.4, 1.4]];

  // pavimento di assi
  for (let i = 0; i < 12; i++) {
    const zc = -hz + (i + 0.5) * ((2 * hz) / 12);
    mb.box(0, y0 - 0.06, zc, hx + t, 0.06, (hz / 12) - 0.004, woodC(), 0, 1);
  }
  mb.box(0, y0 - 0.3, 0, hx + t, 0.24, hz + t, dwood, 0, 1);
  // gradini e soglia in pietra
  mb.box(0, y0 - 0.12, hz + 0.95, 1.15, 0.1, 0.55, [0.34, 0.33, 0.30], 0, 2);
  mb.box(0, y0 - 0.2, hz + 1.55, 0.95, 0.08, 0.28, [0.31, 0.3, 0.28], 0, 2);

  // basamento in pietre
  const courses = 5, ch = baseH / courses;
  const stoneRun = (axis, fixed, a, b, gaps, thick) => {
    for (let c = 0; c < courses; c++) {
      const segs = free(a, b, gaps);
      const yc = y0 + ch * (c + 0.5);
      for (const [s0, s1] of segs) {
        let p = s0 + (c % 2) * 0.22;
        while (p < s1 - 0.05) {
          const w = Math.min(0.32 + rnd() * 0.32, s1 - p), cc = p + w / 2, off = (rnd() - 0.5) * 0.05;
          const hh = ch / 2 * (0.9 + rnd() * 0.1);
          if (axis === 'x') mb.box(cc, yc, fixed + off, w / 2 - 0.008, hh, thick, stoneC(), 0, 2, (rnd() - 0.5) * 0.05);
          else mb.box(fixed + off, yc, cc, thick, hh, w / 2 - 0.008, stoneC(), 0, 2, (rnd() - 0.5) * 0.05);
          p += w;
        }
      }
    }
  };
  stoneRun('x', hz, -hx - t, hx + t, [DOOR], t + 0.02);
  stoneRun('x', -hz, -hx - t, hx + t, [], t + 0.02);
  stoneRun('z', -hx, -hz, hz, [], t + 0.02);
  stoneRun('z', hx, -hz, hz, [], t + 0.02);

  // pareti in tronchi
  for (let r = 0; r < rows; r++) {
    const yc = y0 + baseH + R + r * sp - 0.01;
    const hasDoor = yc - y0 < 2.12, hasWin = yc - y0 > 1.1 && yc - y0 < 2.0;
    const ext = 0.26;
    for (const [s0, s1] of free(-hx - ext, hx + ext, hasDoor ? [DOOR] : []))
      mb.hcyl((s0 + s1) / 2, yc, hz, s1 - s0, R, 8, 'x', woodC(), 0, 1);
    mb.hcyl(0, yc, -hz, 2 * hx + 2 * ext, R, 8, 'x', woodC(), 0, 1);
    for (const sx of [-1, 1])
      for (const [s0, s1] of free(-hz - ext, hz + ext, hasWin ? WIN : []))
        mb.hcyl(sx * hx, yc + 0.0, (s0 + s1) / 2, s1 - s0, R, 8, 'z', woodC(), 0, 1);
  }
  // stipiti della porta e finestre
  mb.box(-0.66, y0 + 1.12, hz, 0.06, 1.12, 0.17, dwood, 0, 1);
  mb.box(0.66, y0 + 1.12, hz, 0.06, 1.12, 0.17, dwood, 0, 1);
  // anta aperta verso l'esterno
  const phi = 112 * DEG, hingeX = -0.62, lx = hingeX + Math.cos(phi) * 0.6, lz = hz + 0.1 + Math.sin(phi) * 0.6;
  mb.box(lx, y0 + 1.05, lz, 0.6, 1.02, 0.035, [0.23, 0.13, 0.07], 0, 1, -phi);
  mb.box(lx + Math.cos(phi) * 0.0, y0 + 1.05, lz, 0.04, 1.0, 0.045, dwood, 0, 1, -phi);
  for (const sx of [-1, 1]) {
    for (const [g0, g1] of WIN) {
      const zc = (g0 + g1) / 2, hw = (g1 - g0) / 2, X = sx * (hx + 0.005), yc = y0 + 1.56;
      mb.box(X, yc, zc, 0.018, 0.4, hw - 0.01, [1.0, 0.62, 0.28], 0, 9);          // vetro illuminato
      mb.box(sx * (hx + 0.045), yc, zc, 0.02, 0.4, 0.025, dwood, 0, 1);            // montante
      mb.box(sx * (hx + 0.045), yc, zc, 0.02, 0.025, hw, dwood, 0, 1);             // traverso
      for (const dz of [-1, 1]) mb.box(sx * (hx + 0.06), yc, zc + dz * hw, 0.045, 0.43, 0.03, dwood, 0, 1);
      for (const dy of [-1, 1]) mb.box(sx * (hx + 0.06), yc + dy * 0.42, zc, 0.045, 0.03, hw + 0.03, dwood, 0, 1);
      mb.box(sx * (hx + 0.11), yc - 0.46, zc, 0.09, 0.025, hw + 0.08, wood2, 0, 1);  // davanzale
      for (const dz of [-1, 1]) mb.box(sx * (hx + 0.09), yc, zc + dz * (hw + 0.2), 0.03, 0.43, 0.2, [0.4, 0.07, 0.05], 0, 1, 0, 0); // persiane
    }
  }
  Hut.aabb = [
    [-hx - t, hx + t, -hz - t, -hz + t], [-hx - t, -hx + t, -hz, hz], [hx - t, hx + t, -hz, hz],
    [-hx - t, -0.62, hz - t, hz + t], [0.62, hx + t, hz - t, hz + t],
  ];

  // tetto a due falde (colmo lungo z)
  const th = 30 * DEG, span = hx + 0.8, Lr = span / Math.cos(th), rise = span * Math.tan(th), yt = y0 + wallH;
  const slate = [0.15, 0.115, 0.095];
  mb.box(-span / 2, yt + rise / 2 + 0.12, 0, Lr / 2, 0.085, hz + 0.6, slate, 0, 4, 0, th);
  mb.box(span / 2, yt + rise / 2 + 0.12, 0, Lr / 2, 0.085, hz + 0.6, slate, 0, 4, 0, -th);
  mb.box(0, yt + rise + 0.17, 0, 0.1, 0.07, hz + 0.62, [0.17, 0.1, 0.055], 0, 1);
  for (const sz of [-1, 1]) {
    const zz = sz * (hz + t);
    mb.tri([-hx - t, yt, zz], [hx + t, yt, zz], [0, yt + rise, zz], wood2, 0, 1, [0, 0, sz]);
    for (let k = 0; k < 9; k++) mb.box(-hx + 0.3 + k * 0.52, yt + 0.02, zz + sz * 0.02, 0.01, 0.01, 0.01, dwood, 0, 1);
    mb.box(0, yt + 0.62, zz + sz * 0.03, 0.2, 0.18, 0.025, [1.0, 0.62, 0.28], 0, 9);
    mb.box(0, yt + 0.62, zz + sz * 0.045, 0.23, 0.028, 0.03, dwood, 0, 1);
    mb.box(0, yt + 0.62, zz + sz * 0.045, 0.028, 0.21, 0.03, dwood, 0, 1);
  }
  // camino in pietra
  Hut.chimney = [0, yt + rise + 1.4, -hz + 0.55];
  mb.box(0, yt + rise + 0.2, -hz + 0.55, 0.45, 1.0, 0.4, [0.3, 0.285, 0.26], 0, 2);
  mb.box(0, yt + rise + 1.3, -hz + 0.55, 0.56, 0.07, 0.5, [0.24, 0.23, 0.22], 0, 2);
  // interni: focolare, letto, tavolo, panca, sgabelli
  mb.box(0, y0 + 0.28, -hz + 0.7, 0.85, 0.28, 0.42, [0.3, 0.285, 0.26], 0, 2);
  mb.box(0, y0 + 0.57, -hz + 0.7, 0.9, 0.03, 0.46, [0.2, 0.19, 0.18], 0, 2);
  mb.box(0, y0 + 0.05, -hz + 0.95, 0.35, 0.05, 0.2, [0.05, 0.04, 0.035]);
  mb.box(-1.55, y0 + 0.3, -0.6, 0.85, 0.3, 0.55, wood2, 0, 1);
  mb.box(-1.55, y0 + 0.64, -0.6, 0.82, 0.09, 0.52, [0.42, 0.1, 0.08], 0, 6);
  mb.box(-2.15, y0 + 0.78, -0.6, 0.2, 0.07, 0.4, [0.55, 0.5, 0.42], 0, 6);
  mb.box(1.5, y0 + 0.78, 0.2, 0.55, 0.04, 0.9, wood2, 0, 1);
  for (const [lx2, lz2] of [[1.1, -0.6], [1.9, -0.6], [1.1, 1.0], [1.9, 1.0]]) mb.box(lx2, y0 + 0.38, lz2, 0.04, 0.38, 0.04, dwood, 0, 1);
  mb.cyl(0.9, y0, 1.6, 0.17, 0.15, 0.42, 9, wood2, 0, 1);
  mb.cyl(1.4, y0, 1.9, 0.17, 0.15, 0.42, 9, wood2, 0, 1);
  mb.box(0.9, y0 + 0.9, -hz + 0.2, 0.55, 0.025, 0.12, wood2, 0, 1);            // mensola
  mb.cyl(1.35, y0 + 0.82, 0.55, 0.07, 0.06, 0.1, 8, [0.5, 0.45, 0.4], 0, 5);  // tazza
  // catasta di legna all'esterno
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 5 - r; c++)
      mb.hcyl(hx + 0.55, y0 + 0.11 + r * 0.19, -1.9 + c * 0.22 + r * 0.11, 0.9, 0.095, 7, 'x', woodC(), 0, 1);
  // insegna sopra la porta
  mb.box(-0.9, y0 + 2.28, hz + t + 0.06, 0.55, 0.1, 0.025, [0.5, 0.13, 0.08], 0, 1);
  // lanterna accanto alla porta
  mb.box(0.95, y0 + 1.85, hz + t + 0.1, 0.07, 0.11, 0.07, [1.0, 0.7, 0.35], 0, 9);
  mb.box(0.95, y0 + 1.98, hz + t + 0.1, 0.09, 0.02, 0.09, [0.05, 0.05, 0.05], 0, 5);
  mb.box(0.95, y0 + 1.72, hz + t + 0.1, 0.09, 0.02, 0.09, [0.05, 0.05, 0.05], 0, 5);
  // sentiero di lastre
  for (let k = 0; k < 9; k++) {
    const zz = hz + 2.0 + k * 0.75 + (rnd() - 0.5) * 0.15, xx = (rnd() - 0.5) * 0.7 + Math.sin(k * 0.8) * 0.4;
    mb.box(xx, Hut.y0 - 0.17 + 0.0, zz, 0.32 + rnd() * 0.1, 0.03, 0.25 + rnd() * 0.08, stoneC(), 0, 2, rnd() * TAU);
  }
}

/* ---------- Segnavia, casse, fuochi ---------- */
const Items = { markers: [], crates: [] };

function pickSpot(rng, minD, maxD, maxSlope, maxAlt, avoid) {
  for (let tries = 0; tries < 600; tries++) {
    const a = rng() * TAU, d = minD + rng() * (maxD - minD);
    const x = HUT.x + Math.cos(a) * d, z = HUT.z + Math.sin(a) * d;
    if (Math.hypot(x, z) > 540) continue;
    const h = heightAt(x, z);
    if (h < 3 || h > maxAlt) continue;
    if (slopeAt(x, z) > maxSlope) continue;
    const near = nearCircles(x, z, []);
    let bad = false;
    for (let i = 0; i < near.length; i += 3) if (Math.hypot(near[i] - x, near[i + 1] - z) < near[i + 2] + 2.5) bad = true;
    for (const q of avoid) if (Math.hypot(q.x - x, q.z - z) < 90) bad = true;
    if (!bad) return { x, y: h, z };
  }
  return { x: HUT.x + 60, y: heightAt(HUT.x + 60, HUT.z), z: HUT.z };
}

function placeItems() {
  const rng = mulberry32(777);
  const used = [];
  const NOTES = [
    'Un cordino rosso legato al paletto e un biglietto: «Valico chiuso, scendiamo verso il lago. – M.»',
    'Una borraccia vuota sotto il cairn. Le tracce proseguono verso nord, poi il vento le cancella.',
    'Il segnavia è piegato dal vento. Sul retro, a matita: «Luca ha perso un guanto, rallentiamo.»',
    'Un frontalino ancora acceso sotto un sasso. Chi lo ha lasciato qui non può essere lontano.',
    'Ultimo segnavia. La radio gracchia: «Qui Soccorso Alpino, abbiamo la vostra posizione. Rientra al rifugio, all\'alba arriva l\'elicottero.»',
  ];
  for (let k = 0; k < 5; k++) {
    const p = pickSpot(rng, 130 + k * 75, 190 + k * 80, 0.42, 230, used);
    used.push(p);
    Items.markers.push({ x: p.x, y: p.y, z: p.z, got: false, note: NOTES[k], idx: k + 1 });
  }
  for (let k = 0; k < 7; k++) {
    const p = pickSpot(rng, 60, 470, 0.38, 200, used);
    used.push(p);
    Items.crates.push({ x: p.x, y: p.y, z: p.z, opened: false, rot: rng() * TAU });
  }
  for (const m of Items.markers) addCircle(m.x, m.z, 0.7);
  for (const c of Items.crates) addCircle(c.x, c.z, 0.55);
}

function buildDynamic(fires) {
  const mb = new MB(), rnd = mulberry32(99);
  for (const m of Items.markers) {
    for (let i = 0; i < 7; i++) {
      const r = 0.6 - i * 0.07;
      for (let k = 0; k < 3; k++) {
        const a = rnd() * TAU, d = r * 0.45 * rnd(), g = 0.26 + rnd() * 0.12;
        mb.box(m.x + Math.cos(a) * d, m.y + 0.09 + i * 0.16, m.z + Math.sin(a) * d, r * (0.5 + rnd() * 0.35), 0.085 + rnd() * 0.02, r * (0.45 + rnd() * 0.35), [g * 1.04, g, g * 0.92], 0, 2, rnd() * TAU);
      }
    }
    if (!m.got) {
      mb.box(m.x, m.y + 2.0, m.z, 0.04, 1.6, 0.04, [0.15, 0.1, 0.06], 0, 1);
      mb.box(m.x + 0.32, m.y + 3.25, m.z, 0.3, 0.17, 0.012, [0.75, 0.04, 0.04], 0.9, 6);
      mb.box(m.x + 0.32, m.y + 2.9, m.z, 0.3, 0.17, 0.012, [0.85, 0.85, 0.85], 0.9, 6);
      mb.box(m.x, m.y + 1.4, m.z, 0.045, 0.2, 0.045, [0.9, 0.9, 0.9], 1.0, 0);
    } else {
      mb.box(m.x, m.y + 1.1, m.z, 0.03, 0.55, 0.03, [0.15, 0.1, 0.06], 0, 1, 0, 0.5);
    }
  }
  for (const c of Items.crates) {
    const col = c.opened ? [0.32, 0.14, 0.05] : [0.72, 0.28, 0.05];
    mb.box(c.x, c.y + 0.3, c.z, 0.5, 0.3, 0.32, col, 0.35, 1, c.rot);
    for (const s of [-1, 1]) mb.box(c.x + Math.cos(c.rot) * s * 0.5, c.y + 0.3, c.z - Math.sin(c.rot) * s * 0.5, 0.03, 0.31, 0.34, [0.16, 0.1, 0.06], 0, 1, c.rot);
    if (!c.opened) mb.box(c.x, c.y + 0.61, c.z, 0.52, 0.025, 0.34, [0.85, 0.85, 0.85], 0.8, 6, c.rot);
    else mb.box(c.x + Math.cos(c.rot) * 0.2, c.y + 0.75, c.z - Math.sin(c.rot) * 0.2, 0.52, 0.025, 0.34, col, 0.2, 1, c.rot, 1.1);
  }
  for (const f of fires) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + rnd() * 0.2, g = 0.24 + rnd() * 0.1;
      mb.box(f.x + Math.cos(a) * 0.55, f.y + 0.1, f.z + Math.sin(a) * 0.55, 0.15 + rnd() * 0.05, 0.1 + rnd() * 0.04, 0.14 + rnd() * 0.04, [g, g * 0.97, g * 0.9], 0, 2, a);
    }
    for (let i = 0; i < 4; i++) mb.hcyl(f.x, f.y + 0.1 + (i % 2) * 0.1, f.z, 0.8, 0.045, 6, i % 2 ? 'x' : 'z', [0.07, 0.045, 0.03], 0, 1, [0.04, 0.025, 0.02]);
    mb.box(f.x, f.y + 0.03, f.z, 0.38, 0.03, 0.38, [0.03, 0.025, 0.02], 0, 5);
  }
  return mb.buffer();
}

/* ---------- Ombre di grande scala del sole (bake su heightmap) + occlusione ---------- */
class ShadowBaker {
  constructor() {
    this.buf = new Uint8Array(TN * TN * 2);
    this.ao = new Uint8Array(TN * TN);
    this.row = 0; this.active = false;
  }
  buildAO() {
    const H = Terrain.H, ao = this.ao, cov = new Float32Array(TN * TN);
    for (const t of Props.trees) {
      const cx = Math.round((t.x + HALF) / TS), cz = Math.round((t.z + HALF) / TS), rr = Math.ceil((2.6 * t.s) / TS) + 1;
      for (let j = -rr; j <= rr; j++) for (let i = -rr; i <= rr; i++) {
        const x = cx + i, z = cz + j; if (x < 0 || z < 0 || x >= TN || z >= TN) continue;
        const d = Math.hypot(i, j) * TS / (2.8 * t.s);
        if (d < 1) cov[z * TN + x] = Math.min(1, cov[z * TN + x] + (1 - d) * 0.9);
      }
    }
    for (let iz = 0; iz < TN; iz++) for (let ix = 0; ix < TN; ix++) {
      const i = iz * TN + ix, h = H[i];
      let avg = 0;
      for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
        avg += H[clamp(iz + dz, 0, TN - 1) * TN + clamp(ix + dx, 0, TN - 1)];
      }
      avg /= 4;
      const concave = clamp((avg - h) * 0.05, 0, 0.4);
      ao[i] = Math.round(clamp(1 - concave - cov[i] * 0.45, 0.2, 1) * 255);
    }
  }
  start(L) {
    const hl = Math.max(Math.hypot(L[0], L[2]), 1e-4);
    this.dx = L[0] / hl; this.dz = L[2] / hl;
    this.ratio = L[1] / hl; this.Ly = L[1];
    this.row = 0; this.active = true;
  }
  step(ms) {
    const t0 = performance.now();
    while (this.row < TN && performance.now() - t0 < ms) this.doRow(this.row++);
    if (this.row >= TN) { this.finish(); this.active = false; return true; }
    return false;
  }
  doRow(iz) {
    const H = Terrain.H, buf = this.buf, ao = this.ao, dx = this.dx, dz = this.dz, ratio = this.ratio;
    const wz = -HALF + iz * TS, lowSun = this.Ly < 0.02;
    for (let ix = 0; ix < TN; ix++) {
      const i = iz * TN + ix;
      let shade = 255;
      if (!lowSun) {
        const wx = -HALF + ix * TS, h = H[i] + 0.4;
        let pen = 1, t = 3.5;
        while (t < 1100) {
          const x = wx + dx * t, z = wz + dz * t;
          const gx = (x + HALF) / TS, gz = (z + HALF) / TS;
          if (gx < 0 || gz < 0 || gx > TN - 1.001 || gz > TN - 1.001) break;
          const ry = h + ratio * t;
          const ixx = gx | 0, izz = gz | 0, fx = gx - ixx, fz = gz - izz, k = izz * TN + ixx;
          const th = (H[k] * (1 - fx) + H[k + 1] * fx) * (1 - fz) + (H[k + TN] * (1 - fx) + H[k + TN + 1] * fx) * fz;
          const v = (ry - th) / (t * 0.045 + 1.5);
          if (v < pen) pen = v;
          if (pen < -0.5 || ry > 900) break;
          t *= 1.055; t += 1.5;
        }
        shade = Math.round(clamp(pen, 0, 1) * 255);
      }
      buf[i * 2] = shade; buf[i * 2 + 1] = ao[i];
    }
  }
  finish() {
    if (this.Ly < 0.03) return;
    const buf = this.buf, ratio = Math.max(this.ratio, 0.12);
    for (const t of Props.trees) {
      const H9 = t.s * 9.2, len = Math.min(H9 / ratio, 30);
      const cx = t.x - this.dx * len * 0.5, cz = t.z - this.dz * len * 0.5;
      const rad = 2.4 * t.s + len * 0.32;
      const gx = (cx + HALF) / TS, gz = (cz + HALF) / TS, rr = Math.ceil(rad / TS) + 1;
      for (let j = -rr; j <= rr; j++) for (let i = -rr; i <= rr; i++) {
        const x = Math.round(gx) + i, z = Math.round(gz) + j;
        if (x < 0 || z < 0 || x >= TN || z >= TN) continue;
        const d = Math.hypot(x - gx, z - gz) * TS / rad;
        if (d < 1) {
          const o = (z * TN + x) * 2;
          buf[o] = Math.round(buf[o] * (1 - 0.5 * sstep(1, 0.4, d)));
        }
      }
    }
  }
}
