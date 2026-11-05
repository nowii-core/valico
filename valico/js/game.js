'use strict';
/* Valico — motore di rendering: HDR + MSAA, ombre a cascata, LOD, erba, bloom, ambiente. */

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });

/* ============ Stato ============ */
const G = {
  state: 'loading',            // loading | menu | play | pause | end
  hour: 16.33, hourRate: 1 / 42, endHour: 31.0,
  weather: 0.12, snow: 0.12, gust: 0,
  warmth: 100, stamina: 100, matches: 4, collected: 0, firesLit: 0, cratesOpened: 0,
  pos: [HUT.x, Hut.y0, HUT.z + 0.6], vel: [0, 0, 0], vy: 0, onGround: true,
  yaw: Math.PI, pitch: 0, crouch: 0, eye: 1.7, camY: Hut.y0 + 1.7,
  lamp: true, fires: [], pingT: 0, pingCD: 0, ping: null,
  stride: 0, bob: 0, inHut: true, inWater: 0, surface: 'wood',
  elapsed: 0, noLock: false, locked: false,
  keys: {}, mouseDown: false, scale: 1, muted: false,
  shiver: 0, heart: 0, lastBake: [0, 1, 0], temp: 0, qname: 'alta',
};
const R = { vp: null, cam: [0, 0, 0], f: [0, 0, -1], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, fov: 72 * DEG, near: 0.1, far: 4200, yawC: 0, pitchC: 0 };
const E = {};                                   // ambiente calcolato ogni frame

/* ============ Qualita' ============ */
const QUAL = {
  alta:  { msaa: 4, shRes: 2048, casc: 3, taps: 8, grass: 90000, treeNear: 140, rockNear: 90, bloom: true },
  media: { msaa: 2, shRes: 1536, casc: 3, taps: 4, grass: 45000, treeNear: 90, rockNear: 60, bloom: true },
  bassa: { msaa: 0, shRes: 1024, casc: 2, taps: 2, grass: 15000, treeNear: 50, rockNear: 35, bloom: true },
  test:  { msaa: 0, shRes: 1024, casc: 3, taps: 4, grass: 20000, treeNear: 70, rockNear: 50, bloom: true },
};
const Q = Object.assign({}, QUAL.alta);
function setQuality(name) {
  if (!QUAL[name]) return;
  Object.assign(Q, QUAL[name]); G.qname = name;
  if (gl) Q.msaa = Math.min(Q.msaa, gl.getParameter(gl.MAX_SAMPLES) | 0);
}

/* ============ Utility GL ============ */
let HDR = false;
function header() {
  return '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp sampler2DArrayShadow;\n' + (HDR ? '#define HDR 1\n' : '');
}
function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, header() + src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('SHADER ERROR:', gl.getShaderInfoLog(s));
    console.error(src.split('\n').map((l, i) => i + 7 + ': ' + l).join('\n').slice(0, 3000));
    throw new Error('Shader non compilato');
  }
  return s;
}
function program(vs, fs, name) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('LINK ERROR ' + name + ':', gl.getProgramInfoLog(p)); throw new Error('Link ' + name); }
  p._u = {};
  return p;
}
function U(p, n) { if (!(n in p._u)) p._u[n] = gl.getUniformLocation(p, n); return p._u[n]; }
function buf(target, data, usage) {
  const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, usage || gl.STATIC_DRAW); return b;
}
function tex2D(w, h, internal, format, type, data, linear) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

const P = {};   // programmi
const VAO = {}; // vertex array
const T = {};   // texture
const B = {};   // buffer
const C = { terrainIdx: 0, pineLow: 0, pineHigh: 0, rock1: 0, rock3: 0, stat: 0, dyn: 0 };
const FB = { key: '', res: null, resFbo: null, depthRB: null, msFbo: null, msColor: null, msDepth: null, bloom: [], sh: null, shTex: null, shRes: 0 };

function setupPropLayout(stride) {
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 36);
}
function setupInstanceLayout(b) {
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(4, 1);
  gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(5, 1);
}
function posOnlyVAO(meshBuf, stride, instBuf) {
  const v = gl.createVertexArray(); gl.bindVertexArray(v);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  if (instBuf) setupInstanceLayout(instBuf);
  gl.bindVertexArray(null);
  return v;
}

let shadowBaker = null, shTexCur = null, shTexNext = null, shMix = 1, shBlend = false;
let snowSeedN = 4200;
const SNOW_N = 4200, FIRE_N = 46;
const NT = () => Props.trees.length, NR = () => Props.rocks.length;
const S = { tNear: null, tFar: null, rNear: null, rFar: null, tSh: [], rSh: [], cn: [0, 0, 0, 0, 0, 0, 0, 0] };

