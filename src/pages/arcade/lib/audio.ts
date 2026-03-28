type SfxName = "flap" | "point" | "hit" | "eat" | "drop" | "perfect";

type MusicName = "flappy" | "snake" | "stack";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const storageKey = "arcade_audio_settings_v1";

export type ArcadeAudioSettings = {
  enabled: boolean;
  music: boolean;
  volume: number; // 0..1
};

const defaultSettings: ArcadeAudioSettings = {
  enabled: true,
  music: true,
  volume: 0.5,
};

const loadSettings = (): ArcadeAudioSettings => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<ArcadeAudioSettings>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaultSettings.enabled,
      music: typeof parsed.music === "boolean" ? parsed.music : defaultSettings.music,
      volume: typeof parsed.volume === "number" ? clamp01(parsed.volume) : defaultSettings.volume,
    };
  } catch {
    return defaultSettings;
  }
};

const saveSettings = (s: ArcadeAudioSettings) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(s));
  } catch {
    // ignore
  }
};

export class ArcadeAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private settings: ArcadeAudioSettings = loadSettings();

  getSettings() {
    return this.settings;
  }

  setSettings(next: Partial<ArcadeAudioSettings>) {
    this.settings = {
      ...this.settings,
      ...next,
      volume: next.volume === undefined ? this.settings.volume : clamp01(next.volume),
    };
    saveSettings(this.settings);
    this.syncGains();
  }

  private ensure() {
    if (this.ctx && this.master && this.musicGain && this.sfxGain) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const master = ctx.createGain();
    const musicGain = ctx.createGain();
    const sfxGain = ctx.createGain();
    musicGain.connect(master);
    sfxGain.connect(master);
    master.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    this.musicGain = musicGain;
    this.sfxGain = sfxGain;
    this.syncGains();
  }

  async resume() {
    this.ensure();
    if (this.ctx?.state === "suspended") await this.ctx.resume();
  }

  private syncGains() {
    if (!this.master || !this.musicGain || !this.sfxGain) return;
    const vol = this.settings.enabled ? this.settings.volume : 0;
    this.master.gain.value = vol;
    this.musicGain.gain.value = this.settings.music ? 0.8 : 0;
    this.sfxGain.gain.value = 1.0;
  }

  stopAll() {
    if (this.musicTimer) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  startMusic(name: MusicName) {
    this.ensure();
    this.stopAll();
    if (!this.settings.enabled || !this.settings.music) return;

    // Simple chiptune-ish loops (original, synthesized).
    const loopMs = 1500;
    const seq =
      name === "flappy"
        ? [523.25, 659.25, 783.99, 659.25, 587.33, 659.25, 523.25, 392.0]
        : name === "snake"
          ? [392.0, 440.0, 523.25, 440.0, 349.23, 392.0, 440.0, 349.23]
          : [261.63, 329.63, 392.0, 329.63, 293.66, 329.63, 392.0, 493.88];

    let step = 0;
    const schedule = () => {
      if (!this.ctx || !this.musicGain) return;
      const ctx = this.ctx;
      const g = this.musicGain;

      const t0 = ctx.currentTime + 0.01;
      for (let i = 0; i < seq.length; i++) {
        const f = seq[(step + i) % seq.length];
        const t = t0 + i * 0.17;
        const o = ctx.createOscillator();
        const amp = ctx.createGain();
        o.type = "square";
        o.frequency.setValueAtTime(f, t);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(0.06, t + 0.01);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        o.connect(amp);
        amp.connect(g);
        o.start(t);
        o.stop(t + 0.15);
      }
      step = (step + 1) % seq.length;
    };

    schedule();
    this.musicTimer = window.setInterval(schedule, loopMs);
  }

  playSfx(name: SfxName) {
    this.ensure();
    if (!this.ctx || !this.sfxGain) return;
    if (!this.settings.enabled) return;

    const ctx = this.ctx;
    const t = ctx.currentTime + 0.001;

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(this.sfxGain);

    if (name === "flap") {
      o.type = "triangle";
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(220, t + 0.07);
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.start(t);
      o.stop(t + 0.1);
      return;
    }

    if (name === "point") {
      o.type = "square";
      o.frequency.setValueAtTime(880, t);
      o.frequency.setValueAtTime(1174.66, t + 0.05);
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.start(t);
      o.stop(t + 0.13);
      return;
    }

    if (name === "eat") {
      o.type = "sine";
      o.frequency.setValueAtTime(660, t);
      o.frequency.setValueAtTime(880, t + 0.04);
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.start(t);
      o.stop(t + 0.1);
      return;
    }

    if (name === "drop") {
      o.type = "square";
      o.frequency.setValueAtTime(240, t);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.start(t);
      o.stop(t + 0.13);
      return;
    }

    if (name === "perfect") {
      o.type = "triangle";
      o.frequency.setValueAtTime(740, t);
      o.frequency.setValueAtTime(988, t + 0.05);
      o.frequency.setValueAtTime(1318, t + 0.1);
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.start(t);
      o.stop(t + 0.2);
      return;
    }

    // hit
    o.type = "sawtooth";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.15);
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.start(t);
    o.stop(t + 0.22);
  }
}

