'use strict';
/* Valico — gioco: giocatore, sopravvivenza, meteo, obiettivi, interfaccia, ciclo principale. */

G.clock = 0;
const tmpC = [];
const rngPlay = mulberry32(4242);

/* ---------- Interfaccia ---------- */
let toastTimer = 0, noteTimer = 0;
function toast(txt, dur = 3.6) {
  const t = $('toast'); t.textContent = txt; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), dur * 1000);
}
function showNote(title, txt, dur = 8) {
  const n = $('note'); n.innerHTML = '<b></b><span></span>';
  n.firstChild.textContent = title; n.lastChild.textContent = txt; n.classList.add('on');
  clearTimeout(noteTimer); noteTimer = setTimeout(() => n.classList.remove('on'), dur * 1000);
}
function fmtClock(h) {
  const hh = Math.floor(((h % 24) + 24) % 24), mm = Math.floor((h % 1) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

const cctx = $('compass').getContext('2d');
const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
function drawCompass() {
  const W = 760, Hh = 58, ppd = 5.2;
  cctx.clearRect(0, 0, W, Hh);
  const hd = (((G.yaw / DEG) % 360) + 360) % 360;
  cctx.textAlign = 'center'; cctx.lineWidth = 1.4;
  const base = Math.round(hd);
  for (let d = -80; d <= 80; d++) {
    const ang = base + d;
    if (ang % 5 !== 0) continue;
    const a = ((ang % 360) + 360) % 360, x = W / 2 + (ang - hd) * ppd;
    cctx.strokeStyle = 'rgba(236,233,225,0.85)';
    cctx.beginPath();
    if (a % 45 === 0) {
      cctx.moveTo(x, 34); cctx.lineTo(x, 46); cctx.stroke();
      cctx.fillStyle = a === 0 ? '#d9a05b' : '#ece9e1'; cctx.font = '600 17px Georgia, serif';
      cctx.fillText(CARD[a], x, 28);
    } else if (a % 15 === 0) {
      cctx.moveTo(x, 36); cctx.lineTo(x, 46); cctx.stroke();
      cctx.fillStyle = 'rgba(236,233,225,0.7)'; cctx.font = '11px system-ui, sans-serif';
      cctx.fillText(String(a).padStart(3, '0'), x, 30);
    } else { cctx.moveTo(x, 41); cctx.lineTo(x, 46); cctx.stroke(); }
  }
  cctx.fillStyle = '#d9a05b';
  cctx.beginPath(); cctx.moveTo(W / 2, 52); cctx.lineTo(W / 2 - 5, 58); cctx.lineTo(W / 2 + 5, 58); cctx.closePath(); cctx.fill();
  if (G.ping && G.ping.m) {
    const m = G.ping.m, b = ((Math.atan2(m.x - G.pos[0], -(m.z - G.pos[2])) / DEG) + 360) % 360;
    const diff = ((b - hd + 540) % 360) - 180;
    const x = W / 2 + clamp(diff, -76, 76) * ppd, edge = Math.abs(diff) > 76;
    cctx.save(); cctx.translate(x, 14); cctx.rotate(Math.PI / 4);
    cctx.fillStyle = edge ? 'rgba(217,160,91,0.5)' : '#d9a05b'; cctx.fillRect(-5, -5, 10, 10); cctx.restore();
    const dist = Math.round(Math.hypot(m.x - G.pos[0], m.z - G.pos[2]) / 10) * 10;
    cctx.fillStyle = '#ece9e1'; cctx.font = '11px system-ui, sans-serif'; cctx.fillText(dist + ' m', x, 36);
  }
}

function updateHUD() {
  $('barWarm').style.width = G.warmth.toFixed(1) + '%';
  $('barWarm').style.background = G.warmth > 38 ? '#d9a05b' : '#9db8cc';
  const smax = 45 + 0.55 * G.warmth;
  $('barStam').style.width = clamp((G.stamina / 100) * 100, 0, 100).toFixed(1) + '%';
  $('barStam').style.opacity = G.stamina < smax * 0.2 ? 0.55 : 1;
  $('matches').textContent = G.matches;
  $('lampState').textContent = G.lamp ? 'torcia accesa' : 'torcia spenta';
  $('clock').textContent = fmtClock(G.hour);
  $('alt').textContent = Math.round(G.pos[1] + ALT_OFFSET) + ' m';
  $('temp').textContent = Math.round(G.temp) + ' °C';
  const left = Math.max(0, G.endHour - G.hour);
  let obj;
  if (G.collected >= 5) obj = 'Torna al rifugio e aspetta l\'alba';
  else obj = 'Segnavia ' + G.collected + ' / 5 · premi R per il segnale radio';
  if (G.warmth < 32 && !G.inHut) obj = 'Hai freddo — accendi un fuoco (F) o raggiungi il rifugio';
  $('objective').textContent = obj;
  $('frost').style.opacity = clamp((50 - G.warmth) / 50, 0, 1) * 0.9;
  $('dark').style.opacity = clamp((22 - G.warmth) / 22, 0, 1) * 0.85;
}

/* ---------- Input ---------- */
window.addEventListener('keydown', (e) => {
  if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
  G.keys[e.code] = true;
  if (G.state !== 'play') return;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
  if (e.code === 'KeyE') interact();
  else if (e.code === 'KeyF') lightFire();
  else if (e.code === 'KeyL') { G.lamp = !G.lamp; }
  else if (e.code === 'KeyR') radioPing();
  else if (e.code === 'Escape' && G.noLock) pauseGame();
});
window.addEventListener('keyup', (e) => { G.keys[e.code] = false; });
window.addEventListener('blur', () => { G.keys = {}; if (G.state === 'play') pauseGame(); });
document.addEventListener('mousemove', (e) => {
  if (G.state !== 'play') return;
  if (G.locked || G.mouseDown) {
    G.yaw += e.movementX * 0.0022;
    G.pitch = clamp(G.pitch - e.movementY * 0.0022, -1.5, 1.5);
  }
});
canvas.addEventListener('mousedown', () => { G.mouseDown = true; if (G.state === 'play' && !G.locked && !G.noLock) requestLock(); });
window.addEventListener('mouseup', () => { G.mouseDown = false; });
document.addEventListener('pointerlockchange', () => {
  G.locked = document.pointerLockElement === canvas;
  if (!G.locked && G.state === 'play' && !G.noLock) pauseGame();
});
document.addEventListener('pointerlockerror', () => { G.noLock = true; });
function requestLock() {
  try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { G.noLock = true; }); } catch (e) { G.noLock = true; }
}