function initGL() {
  // verifica del supporto HDR: render target RGBA16F
  const ext = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_float_linear');
  HDR = false;
  if (ext) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    HDR = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f); gl.deleteTexture(t);
  }
  const qp = new URLSearchParams(location.search).get('q');
  setQuality(QUAL[qp] ? qp : 'alta');

  P.sky = program(SH.skyVS, SH.skyFS, 'sky');
  P.terrain = program(SH.terrainVS, SH.terrainFS, 'terrain');
  P.prop = program(SH.propVS, SH.propFS, 'prop');
  P.treeLow = program(SH.treeLowVS, SH.propFS, 'treeLow');
  P.tree = program(SH.treeVS, SH.treeFS, 'tree');
  P.rock = program(SH.rockVS, SH.rockFS, 'rock');
  P.grass = program(SH.grassVS, SH.grassFS, 'grass');
  P.water = program(SH.waterVS, SH.waterFS, 'water');
  P.snow = program(SH.snowVS, SH.snowFS, 'snow');
  P.fire = program(SH.fireVS, SH.fireFS, 'fire');
  P.ember = program(SH.emberVS, SH.emberFS, 'ember');
  P.smoke = program(SH.smokeVS, SH.smokeFS, 'smoke');
  P.shProp = program(SH.shPropVS, SH.shFS, 'shProp');
  P.shTree = program(SH.shTreeVS, SH.shFS, 'shTree');
  P.shRock = program(SH.shRockVS, SH.shFS, 'shRock');
  P.bloomDown = program(SH.postVS, SH.bloomDownFS, 'bloomDown');
  P.bloomUp = program(SH.postVS, SH.bloomUpFS, 'bloomUp');
  P.comp = program(SH.postVS, SH.compFS, 'comp');

  // terreno
  const td = terrainMeshData();
  VAO.terrain = gl.createVertexArray(); gl.bindVertexArray(VAO.terrain);
  B.tv = buf(gl.ARRAY_BUFFER, td.verts);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  B.ti = buf(gl.ELEMENT_ARRAY_BUFFER, td.idx);
  C.terrainIdx = td.idx.length;

  // rifugio
  const mb = new MB(); buildHut(mb);
  const stat = mb.buffer(); C.stat = stat.length / 11;
  VAO.stat = gl.createVertexArray(); gl.bindVertexArray(VAO.stat);
  B.stat = buf(gl.ARRAY_BUFFER, stat); setupPropLayout(44);
  VAO.shStat = posOnlyVAO(B.stat, 44, null);

  // oggetti dinamici
  VAO.dyn = gl.createVertexArray(); gl.bindVertexArray(VAO.dyn);
  B.dyn = buf(gl.ARRAY_BUFFER, new Float32Array(11 * 3), gl.DYNAMIC_DRAW); setupPropLayout(44);
  VAO.shDyn = posOnlyVAO(B.dyn, 44, null);
  rebuildDynamic();

  // alberi: istanze dinamiche (liste dopo il culling)
  const nT = Math.max(NT(), 1), nR = Math.max(NR(), 1);
  S.tNear = new Float32Array(nT * 6); S.tFar = new Float32Array(nT * 6);
  S.rNear = new Float32Array(nR * 6); S.rFar = new Float32Array(nR * 6);
  B.treeNear = buf(gl.ARRAY_BUFFER, S.tNear.byteLength, gl.DYNAMIC_DRAW);
  B.treeFar = buf(gl.ARRAY_BUFFER, S.tFar.byteLength, gl.DYNAMIC_DRAW);
  B.rockNear = buf(gl.ARRAY_BUFFER, S.rNear.byteLength, gl.DYNAMIC_DRAW);
  B.rockFar = buf(gl.ARRAY_BUFFER, S.rFar.byteLength, gl.DYNAMIC_DRAW);
  const pineLow = buildPineLow(), pineHigh = buildPineHigh();
  C.pineLow = pineLow.length / 11; C.pineHigh = pineHigh.length / 11;
  B.pineLow = buf(gl.ARRAY_BUFFER, pineLow); B.pineHigh = buf(gl.ARRAY_BUFFER, pineHigh);
  VAO.treeNear = gl.createVertexArray(); gl.bindVertexArray(VAO.treeNear);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.pineHigh); setupPropLayout(44); setupInstanceLayout(B.treeNear);
  VAO.treeFar = gl.createVertexArray(); gl.bindVertexArray(VAO.treeFar);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.pineLow); setupPropLayout(44); setupInstanceLayout(B.treeFar);

  const ico1 = buildIcosphere(1), ico3 = buildIcosphere(3);
  C.rock1 = ico1.length / 3; C.rock3 = ico3.length / 3;
  B.ico1 = buf(gl.ARRAY_BUFFER, ico1); B.ico3 = buf(gl.ARRAY_BUFFER, ico3);
  VAO.rockNear = posOnlyVAO(B.ico3, 12, B.rockNear);
  VAO.rockFar = posOnlyVAO(B.ico1, 12, B.rockFar);

  // liste per le ombre (una per cascata)
  VAO.shTree = []; VAO.shRock = []; B.shTree = []; B.shRock = []; S.tSh = []; S.rSh = [];
  for (let c = 0; c < 3; c++) {
    S.tSh.push(new Float32Array(nT * 6)); S.rSh.push(new Float32Array(nR * 6));
    B.shTree.push(buf(gl.ARRAY_BUFFER, S.tSh[c].byteLength, gl.DYNAMIC_DRAW));
    B.shRock.push(buf(gl.ARRAY_BUFFER, S.rSh[c].byteLength, gl.DYNAMIC_DRAW));
    VAO.shTree.push(posOnlyVAO(B.pineLow, 44, B.shTree[c]));
    VAO.shRock.push(posOnlyVAO(B.ico1, 12, B.shRock[c]));
  }

  // erba
  VAO.grass = gl.createVertexArray(); gl.bindVertexArray(VAO.grass);
  buf(gl.ARRAY_BUFFER, buildBlade());
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

  // acqua
  const lr = LAKE.r * 1.35;
  VAO.water = gl.createVertexArray(); gl.bindVertexArray(VAO.water);
  buf(gl.ARRAY_BUFFER, new Float32Array([LAKE.x - lr, LAKE.z - lr, LAKE.x + lr, LAKE.z - lr, LAKE.x - lr, LAKE.z + lr, LAKE.x + lr, LAKE.z - lr, LAKE.x + lr, LAKE.z + lr, LAKE.x - lr, LAKE.z + lr]));
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

  // neve e particelle del fuoco
  const sd = new Float32Array(SNOW_N * 3); for (let i = 0; i < sd.length; i++) sd[i] = Math.random();
  VAO.snow = gl.createVertexArray(); gl.bindVertexArray(VAO.snow);
  buf(gl.ARRAY_BUFFER, sd); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
  const fd = new Float32Array(FIRE_N * 3); for (let i = 0; i < fd.length; i++) fd[i] = Math.random();
  VAO.fire = gl.createVertexArray(); gl.bindVertexArray(VAO.fire);
  buf(gl.ARRAY_BUFFER, fd); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
  gl.bindVertexArray(null);

  // texture: altezze (R16F) e ombre di grande scala (RG8 x2)
  T.height = tex2D(TN, TN, gl.R16F, gl.RED, gl.FLOAT, Terrain.H, true);
  shadowBaker = new ShadowBaker(); shadowBaker.buildAO();
  const empty = new Uint8Array(TN * TN * 2).fill(255);
  T.shA = tex2D(TN, TN, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, empty, true);
  T.shB = tex2D(TN, TN, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, empty, true);
  shTexCur = T.shA; shTexNext = T.shB;
}

