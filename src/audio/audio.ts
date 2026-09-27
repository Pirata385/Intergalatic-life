// Procedural WebAudio sound effects and a generative ambient soundtrack.
// No audio files: everything is synthesised at runtime.

export class Audio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxGain: GainNode | null = null;
  musicGain: GainNode | null = null;
  noise: AudioBuffer | null = null;
  volume = 0.6;
  sfxOn = true;
  musicOn = true;
  private lastPlay = new Map<string, number>();
  private musicNodes: AudioNode[] = [];
  private musicTimer = 0;
  private mood: 'calm' | 'tense' | 'menu' = 'menu';

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
      return;
    }
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(c.destination);
    this.sfxGain = c.createGain();
    this.sfxGain.gain.value = this.sfxOn ? 0.8 : 0;
    this.sfxGain.connect(this.master);
    this.musicGain = c.createGain();
    this.musicGain.gain.value = this.musicOn ? 0.28 : 0;
    this.musicGain.connect(this.master);
    const len = c.sampleRate * 1.5;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.musicOn) this.startMusic();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    if (this.sfxGain) this.sfxGain.gain.value = on ? 0.8 : 0;
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.28 : 0;
    if (on && this.ctx && !this.musicNodes.length) this.startMusic();
  }

  setMood(m: 'calm' | 'tense' | 'menu'): void {
    this.mood = m;
  }

  private env(g: GainNode, t: number, a: number, peak: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  play(name: string, vol = 0.5): void {
    const c = this.ctx;
    if (!c || !this.sfxOn || !this.sfxGain) return;
    const now = c.currentTime;
    const last = this.lastPlay.get(name) ?? 0;
    if (now - last < 0.045) return;
    this.lastPlay.set(name, now);
    const out = c.createGain();
    out.gain.value = vol;
    out.connect(this.sfxGain);
    const osc = (type: OscillatorType, f0: number, f1: number, dur: number, peak = 0.4) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
      this.env(g, now, 0.005, peak, dur);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + dur + 0.05);
    };
    const noise = (dur: number, freq: number, q = 1, peak = 0.5, type: BiquadFilterType = 'lowpass', sweep = 0) => {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, now);
      if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), now + dur);
      f.Q.value = q;
      const g = c.createGain();
      this.env(g, now, 0.005, peak, dur);
      s.connect(f).connect(g).connect(out);
      s.start(now, Math.random());
      s.stop(now + dur + 0.05);
    };
    switch (name) {
      case 'laser': osc('sawtooth', 1400, 300, 0.12, 0.12); break;
      case 'pulse': osc('square', 900, 200, 0.1, 0.12); break;
      case 'gun': noise(0.06, 2500, 1, 0.35, 'bandpass'); break;
      case 'rail': osc('sine', 200, 60, 0.35, 0.4); noise(0.25, 6000, 0.5, 0.3, 'highpass'); break;
      case 'missile': noise(0.5, 800, 1, 0.3, 'bandpass', 3000); break;
      case 'torpedo': osc('triangle', 120, 60, 0.6, 0.4); noise(0.6, 400, 1, 0.3); break;
      case 'ion': osc('sine', 300, 1200, 0.18, 0.2); osc('square', 150, 600, 0.18, 0.05); break;
      case 'plasma': osc('sawtooth', 220, 110, 0.3, 0.2); break;
      case 'acid': noise(0.18, 1200, 4, 0.3, 'bandpass', 400); break;
      case 'crystal': osc('sine', 1800, 1600, 0.4, 0.15); osc('sine', 2700, 2400, 0.3, 0.08); break;
      case 'mining': osc('square', 90, 110, 0.12, 0.05); break;
      case 'hit': noise(0.05, 3000, 1, 0.2, 'highpass'); break;
      case 'explode': noise(0.5, 1200, 0.7, 0.6, 'lowpass', 100); osc('sine', 90, 30, 0.4, 0.4); break;
      case 'bigexplode': noise(1.4, 900, 0.5, 0.9, 'lowpass', 60); osc('sine', 70, 20, 1.2, 0.6); break;
      case 'jump': osc('sawtooth', 80, 1600, 1.2, 0.25); noise(1.2, 300, 1, 0.3, 'bandpass', 5000); break;
      case 'dock': osc('sine', 440, 660, 0.15, 0.2); setTimeout(() => this.play('ui', 0.4), 150); break;
      case 'ui': osc('sine', 880, 1200, 0.05, 0.12); break;
      case 'deny': osc('square', 200, 140, 0.15, 0.12); break;
      case 'reward': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => { if (this.ctx) this.tone(f, 0.18, 0.15); }, i * 90)); break;
      case 'alarm': osc('square', 700, 500, 0.25, 0.15); break;
      case 'pickup': osc('sine', 700, 1400, 0.1, 0.15); break;
      case 'scan': osc('sine', 1200, 1500, 0.3, 0.08); break;
      case 'build': noise(0.2, 500, 2, 0.3, 'bandpass'); osc('square', 220, 330, 0.1, 0.06); break;
      default: osc('sine', 600, 300, 0.1, 0.1);
    }
  }

  private tone(f: number, dur: number, peak: number): void {
    const c = this.ctx!;
    const now = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    this.env(g, now, 0.01, peak, dur);
    o.connect(g).connect(this.sfxGain!);
    o.start(now);
    o.stop(now + dur + 0.05);
  }

  /** Slow evolving pad chords. */
  private startMusic(): void {
    const c = this.ctx;
    if (!c || !this.musicGain) return;
    const scaleCalm = [0, 3, 7, 10, 14, 15, 19];
    const scaleTense = [0, 1, 5, 6, 10, 13];
    const playChord = () => {
      if (!this.ctx || !this.musicOn) return;
      const now = c.currentTime;
      const base = this.mood === 'tense' ? 98 : this.mood === 'menu' ? 110 : 123.47;
      const scale = this.mood === 'tense' ? scaleTense : scaleCalm;
      const notes = [0, 2, 4].map(() => scale[Math.floor(Math.random() * scale.length)]);
      const dur = 9;
      for (const n of notes) {
        const f = base * Math.pow(2, n / 12);
        for (const det of [-4, 4]) {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = det;
          const filt = c.createBiquadFilter();
          filt.type = 'lowpass';
          filt.frequency.setValueAtTime(300, now);
          filt.frequency.linearRampToValueAtTime(900 + Math.random() * 500, now + dur / 2);
          filt.frequency.linearRampToValueAtTime(300, now + dur);
          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, now);
          g.gain.linearRampToValueAtTime(0.05, now + 3);
          g.gain.linearRampToValueAtTime(0.0001, now + dur);
          o.connect(filt).connect(g).connect(this.musicGain!);
          o.start(now);
          o.stop(now + dur + 0.1);
        }
      }
      // sparkle
      if (Math.random() < 0.7) {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = base * 4 * Math.pow(2, scale[Math.floor(Math.random() * scale.length)] / 12);
        const g = c.createGain();
        const t0 = now + Math.random() * 4;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.5);
        o.connect(g).connect(this.musicGain!);
        o.start(t0);
        o.stop(t0 + 2.6);
      }
    };
    playChord();
    this.musicTimer = window.setInterval(playChord, 7000);
    this.musicNodes = [this.musicGain];
  }
}

export const audio = new Audio();