/* ---------- Collisioni ---------- */
const PR = 0.38;
function resolveCollisions(x, z) {
  const near = nearCircles(x, z, tmpC);
  for (let i = 0; i < near.length; i += 3) {
    const dx = x - near[i], dz = z - near[i + 1], d = Math.hypot(dx, dz), min = near[i + 2] + PR;
    if (d < min && d > 1e-4) { x = near[i] + (dx / d) * min; z = near[i + 1] + (dz / d) * min; }
  }
  for (const b of Hut.aabb) {
    const cx = clamp(x, b[0], b[1]), cz = clamp(z, b[2], b[3]);
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
    if (d < PR) {
      if (d > 1e-5) { x = cx + (dx / d) * PR; z = cz + (dz / d) * PR; }
      else {
        const l = x - b[0], r = b[1] - x, t = z - b[2], bt = b[3] - z, m = Math.min(l, r, t, bt);
        if (m === l) x = b[0] - PR; else if (m === r) x = b[1] + PR; else if (m === t) z = b[2] - PR; else z = b[3] + PR;
      }
    }
  }
  const rr = Math.hypot(x, z), lim = 585;
  if (rr > lim) {
    x *= lim / rr; z *= lim / rr;
    if (!G.edgeMsg || G.clock - G.edgeMsg > 8) { G.edgeMsg = G.clock; toast('Una parete di roccia e il vento ti impediscono di proseguire.'); }
  }
  return [x, z];
}