function rebuildDynamic() {
  const data = buildDynamic(G.fires);
  C.dyn = data.length / 11;
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.dyn);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
}

/* ============ Render target ============ */
function destroyTargets() {
  for (const k of ['res']) if (FB[k]) gl.deleteTexture(FB[k]);
  for (const k of ['resFbo', 'msFbo']) if (FB[k]) gl.deleteFramebuffer(FB[k]);
  for (const k of ['depthRB', 'msColor', 'msDepth']) if (FB[k]) gl.deleteRenderbuffer(FB[k]);
  for (const b of FB.bloom) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo); }
  FB.bloom = []; FB.res = FB.resFbo = FB.depthRB = FB.msFbo = FB.msColor = FB.msDepth = null;
}
function ensureTargets() {
  const key = R.w + 'x' + R.h + 'm' + Q.msaa + 'b' + (Q.bloom ? 1 : 0);
  if (FB.key === key) return;
  destroyTargets();
  const fmtI = HDR ? gl.RGBA16F : gl.RGBA8, type = HDR ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  const mk = (w, h) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmtI, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { tex: t, fbo: f, w, h };
  };
  const r = mk(R.w, R.h); FB.res = r.tex; FB.resFbo = r.fbo;
  if (Q.msaa > 0) {
    FB.msFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, FB.msFbo);
    FB.msColor = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, FB.msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, Q.msaa, fmtI, R.w, R.h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, FB.msColor);
    FB.msDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, FB.msDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, Q.msaa, gl.DEPTH_COMPONENT24, R.w, R.h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, FB.msDepth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      console.warn('MSAA non disponibile, passo a 0');
      Q.msaa = 0; gl.deleteFramebuffer(FB.msFbo); gl.deleteRenderbuffer(FB.msColor); gl.deleteRenderbuffer(FB.msDepth);
      FB.msFbo = FB.msColor = FB.msDepth = null;
    }
  }
  if (Q.msaa === 0) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, FB.resFbo);
    FB.depthRB = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, FB.depthRB);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, R.w, R.h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, FB.depthRB);
  }
  if (HDR && Q.bloom) {
    let w = R.w, h = R.h;
    for (let i = 0; i < 5; i++) { w = Math.max(2, w >> 1); h = Math.max(2, h >> 1); FB.bloom.push(mk(w, h)); }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  FB.key = key;
}
function ensureShadow() {
  if (FB.shRes === Q.shRes && FB.shTex) return;
  if (FB.shTex) { gl.deleteTexture(FB.shTex); gl.deleteFramebuffer(FB.sh); }
  FB.shTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, FB.shTex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT24, Q.shRes, Q.shRes, 3);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  FB.sh = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, FB.sh);
  gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, FB.shTex, 0, 0);
  gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  FB.shRes = Q.shRes;
  for (const c of casc) c.valid = false;
}

