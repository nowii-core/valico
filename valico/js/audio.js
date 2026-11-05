'use strict';
/* Valico — audio procedurale (Web Audio): vento, passi, fuoco, radio. Nessun file esterno. */

const Aud = {
  ctx: null, master: null, noise: null, wind: null, rumble: null, volume: 0.8, ready: false,

  init() {
    if (this.ready) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let b0 = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.97 * b0 + 0.03 * w; d[i] = w * 0.6 + b0 * 3.2; }
      this.noise = buf;
      const mkLoop = (type, freq, q) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(f); f.connect(g); g.connect(this.master); src.start();
        return { f, g };
      };
      this.wind = mkLoop('bandpass', 500, 0.7);
      this.rumble = mkLoop('lowpass', 160, 0.5);
      this.ready = true;
    } catch (e) { /* audio non disponibile */ }
  },

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; },

  update(dt, windAmt, indoor, t) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.91 + 1.3);
    const k = indoor ? 0.18 : 1;
    this.wind.g.gain.setTargetAtTime((0.03 + 0.34 * windAmt * (0.6 + 0.4 * gust)) * k, now, 0.3);
    this.wind.f.frequency.setTargetAtTime(280 + 900 * windAmt * (0.5 + 0.5 * gust), now, 0.4);
    this.rumble.g.gain.setTargetAtTime((0.05 + 0.3 * windAmt) * k, now, 0.4);
  },

  burst(freq, q, dur, vol, type = 'bandpass') {
    if (!this.ready) return;
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  },

  step(surface, sprint) {
    const v = sprint ? 0.5 : 0.32, j = 0.85 + Math.random() * 0.3;
    switch (surface) {
      case 'snow': this.burst(1100 * j, 0.9, 0.16, v * 0.9); this.burst(380 * j, 1.2, 0.1, v * 0.5); break;
      case 'rock': this.burst(2200 * j, 1.4, 0.07, v * 0.8); this.burst(500, 1, 0.05, v * 0.4); break;
      case 'water': this.burst(600 * j, 0.6, 0.28, v * 1.0); this.burst(1800 * j, 1.5, 0.1, v * 0.4); break;
      case 'wood': this.burst(220 * j, 2.5, 0.12, v * 1.1); break;
      default: this.burst(620 * j, 0.9, 0.11, v * 0.8); break;
    }
  },

  crackle(vol) { this.burst(3200 + Math.random() * 2500, 2, 0.03, vol * (0.4 + Math.random() * 0.6), 'highpass'); },

  tone(freq, dur, vol, type = 'sine', delay = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + delay;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },

  ping() { this.tone(1320, 0.09, 0.12, 'square'); this.tone(1760, 0.12, 0.1, 'square', 0.13); this.burst(2600, 3, 0.2, 0.05); },
  found() { this.tone(523, 0.5, 0.14, 'triangle'); this.tone(659, 0.5, 0.12, 'triangle', 0.12); this.tone(784, 0.8, 0.12, 'triangle', 0.24); },
  match() { this.burst(2800, 1.5, 0.35, 0.18, 'highpass'); },
  heartbeat() { this.tone(52, 0.18, 0.5); this.tone(46, 0.22, 0.4, 'sine', 0.2); },
  lose() { this.tone(110, 2.4, 0.2, 'sine'); this.tone(82, 2.8, 0.2, 'sine', 0.2); },
  win() { [392, 494, 587, 784].forEach((f, i) => this.tone(f, 1.4, 0.12, 'triangle', i * 0.22)); },
};