function groundAt(x, z) {
  let g = heightAt(x, z);
  if (Hut.onFloor(x, z)) g = Math.max(g, Hut.y0);
  else if (Math.abs(x - HUT.x) < 1.1 && z > HUT.z + HUT.hz + 0.35 && z < HUT.z + HUT.hz + 1.45) g = Math.max(g, Hut.y0 - 0.02);
  return g;
}

/* ---------- Meteo e ambiente ---------- */
function weatherTarget() {
  const e = G.hour - 16.33;
  let w = sstep(0.8, 5.2, e) * 0.88 * (1 - sstep(10.5, 14.5, e) * 0.68);
  w += 0.05 * Math.sin(G.clock * 0.05) + 0.04 * Math.sin(e * 1.7);
  return clamp(w + 0.1, 0.08, 1);
}
function tempAt(y) {
  const night = sstep(0.05, -0.12, E.sun[1]);
  return 3.5 - (y - 42) * 0.0065 - night * 8 - G.weather * 7;
}

/* ---------- Giocatore ---------- */
function updatePlayer(dt) {
  const k = G.keys;
  const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
  const str = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  const sy = Math.sin(G.yaw), cy = Math.cos(G.yaw);
  let wx = sy * fwd + cy * str, wz = -cy * fwd + sy * str;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  const crouching = !!k.KeyC;
  G.crouch = lerp(G.crouch, crouching ? 1 : 0, clamp(dt * 8, 0, 1));
  if (G.stamina < 1) G.exhausted = true; else if (G.stamina > 18) G.exhausted = false;
  const sprint = !!(k.ShiftLeft || k.ShiftRight) && fwd > 0 && !G.exhausted && !crouching && wl > 0;
  let speed = crouching ? 1.8 : sprint ? 6.3 : 3.5;
  const x = G.pos[0], z = G.pos[2];
  const g = gradAt(x, z), ahead = wx * g[0] + wz * g[1];
  if (ahead > 0.35) speed *= 1 - clamp((ahead - 0.35) * 0.9, 0, 0.78);
  speed *= 1 - 0.2 * G.snow * (G.inHut ? 0 : 1);
  const wd = WATER_Y - heightAt(x, z);
  G.inWater = clamp(wd, 0, 3);
  if (wd > 1.2) speed *= 0.4; else if (wd > 0.25) speed *= 0.58;
  if (G.warmth < 15) speed *= 0.72;
  const acc = G.onGround ? 14 : 3;
  G.vel[0] += (wx * speed - G.vel[0]) * clamp(acc * dt, 0, 1);
  G.vel[2] += (wz * speed - G.vel[2]) * clamp(acc * dt, 0, 1);

  let nx = x + G.vel[0] * dt, nz = z + G.vel[2] * dt;
  const step = Math.hypot(nx - x, nz - z);
  if (step > 1e-5) {
    const dh = groundAt(nx, nz) - groundAt(x, z);
    if (G.onGround && dh > 1.3 * step + 0.02 && dh > 0.05 && !Hut.onFloor(nx, nz)) {
      const dhx = groundAt(nx, z) - groundAt(x, z), dhz = groundAt(x, nz) - groundAt(x, z);
      if (dhx <= 1.3 * Math.abs(nx - x) + 0.02) nz = z; else if (dhz <= 1.3 * Math.abs(nz - z) + 0.02) nx = x; else { nx = x; nz = z; }
    }
    [nx, nz] = resolveCollisions(nx, nz);
  }
  G.pos[0] = nx; G.pos[2] = nz;

  const gy = groundAt(nx, nz);
  if (k.Space && G.onGround && !crouching && !G.exhausted) { G.vy = 5.1; G.onGround = false; G.stamina -= 6; }
  if (G.onGround && G.vy <= 0) { G.pos[1] = gy; }
  else {
    G.pos[1] += G.vy * dt; G.vy -= 17 * dt;
    if (G.pos[1] <= gy) { G.pos[1] = gy; G.vy = 0; G.onGround = true; if (G.landSound === undefined) G.landSound = 0; Aud.step(G.surface, true); }
  }
  if (!G.onGround && G.pos[1] - gy < 0.04 && G.vy <= 0) G.onGround = true;

  G.inHut = Hut.inside(nx, nz) && G.pos[1] < Hut.y0 + 1;
  const spd = Math.hypot(G.vel[0], G.vel[2]);
  const moving = spd > 0.4 && G.onGround;
  G.sprinting = sprint && moving;
  // stamina
  if (G.sprinting) G.stamina -= 16 * dt;
  else G.stamina += (G.warmth < 30 ? 5 : 10) * dt * (spd < 0.5 ? 1.3 : 1);
  G.stamina = clamp(G.stamina, 0, 45 + 0.55 * G.warmth);

  // superficie, passi, bobbing
  const snowLine = lerp(330, 12, G.snow);
  if (G.inWater > 0.2) G.surface = 'water';
  else if (Hut.onFloor(nx, nz)) G.surface = 'wood';
  else if (G.pos[1] > snowLine - 10 || G.snow > 0.5) G.surface = 'snow';
  else if (slopeAt(nx, nz) > 0.4) G.surface = 'rock';
  else G.surface = 'grass';
  if (moving) {
    const stepLen = G.sprinting ? 2.4 : crouching ? 1.2 : 1.8;
    const prev = Math.floor(G.stride / Math.PI);
    G.stride += (spd * dt / stepLen) * Math.PI;
    if (Math.floor(G.stride / Math.PI) !== prev) Aud.step(G.surface, G.sprinting);
    G.bob = Math.sin(G.stride) * (G.sprinting ? 0.06 : 0.035) * (1 - G.crouch * 0.5);
  } else G.bob *= 0.85;

  const eye = lerp(1.7, 1.05, G.crouch);
  const target = G.pos[1] + eye;
  G.camY = lerp(G.camY, target, clamp(dt * (G.onGround ? 16 : 40), 0, 1));
}