/* ============ Ambiente: sole, cielo, nebbia ============ */
const PAL = [
  // s,   zenith,                horizon,               luce,                  ambTop,                ambBot
  [-0.34, [0.004, 0.008, 0.026], [0.020, 0.034, 0.070], [0.10, 0.13, 0.23], [0.012, 0.020, 0.052], [0.006, 0.008, 0.016]],
  [-0.10, [0.018, 0.034, 0.090], [0.085, 0.080, 0.140], [0.10, 0.13, 0.23], [0.026, 0.040, 0.085], [0.010, 0.012, 0.022]],
  [-0.02, [0.060, 0.090, 0.200], [0.440, 0.250, 0.210], [0.14, 0.12, 0.16], [0.070, 0.085, 0.150], [0.030, 0.026, 0.030]],
  [0.04, [0.120, 0.220, 0.450], [0.480, 0.420, 0.400], [1.70, 1.14, 0.78], [0.200, 0.220, 0.330], [0.120, 0.090, 0.070]],
  [0.15, [0.160, 0.320, 0.620], [0.620, 0.630, 0.650], [2.50, 2.20, 1.90], [0.300, 0.380, 0.550], [0.160, 0.150, 0.130]],
  [0.46, [0.140, 0.340, 0.720], [0.550, 0.720, 0.920], [3.20, 2.90, 2.50], [0.380, 0.500, 0.720], [0.200, 0.190, 0.180]],
];
function palAt(s) {
  if (s <= PAL[0][0]) return PAL[0].slice(1);
  for (let i = 0; i < PAL.length - 1; i++) {
    const a = PAL[i], b = PAL[i + 1];
    if (s <= b[0]) {
      const t = (s - a[0]) / (b[0] - a[0]);
      return [1, 2, 3, 4, 5].map((k) => V3.mix(a[k], b[k], t));
    }
  }
  return PAL[PAL.length - 1].slice(1);
}
function sunDirAt(h) {
  const hh = ((h % 24) + 24) % 24;
  let ang;
  if (hh >= 7 && hh <= 17) ang = ((hh - 7) / 10) * Math.PI;
  else { const n = hh > 17 ? hh - 17 : hh + 7; ang = Math.PI + (n / 14) * Math.PI; }
  const el = Math.sin(ang) * 0.46;
  const az = (90 + (ang / Math.PI) * 180) * DEG;
  return V3.norm([Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]);
}
function computeEnv() {
  const sun = sunDirAt(G.hour), s = sun[1], w = G.weather;
  const moon = V3.norm([-sun[0], -sun[1], -sun[2]]);
  const [zen, hor, lc, at, ab] = palAt(s);
  const useSun = sstep(-0.06, 0.02, s);
  E.sun = sun; E.moon = moon;
  E.L = V3.norm(V3.mix(moon, sun, useSun));
  E.LCol = V3.mul(lc, 1 - 0.78 * w);
  E.AmbT = V3.mul(at, 1 - 0.3 * w); E.AmbB = V3.mul(ab, 1 - 0.3 * w);
  const lum = (c) => 0.33 * (c[0] + c[1] + c[2]);
  E.SkyZen = V3.mix(zen, [lum(zen) * 0.8, lum(zen) * 0.8, lum(zen) * 0.8], w * 0.7);
  E.SkyHor = V3.mix(hor, [lum(hor) * 0.82, lum(hor) * 0.85, lum(hor) * 0.9], w * 0.75);
  E.FogCol = E.SkyHor;
  const sunVis = sstep(-0.03, 0.03, s);
  E.SunVis = sunVis;
  E.SunCol = V3.mul(palAt(Math.max(s, 0.05))[2], 2.2);
  E.SunGlow = V3.mul(palAt(Math.max(s, 0.03))[2], 0.1 * sunVis);
  E.Night = sstep(0.02, -0.16, s);
  E.FogDen = 0.00045;
  E.Exposure = lerp(0.62, 1.75, E.Night);
  E.WindAmt = clamp(0.12 + 0.88 * w + G.gust * 0.15, 0, 1);
}

/* ============ Ombre a cascata ============ */
const casc = [0, 1, 2].map(() => ({ M: new Float32Array(16), valid: false, tw: 0.1, range: 100, cx: 0, cz: 0, rad: 10, VP: null }));
const SPLITS3 = [0.1, 12, 40, 120], SPLITS2 = [0.1, 18, 70];
let frameNo = 0;
function splits() { return Q.casc >= 3 ? SPLITS3 : SPLITS2; }

