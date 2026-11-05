'use strict';
/* Valico — utilità matematiche, rumore procedurale, matrici. Zero dipendenze. */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  mix: (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)],
};

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Value noise 2D con hash intero */
function hash2(ix, iy) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x, y, oct) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    f *= 2.03; a *= 0.5; x += 17.3; y += 9.1;
  }
  return s;
}
function ridged(x, y, oct) {
  let s = 0, a = 0.5, f = 1, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1);
    n *= n; n *= w;
    w = clamp(n * 2, 0, 1);
    s += n * a;
    f *= 2.05; a *= 0.5; x += 31.7; y += 11.3;
  }
  return s;
}

/* Matrici 4x4 column-major */
const M4 = {
  persp(fov, asp, n, f) {
    const t = 1 / Math.tan(fov / 2);
    const o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f);
    return o;
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  },
  /* yaw 0 = nord (-z), yaw positivo = verso est (+x). Ritorna matrice vista e base della camera. */
  view(pos, yaw, pitch) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
    const f = [sy * cp, sp, -cy * cp];
    const r = [cy, 0, sy];
    const u = V3.cross(r, f);
    const o = new Float32Array(16);
    o[0] = r[0]; o[4] = r[1]; o[8] = r[2]; o[12] = -V3.dot(r, pos);
    o[1] = u[0]; o[5] = u[1]; o[9] = u[2]; o[13] = -V3.dot(u, pos);
    o[2] = -f[0]; o[6] = -f[1]; o[10] = -f[2]; o[14] = V3.dot(f, pos);
    o[15] = 1;
    return { m: o, f, r, u };
  },
};

/* Matrici aggiuntive per le ombre */
M4.ortho = function (l, r, b, t, n, f) {
  const o = new Float32Array(16);
  o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
  o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
  return o;
};
M4.lookDir = function (eye, dir, up) {
  const f = V3.norm(dir), r = V3.norm(V3.cross(f, up)), u = V3.cross(r, f);
  const o = new Float32Array(16);
  o[0] = r[0]; o[4] = r[1]; o[8] = r[2]; o[12] = -V3.dot(r, eye);
  o[1] = u[0]; o[5] = u[1]; o[9] = u[2]; o[13] = -V3.dot(u, eye);
  o[2] = -f[0]; o[6] = -f[1]; o[10] = -f[2]; o[14] = V3.dot(f, eye);
  o[15] = 1;
  return { m: o, f, r, u };
};