/* ---------- Sopravvivenza ---------- */
function updateSurvival(dt) {
  G.temp = tempAt(G.pos[1]);
  let loss = 0.03 + Math.max(0, 2 - G.temp) * 0.0125;
  loss *= 1 + G.weather * 0.9;
  if (G.inWater > 0.25) loss *= 4;
  if (G.sprinting) loss *= 1.2;
  else if (Math.hypot(G.vel[0], G.vel[2]) > 0.5) loss *= 0.8;
  if (G.inHut) loss *= 0.1;
  let gain = 0;
  for (const f of E.fireList || []) {
    const d = Math.hypot(f.x - G.pos[0], f.z - G.pos[2]);
    if (d < 8) gain += f.i * Math.pow(1 - d / 8, 1.1) * 6.5;
  }
  G.warmth = clamp(G.warmth + (gain - loss) * dt, 0, 100);
  if (G.warmth <= 0) endGame('lose');
  // battito
  if (G.warmth < 22) {
    G.heart -= dt;
    if (G.heart <= 0) { G.heart = 0.55 + G.warmth * 0.03; Aud.heartbeat(); }
  }
  // fuochi
  let changed = false;
  for (const f of G.fires) {
    f.age += dt;
    f.inten = Math.min(1, f.age / 2.5) * (1 - sstep(f.life - 45, f.life, f.age)) * 1.1;
  }
  const before = G.fires.length;
  G.fires = G.fires.filter((f) => f.age < f.life);
  if (G.fires.length !== before) changed = true;
  if (changed) rebuildDynamic();
  // crepitio
  const nf = E.fireList && E.fireList[0];
  if (nf) {
    const d = Math.hypot(nf.x - G.pos[0], nf.z - G.pos[2]);
    if (d < 14 && Math.random() < dt * 9) Aud.crackle(0.12 * (1 - d / 14) * nf.i);
  }
}