function computeCascade(c) {
  const sp = splits(), near = sp[c], far = sp[c + 1];
  const asp = R.w / R.h, ty = Math.tan(R.fov / 2), tx = ty * asp;
  const pts = [];
  for (const d of [near, far])
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        pts.push([
          R.cam[0] + R.f[0] * d + R.r[0] * sx * tx * d + R.u[0] * sy * ty * d,
          R.cam[1] + R.f[1] * d + R.r[1] * sx * tx * d + R.u[1] * sy * ty * d,
          R.cam[2] + R.f[2] * d + R.r[2] * sx * tx * d + R.u[2] * sy * ty * d,
        ]);
  let ctr = [0, 0, 0];
  for (const p of pts) ctr = V3.add(ctr, p);
  ctr = V3.mul(ctr, 1 / pts.length);
  let rad = 0;
  for (const p of pts) rad = Math.max(rad, V3.len(V3.sub(p, ctr)));
  rad = Math.ceil(rad * 8) / 8;
  const dir = V3.mul(E.L, -1);
  const lb = M4.lookDir([0, 0, 0], dir, [0, 1, 0]);
  const texel = (2 * rad) / Q.shRes;
  const sx = V3.dot(ctr, lb.r), sy = V3.dot(ctr, lb.u);
  const snx = Math.floor(sx / texel) * texel, sny = Math.floor(sy / texel) * texel;
  ctr = V3.add(ctr, V3.add(V3.mul(lb.r, snx - sx), V3.mul(lb.u, sny - sy)));
  const ZEXT = 140;
  const eye = V3.sub(ctr, V3.mul(dir, rad + ZEXT));
  const view = M4.lookDir(eye, dir, [0, 1, 0]).m;
  const range = 2 * rad + ZEXT;
  const proj = M4.ortho(-rad, rad, -rad, rad, 0, range);
  const cc = casc[c];
  cc.M = M4.mul(proj, view); cc.tw = texel; cc.range = range; cc.cx = ctr[0]; cc.cz = ctr[2]; cc.rad = rad; cc.valid = true;
}

/* ============ Culling e LOD ============ */
function packList(src, n, out, test) {
  let k = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    if (test(src[o], src[o + 1], src[o + 2], src[o + 3])) {
      out[k] = src[o]; out[k + 1] = src[o + 1]; out[k + 2] = src[o + 2]; out[k + 3] = src[o + 3]; out[k + 4] = src[o + 4]; out[k + 5] = src[o + 5];
      k += 6;
    }
  }
  return k / 6;
}
function visibilityTest(near, far, margin) {
  const cx = R.cam[0], cy = R.cam[1], cz = R.cam[2], f = R.f, r = R.r;
  const tx = Math.tan(R.fov / 2) * (R.w / R.h) * 1.15;
  const n2 = near * near, f2 = far * far;
  return (x, y, z, s) => {
    const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
    if (d2 > f2) return false;
    if (d2 > n2 === false) return true;                    // vicinissimo: sempre
    const dy = y - cy;
    const fw = dx * f[0] + dy * f[1] + dz * f[2];
    if (fw < -margin * 1.5 && d2 > 400) return false;
    const lat = Math.abs(dx * r[0] + dy * r[1] + dz * r[2]);
    return lat <= Math.max(fw, 0) * tx + margin * (1 + s * 0.4);
  };
}
function cullAll() {
  const td = Props.treeData, rd = Props.rockData;
  const nT = NT(), nR = NR();
  const mk = (nearR, farR, margin) => {
    const vN = visibilityTest(0, nearR, margin), vF = visibilityTest(nearR, farR, margin);
    const n2 = nearR * nearR;
    const inN = (x, y, z, s) => { const dx = x - R.cam[0], dz = z - R.cam[2]; return dx * dx + dz * dz <= n2 && vN(x, y, z, s); };
    const inF = (x, y, z, s) => { const dx = x - R.cam[0], dz = z - R.cam[2]; return dx * dx + dz * dz > n2 && vF(x, y, z, s); };
    return [inN, inF];
  };
  const [tn, tf] = mk(Q.treeNear, 780, 9);
  S.cn[0] = packList(td, nT, S.tNear, tn); S.cn[1] = packList(td, nT, S.tFar, tf);
  const [rn, rf] = mk(Q.rockNear, 520, 4);
  S.cn[2] = packList(rd, nR, S.rNear, rn); S.cn[3] = packList(rd, nR, S.rFar, rf);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.treeNear); gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.tNear, 0, S.cn[0] * 6);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.treeFar); gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.tFar, 0, S.cn[1] * 6);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.rockNear); gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.rNear, 0, S.cn[2] * 6);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.rockFar); gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.rFar, 0, S.cn[3] * 6);
}
function cullShadow(c) {
  const cc = casc[c], rr = cc.rad + 24, r2 = rr * rr, td = Props.treeData, rd = Props.rockData;
  const test = (x, y, z) => { const dx = x - cc.cx, dz = z - cc.cz; return dx * dx + dz * dz < r2; };
  const nt = packList(td, NT(), S.tSh[c], test);
  const nr = packList(rd, NR(), S.rSh[c], (x, y, z, s) => s > 0.3 && test(x, y, z));
  gl.bindBuffer(gl.ARRAY_BUFFER, B.shTree[c]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.tSh[c], 0, nt * 6);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.shRock[c]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.rSh[c], 0, nr * 6);
  cc.nt = nt; cc.nr = nr;
}

/* ============ Uniform comuni ============ */
const smVP = new Float32Array(48), splitU = new Float32Array(3), texelU = new Float32Array(3), rangeU = new Float32Array(3);
function setCommon(p) {
  gl.useProgram(p);
  const u = (n) => U(p, n);
  gl.uniformMatrix4fv(u('uVP'), false, R.vp);
  gl.uniform3fv(u('uCam'), R.cam); gl.uniform3fv(u('uCamF'), R.f);
  gl.uniform1f(u('uTime'), G.clock);
  gl.uniform3fv(u('uL'), E.L); gl.uniform3fv(u('uLCol'), E.LCol);
  gl.uniform3fv(u('uAmbT'), E.AmbT); gl.uniform3fv(u('uAmbB'), E.AmbB);
  gl.uniform3fv(u('uFogCol'), E.FogCol); gl.uniform3fv(u('uSunGlow'), E.SunGlow);
  gl.uniform3fv(u('uSunDir'), E.sun);
  gl.uniform1f(u('uFogDen'), E.FogDen); gl.uniform1f(u('uWeather'), G.weather);
  gl.uniform1f(u('uSnow'), G.snow); gl.uniform1f(u('uWindAmt'), E.WindAmt);
  gl.uniform4fv(u('uFire'), E.fireU);
  gl.uniform4f(u('uLamp'), 0, 0, 0, G.lamp && G.state !== 'menu' ? lerp(0.22, 1, E.Night) : 0);
  gl.uniform1f(u('uWorldHalf'), HALF); gl.uniform1f(u('uShMix'), shMix);
  gl.uniform1f(u('uExposure'), E.Exposure);
  gl.uniform3fv(u('uSkyZen'), E.SkyZen); gl.uniform3fv(u('uSkyHor'), E.SkyHor);
  gl.uniform3fv(u('uMoonDir'), E.moon); gl.uniform3fv(u('uSunCol'), E.SunCol);
  gl.uniform1f(u('uNight'), E.Night); gl.uniform1f(u('uSunVis'), E.SunVis);
  gl.uniform4f(u('uHut'), HUT.x, HUT.z, HUT.hx + 0.1, HUT.hz + 0.1); gl.uniform1f(u('uHutY'), Hut.y0);
  gl.uniform1f(u('uShOn'), E.shOn); gl.uniform1f(u('uShTaps'), Q.taps);
  gl.uniformMatrix4fv(u('uSM'), false, smVP);
  gl.uniform3fv(u('uSplit'), splitU); gl.uniform3fv(u('uTexelW'), texelU); gl.uniform3fv(u('uSMRange'), rangeU);
}
function bindShadows(p) {
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shTexCur); gl.uniform1i(U(p, 'uShA'), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shTexNext); gl.uniform1i(U(p, 'uShB'), 1);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, FB.shTex); gl.uniform1i(U(p, 'uSMap'), 3);
}
function bindHeight(p) {
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.height); gl.uniform1i(U(p, 'uHeight'), 2);
}

function updateFireUniforms() {
  const all = [{ x: Hut.fire[0] + HUT.x, y: Hut.fire[1], z: Hut.fire[2] + HUT.z, i: 1.15, hut: true }];
  for (const f of G.fires) all.push({ x: f.x, y: f.y + 0.7, z: f.z, i: f.inten });
  all.sort((a, b) => Math.hypot(a.x - R.cam[0], a.z - R.cam[2]) - Math.hypot(b.x - R.cam[0], b.z - R.cam[2]));
  E.fireU = new Float32Array(16);
  E.fireList = all;
  for (let i = 0; i < 4 && i < all.length; i++) {
    E.fireU[i * 4] = all[i].x; E.fireU[i * 4 + 1] = all[i].y; E.fireU[i * 4 + 2] = all[i].z; E.fireU[i * 4 + 3] = all[i].i;
  }
}

/* ============ Disegno ============ */
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * G.scale;
  const w = Math.max(2, Math.floor(canvas.clientWidth * dpr)), h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  R.w = w; R.h = h;
}

function renderShadows() {
  E.shOn = 0;
  const nC = Q.casc;
  if (!(E.L[1] > 0.03) || nC === 0) return;
  E.shOn = 1;
  const sp = splits();
  gl.bindFramebuffer(gl.FRAMEBUFFER, FB.sh);
  gl.viewport(0, 0, Q.shRes, Q.shRes);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
  gl.colorMask(false, false, false, false);
  gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.0, 4.0);
  for (let c = 0; c < nC; c++) {
    const cc = casc[c];
    const period = c === 2 ? 2 : 1;
    if (!cc.valid || frameNo % period === 0) {
      computeCascade(c); cullShadow(c);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, FB.shTex, 0, c);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(P.shProp); gl.uniformMatrix4fv(U(P.shProp, 'uSMVP'), false, cc.M);
      gl.bindVertexArray(VAO.shStat); gl.drawArrays(gl.TRIANGLES, 0, C.stat);
      if (C.dyn > 0) { gl.bindVertexArray(VAO.shDyn); gl.drawArrays(gl.TRIANGLES, 0, C.dyn); }
      if (cc.nt > 0) {
        gl.useProgram(P.shTree); gl.uniformMatrix4fv(U(P.shTree, 'uSMVP'), false, cc.M);
        gl.bindVertexArray(VAO.shTree[c]); gl.drawArraysInstanced(gl.TRIANGLES, 0, C.pineLow, cc.nt);
      }
      if (cc.nr > 0) {
        gl.useProgram(P.shRock); gl.uniformMatrix4fv(U(P.shRock, 'uSMVP'), false, cc.M);
        gl.bindVertexArray(VAO.shRock[c]); gl.drawArraysInstanced(gl.TRIANGLES, 0, C.rock1, cc.nr);
      }
    }
  }
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.colorMask(true, true, true, true);
  for (let c = 0; c < 3; c++) {
    const cc = casc[c];
    smVP.set(cc.M, c * 16); texelU[c] = cc.tw; rangeU[c] = cc.range;
  }
  splitU[0] = sp[1]; splitU[1] = sp[2]; splitU[2] = sp.length > 3 ? sp[3] : sp[2];
}