/* ---------- Azioni ---------- */
function nearestInteract() {
  let best = null, bd = 3.0;
  for (const m of Items.markers) if (!m.got) { const d = Math.hypot(m.x - G.pos[0], m.z - G.pos[2]); if (d < bd) { bd = d; best = { t: 'marker', o: m }; } }
  for (const c of Items.crates) if (!c.opened) { const d = Math.hypot(c.x - G.pos[0], c.z - G.pos[2]); if (d < Math.min(bd, 2.6)) { bd = d; best = { t: 'crate', o: c }; } }
  return best;
}
function interact() {
  const it = nearestInteract();
  if (!it) return;
  if (it.t === 'marker') {
    it.o.got = true; G.collected++;
    Aud.found(); rebuildDynamic();
    showNote('Segnavia ' + G.collected + ' di 5', it.o.note, 9);
    if (G.collected >= 5) setTimeout(() => toast('Torna al rifugio prima che il freddo ti raggiunga.', 5), 4000);
    if (G.ping && G.ping.m === it.o) G.ping = null;
  } else {
    it.o.opened = true; G.cratesOpened++;
    G.matches += 2; Aud.found(); rebuildDynamic();
    if (rngPlay() < 0.6) { G.warmth = Math.min(100, G.warmth + 28); toast('Dentro la cassa: due fiammiferi e un thermos di tè ancora caldo.'); }
    else toast('Dentro la cassa: due fiammiferi asciutti.');
  }
}
function lightFire() {
  if (G.matches <= 0) { toast('Non hai più fiammiferi.'); return; }
  if (G.inHut) { toast('Il rifugio ha già il suo focolare.'); return; }
  if (G.inWater > 0.2) { toast('Non puoi accendere un fuoco nell\'acqua.'); return; }
  G.matches--; Aud.match();
  const near = nearCircles(G.pos[0], G.pos[2], []); let trees = 0;
  for (let i = 0; i < near.length; i += 3) if (Math.hypot(near[i] - G.pos[0], near[i + 1] - G.pos[2]) < 9) trees++;
  const shelter = Math.min(1, trees / 5);
  const p = 0.96 - 0.6 * G.weather * (1 - 0.65 * shelter) - 0.08 * G.crouch * -1;
  if (Math.random() > p) { toast('Il vento spegne il fiammifero.'); return; }
  const x = G.pos[0] + Math.sin(G.yaw) * 1.6, z = G.pos[2] - Math.cos(G.yaw) * 1.6;
  const [px, pz] = resolveCollisions(x, z);
  G.fires.push({ x: px, y: groundAt(px, pz), z: pz, age: 0, life: 170, inten: 0 });
  if (G.fires.length > 3) G.fires.shift();
  G.firesLit++; rebuildDynamic();
  toast('Il fuoco prende. Avvicinati per scaldarti.');
}
function radioPing() {
  if (G.collected >= 5) { toast('Hai già tutte le posizioni. Torna al rifugio.'); return; }
  if (G.pingCD > 0) { toast('La radio sta ancora cercando il segnale… (' + Math.ceil(G.pingCD) + ' s)'); return; }
  let best = null, bd = 1e9;
  for (const m of Items.markers) if (!m.got) { const d = Math.hypot(m.x - G.pos[0], m.z - G.pos[2]); if (d < bd) { bd = d; best = m; } }
  if (!best) return;
  G.ping = { m: best, t: 9 }; G.pingCD = 22; Aud.ping();
  toast('Segnale radio: il segnavia più vicino è segnato sulla bussola.');
}