function render() {
  resize();
  ensureTargets(); ensureShadow();
  frameNo++;
  gl.bindVertexArray(null);
  const asp = R.w / R.h;
  const proj = M4.persp(R.fov, asp, R.near, R.far);
  const v = M4.view(R.cam, R.yawC, R.pitchC);
  R.vp = M4.mul(proj, v.m); R.f = v.f; R.r = v.r; R.u = v.u;
  updateFireUniforms();
  cullAll();
  renderShadows();

  const msaa = Q.msaa > 0 && FB.msFbo;
  gl.bindFramebuffer(gl.FRAMEBUFFER, msaa ? FB.msFbo : FB.resFbo);
  gl.viewport(0, 0, R.w, R.h);
  gl.clearColor(E.FogCol[0] * 0.2, E.FogCol[1] * 0.2, E.FogCol[2] * 0.2, 1);
  gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);

  // cielo
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  setCommon(P.sky);
  gl.uniform3fv(U(P.sky, 'uCamR'), R.r); gl.uniform3fv(U(P.sky, 'uCamU'), R.u);
  gl.uniform2f(U(P.sky, 'uTanAsp'), Math.tan(R.fov / 2), asp);
  gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);

  // terreno
  setCommon(P.terrain); bindShadows(P.terrain);
  gl.bindVertexArray(VAO.terrain); gl.drawElements(gl.TRIANGLES, C.terrainIdx, gl.UNSIGNED_INT, 0);

  // rifugio e oggetti
  setCommon(P.prop); bindShadows(P.prop);
  gl.bindVertexArray(VAO.stat); gl.drawArrays(gl.TRIANGLES, 0, C.stat);
  if (C.dyn > 0) { gl.bindVertexArray(VAO.dyn); gl.drawArrays(gl.TRIANGLES, 0, C.dyn); }

  // alberi lontani (mesh semplice)
  if (S.cn[1] > 0) {
    setCommon(P.treeLow); bindShadows(P.treeLow);
    gl.bindVertexArray(VAO.treeFar); gl.drawArraysInstanced(gl.TRIANGLES, 0, C.pineLow, S.cn[1]);
  }
  // alberi vicini (rami + aghi, alpha-to-coverage)
  if (S.cn[0] > 0) {
    setCommon(P.tree); bindShadows(P.tree);
    gl.uniform1f(U(P.tree, 'uA2C'), msaa ? 1 : 0);
    if (msaa) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.bindVertexArray(VAO.treeNear); gl.drawArraysInstanced(gl.TRIANGLES, 0, C.pineHigh, S.cn[0]);
    if (msaa) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  }
  // rocce
  if (S.cn[3] > 0 || S.cn[2] > 0) {
    setCommon(P.rock); bindShadows(P.rock);
    if (S.cn[3] > 0) { gl.bindVertexArray(VAO.rockFar); gl.drawArraysInstanced(gl.TRIANGLES, 0, C.rock1, S.cn[3]); }
    if (S.cn[2] > 0) { gl.bindVertexArray(VAO.rockNear); gl.drawArraysInstanced(gl.TRIANGLES, 0, C.rock3, S.cn[2]); }
  }
  // erba
  if (Q.grass > 0) {
    setCommon(P.grass); bindShadows(P.grass); bindHeight(P.grass);
    const side = Math.ceil(Math.sqrt(Q.grass));
    gl.uniform1f(U(P.grass, 'uGrassSide'), side); gl.uniform1f(U(P.grass, 'uGrassR'), 30);
    gl.bindVertexArray(VAO.grass); gl.drawArraysInstanced(gl.TRIANGLES, 0, 15, side * side);
  }

  // acqua
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  setCommon(P.water);
  gl.uniform1f(U(P.water, 'uWaterY'), WATER_Y);
  bindHeight(P.water);
  gl.bindVertexArray(VAO.water); gl.drawArrays(gl.TRIANGLES, 0, 6);

  // fumo del camino
  const pix = R.h / 900;
  const hutLit = 1.0;
  setCommon(P.smoke);
  gl.uniform1f(U(P.smoke, 'uPix'), pix);
  gl.uniform4f(U(P.smoke, 'uFP'), Hut.chimney[0] + HUT.x, Hut.chimney[1], Hut.chimney[2] + HUT.z, hutLit);
  gl.bindVertexArray(VAO.fire); gl.drawArrays(gl.POINTS, 0, 22);
  for (const f of G.fires) {
    if (f.inten < 0.1) continue;
    gl.uniform4f(U(P.smoke, 'uFP'), f.x, f.y + 0.9, f.z, f.inten * 0.7);
    gl.drawArrays(gl.POINTS, 0, 14);
  }

  // neve
  const rate = clamp((G.weather - 0.2) / 0.8, 0, 1);
  if (rate > 0.01) {
    setCommon(P.snow);
    gl.uniform1f(U(P.snow, 'uRate'), rate);
    gl.uniform1f(U(P.snow, 'uPix'), pix);
    gl.uniform2f(U(P.snow, 'uWind'), 3.5 * E.WindAmt, 1.4 * E.WindAmt);
    gl.bindVertexArray(VAO.snow); gl.drawArrays(gl.POINTS, 0, SNOW_N);
  }

  // fiamme e braci (additivo)
  gl.blendFunc(gl.ONE, gl.ONE);
  const flames = [{ x: Hut.fire[0] + HUT.x, y: Hut.fire[1] - 0.45, z: Hut.fire[2] + HUT.z, i: 0.5 }];
  for (const f of G.fires) flames.push({ x: f.x, y: f.y + 0.15, z: f.z, i: f.inten });
  setCommon(P.fire);
  gl.uniform1f(U(P.fire, 'uPix'), pix);
  gl.bindVertexArray(VAO.fire);
  for (const f of flames) {
    if (f.i < 0.02) continue;
    gl.uniform4f(U(P.fire, 'uFP'), f.x, f.y, f.z, f.i);
    gl.drawArrays(gl.POINTS, 0, FIRE_N);
  }
  setCommon(P.ember);
  gl.uniform1f(U(P.ember, 'uPix'), pix);
  gl.bindVertexArray(VAO.fire);
  for (const f of flames) {
    if (f.i < 0.02) continue;
    gl.uniform4f(U(P.ember, 'uFP'), f.x, f.y, f.z, f.i);
    gl.drawArrays(gl.POINTS, 0, FIRE_N);
  }
  gl.bindVertexArray(null);
  gl.depthMask(true); gl.disable(gl.BLEND);

  // risoluzione MSAA
  if (msaa) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, FB.msFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, FB.resFbo);
    gl.blitFramebuffer(0, 0, R.w, R.h, 0, 0, R.w, R.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  postProcess();
}