/* ---------- Flusso di gioco ---------- */
function resetGame() {
  Object.assign(G, {
    hour: 16.33, weather: 0.12, snow: 0.12, gust: 0, warmth: 100, stamina: 100, matches: 4, collected: 0, firesLit: 0, cratesOpened: 0,
    pos: [HUT.x, Hut.y0, HUT.z + 0.6], vel: [0, 0, 0], vy: 0, onGround: true, yaw: Math.PI, pitch: 0, crouch: 0, camY: Hut.y0 + 1.7,
    lamp: true, fires: [], ping: null, pingCD: 0, stride: 0, bob: 0, inHut: true, exhausted: false, elapsed: 0, keys: {},
  });
  for (const m of Items.markers) m.got = false;
  for (const c of Items.crates) c.opened = false;
  rebuildDynamic();
}
function startGame() {
  Aud.init(); Aud.resume();
  if (G.state === 'menu') resetGame();
  G.started = true;
  G.state = 'play';
  $('menu').classList.add('hidden'); $('end').classList.add('hidden'); $('hud').classList.remove('hidden');
  requestLock();
  if (!G.introDone) {
    G.introDone = true;
    setTimeout(() => toast('Esci dal rifugio. Trova i cinque segnavia — la notte sarà lunga.', 5), 1200);
  }
}
function pauseGame() {
  if (G.state !== 'play') return;
  G.state = 'pause';
  $('menuSub').textContent = 'In pausa';
  $('startBtn').textContent = 'Riprendi';
  $('menu').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
function endGame(kind) {
  if (G.state !== 'play') return;
  G.state = 'end';
  if (document.pointerLockElement) document.exitPointerLock();
  const t = $('endTitle'), x = $('endText');
  if (kind === 'win') {
    t.textContent = 'All\'alba';
    x.textContent = 'Hai riportato tutte le posizioni al rifugio. Quando il cielo schiarisce, l\'elicottero del Soccorso Alpino atterra davanti alla porta.';
    Aud.win();
  } else if (kind === 'lose') {
    t.textContent = 'Il freddo ha vinto';
    x.textContent = 'Le dita non rispondono più e il vento smette di fare rumore. Il rifugio era troppo lontano.';
    Aud.lose();
  } else {
    t.textContent = 'Alba, troppo tardi';
    x.textContent = G.collected >= 5 ? 'Hai trovato tutti i segnavia, ma sei ancora fuori quando arrivano i soccorsi. Per fortuna sei vivo.' : 'Hai superato la notte, ma la squadra è ancora là fuori. Ti restano ' + (5 - G.collected) + ' segnavia da trovare.';
  }
  const hrs = G.hour - 16.33;
  $('endStats').innerHTML = '<div><b>' + G.collected + '/5</b>segnavia</div><div><b>' + G.firesLit + '</b>fuochi</div><div><b>' + G.cratesOpened + '</b>casse</div><div><b>' + Math.floor(hrs) + 'h ' + String(Math.floor((hrs % 1) * 60)).padStart(2, '0') + '</b>sopravvissuto</div>';
  $('hud').classList.add('hidden'); $('end').classList.remove('hidden');
}

function updateGame(dt) {
  G.elapsed += dt;
  G.hour += dt * G.hourRate;
  const wt = weatherTarget();
  G.weather += (wt - G.weather) * clamp(dt * 0.5, 0, 1);
  G.gust = 0.5 + 0.5 * Math.sin(G.clock * 0.37) * Math.sin(G.clock * 0.91 + 1.3);
  G.snow = clamp(G.snow + (G.weather > 0.3 ? (G.weather - 0.3) * 0.0035 : -0.0004) * dt, 0.08, 0.95);
  if (G.pingCD > 0) G.pingCD -= dt;
  if (G.ping) { G.ping.t -= dt; if (G.ping.t <= 0) G.ping = null; }
  updatePlayer(dt);
  updateSurvival(dt);
  if (G.collected >= 5 && G.inHut) endGame('win');
  else if (G.hour >= G.endHour) endGame('dawn');
  // prompt interazione
  const it = nearestInteract(), pr = $('prompt');
  if (it) { pr.textContent = it.t === 'marker' ? 'E — Raccogli il segnavia' : 'E — Apri la cassa'; pr.classList.add('on'); } else pr.classList.remove('on');
}

/* ---------- Ciclo principale ---------- */
let lastTs = 0, slowT = 0, hudT = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dtRaw = (ts - lastTs) / 1000; lastTs = ts;
  const dt = clamp(dtRaw, 0, 0.05);
  G.clock += dt;
  if (G.state === 'play') {
    updateGame(dt);
  } else if (G.state !== 'loading') {
    if (G.state === 'menu') { G.hour = 16.95; G.weather = 0.28; G.gust = 0.4; }
  }
  computeEnv();
  updateFireUniforms();
  if (G.state === 'play' || G.state === 'pause') {
    const sh = G.warmth < 40 ? (40 - G.warmth) / 40 : 0;
    R.cam = [G.pos[0], G.camY + G.bob, G.pos[2]];
    R.yawC = G.yaw + Math.sin(G.clock * 33) * 0.0022 * sh;
    R.pitchC = clamp(G.pitch + Math.sin(G.clock * 29) * 0.0018 * sh, -1.5, 1.5);
  } else {
    const a = G.clock * 0.07 + 0.6, rad = 17;
    R.cam = [HUT.x + Math.cos(a) * rad, Hut.y0 + 5.5, HUT.z + Math.sin(a) * rad];
    const dx = HUT.x - R.cam[0], dz = HUT.z - R.cam[2];
    R.yawC = Math.atan2(dx, -dz); R.pitchC = -0.2;
  }
  Aud.update(dt, E.WindAmt, G.inHut && G.state === 'play', G.clock);
  updateShadows(dt);
  render();
  if (window.__snap) { const cb = window.__snap; window.__snap = null; cb(canvas.toDataURL('image/png')); }
  if (G.state === 'play') {
    drawCompass();
    hudT -= dt; if (hudT <= 0) { hudT = 0.12; updateHUD(); }
  }
  // adattamento qualità
  slowT += dtRaw > 0.034 ? dtRaw : -dtRaw * 0.5;
  if (slowT < 0) slowT = 0;
  if (slowT > 2.5) {
    if (G.scale > 0.72) G.scale = Math.max(0.7, G.scale - 0.1);
    else {
      const order = ['alta', 'media', 'bassa'], i = order.indexOf(G.qname);
      if (i >= 0 && i < 2) { setQuality(order[i + 1]); G.scale = 1; syncQualityButtons(); }
    }
    slowT = 0;
  }
}

/* ---------- Avvio ---------- */
function syncQualityButtons() {
  document.querySelectorAll('button.q').forEach((o) => o.classList.toggle('sel', o.dataset.q === G.qname));
}
function bindMenu() {
  $('startBtn').addEventListener('click', () => {
    if (G.state === 'pause') { G.state = 'play'; $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); requestLock(); Aud.resume(); }
    else startGame();
  });
  $('retryBtn').addEventListener('click', () => { resetGame(); G.state = 'menu'; $('end').classList.add('hidden'); startGame(); });
  document.querySelectorAll('button.q').forEach((b) => {
    b.addEventListener('click', () => {
      setQuality(b.dataset.q); G.scale = 1; syncQualityButtons();
    });
  });
  syncQualityButtons();
  $('muteBtn').addEventListener('click', () => {
    G.muted = !G.muted; Aud.setVolume(G.muted ? 0 : 0.8); Aud.volume = G.muted ? 0 : 0.8;
    $('muteBtn').textContent = G.muted ? 'Spento' : 'Acceso';
  });
}

function boot() {
  if (!gl) { $('loadmsg').textContent = 'Questo browser non supporta WebGL2. Prova con Chrome, Edge o Firefox aggiornati.'; return; }
  const msg = (t) => ($('loadmsg').textContent = t);
  setTimeout(() => {
    Terrain.build(); msg('Piantando le foreste…');
    setTimeout(() => {
      placeVegetation(); placeItems(); msg('Costruendo il rifugio…');
      setTimeout(() => {
        try {
          initGL();
          computeEnv(); updateFireUniforms();
          shadowBaker.start(E.L); G.lastBake = E.L.slice();
          while (!shadowBaker.step(10000)) { /* bake iniziale sincrono */ }
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shTexCur);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TN, TN, gl.RG, gl.UNSIGNED_BYTE, shadowBaker.buf);
          gl.bindTexture(gl.TEXTURE_2D, shTexNext);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TN, TN, gl.RG, gl.UNSIGNED_BYTE, shadowBaker.buf);
          bindMenu();
          G.state = 'menu';
          $('loader').classList.add('hidden'); $('menu').classList.remove('hidden');
          requestAnimationFrame(frame);
        } catch (e) { console.error(e); msg('Errore di inizializzazione grafica: ' + e.message); }
      }, 30);
    }, 30);
  }, 30);
}

window.VALICO = { G, E, R, Items, Props, tp(x, z) { G.pos[0] = x; G.pos[2] = z; G.pos[1] = groundAt(x, z); G.camY = G.pos[1] + 1.7; }, start: () => startGame() };
window.addEventListener('resize', resize);
boot();