function postProcess() {
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
  const useBloom = HDR && Q.bloom && FB.bloom.length === 5;
  if (useBloom) {
    gl.useProgram(P.bloomDown);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(U(P.bloomDown, 'uTex'), 0);
    for (let i = 0; i < 5; i++) {
      const dst = FB.bloom[i], srcTex = i === 0 ? FB.res : FB.bloom[i - 1].tex;
      const sw = i === 0 ? R.w : FB.bloom[i - 1].w, sh = i === 0 ? R.h : FB.bloom[i - 1].h;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo); gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform2f(U(P.bloomDown, 'uTexel'), 1 / sw, 1 / sh); gl.uniform1f(U(P.bloomDown, 'uFirst'), i === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.useProgram(P.bloomUp);
    gl.uniform1i(U(P.bloomUp, 'uTex'), 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = 3; i >= 0; i--) {
      const dst = FB.bloom[i], src = FB.bloom[i + 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo); gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform2f(U(P.bloomUp, 'uTexel'), 1 / src.w, 1 / src.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, R.w, R.h);
  gl.useProgram(P.comp);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, FB.res); gl.uniform1i(U(P.comp, 'uScene'), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, useBloom ? FB.bloom[0].tex : FB.res); gl.uniform1i(U(P.comp, 'uBloom'), 1);
  gl.uniform2f(U(P.comp, 'uPx'), 1 / R.w, 1 / R.h);
  gl.uniform1f(U(P.comp, 'uBloomK'), useBloom ? 0.07 + 0.12 * E.Night + 0.05 * G.weather : 0);
  gl.uniform1f(U(P.comp, 'uExp'), E.Exposure);
  gl.uniform1f(U(P.comp, 'uTime'), G.clock % 100);
  gl.uniform1f(U(P.comp, 'uCold'), clamp((45 - G.warmth) / 45, 0, 1) * (G.state === 'play' ? 1 : 0));
  gl.uniform1f(U(P.comp, 'uSharp'), 0.5 + (1 - G.scale) * 0.8);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
}

/* ============ Ombre di grande scala: ri-bake progressivo con dissolvenza ============ */
function updateShadows(dt) {
  if (shBlend) {
    shMix = Math.min(1, shMix + dt / 3);
    if (shMix >= 1) { const t = shTexCur; shTexCur = shTexNext; shTexNext = t; shMix = 0; shBlend = false; }
  }
  if (shadowBaker.active) {
    if (shadowBaker.step(3)) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, shTexNext);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TN, TN, gl.RG, gl.UNSIGNED_BYTE, shadowBaker.buf);
      shBlend = true; shMix = 0;
    }
  } else if (!shBlend) {
    const L = E.L, d = L[0] * G.lastBake[0] + L[1] * G.lastBake[1] + L[2] * G.lastBake[2];
    if (d < 0.9992) { shadowBaker.start(L); G.lastBake = L.slice(); }
  }
}
