import * as THREE from "three";
import { worldToScene } from "./Matchmaking";

type SoundKind = "gunshot" | "reload" | "empty" | "footstep" | "hit" | "kill" | "zone" | "winner";

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientOsc: OscillatorNode | null = null;
  private lastStepAt = 0;
  private footIndex = 0;

  async ensure() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.45;
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 10;
    this.compressor.attack.value = 0.002;
    this.compressor.release.value = 0.2;
    this.master.connect(this.compressor);
    this.compressor.connect(this.context.destination);
    this.startAmbient();
  }

  private startAmbient() {
    if (!this.context || !this.master || this.ambientOsc) return;
    this.ambientOsc = this.context.createOscillator();
    this.ambientGain = this.context.createGain();
    this.ambientOsc.type = "triangle";
    this.ambientOsc.frequency.value = 62;
    this.ambientGain.gain.value = 0.03;
    this.ambientOsc.connect(this.ambientGain);
    this.ambientGain.connect(this.master);
    this.ambientOsc.start();
  }

  private playTone(kind: SoundKind, position?: THREE.Vector3) {
    if (!this.context || !this.master) return;
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createPanner();
    panner.distanceModel = "inverse";
    panner.refDistance = 10;
    panner.maxDistance = 140;
    panner.rolloffFactor = 0.9;

    const now = ctx.currentTime;
    const profile: Record<SoundKind, { type: OscillatorType; from: number; to: number; gain: number; length: number }> = {
      gunshot: { type: "square", from: 240, to: 90, gain: 0.18, length: 0.12 },
      reload: { type: "triangle", from: 420, to: 180, gain: 0.1, length: 0.16 },
      empty: { type: "square", from: 140, to: 100, gain: 0.08, length: 0.05 },
      footstep: { type: "sine", from: this.footIndex % 2 === 0 ? 120 : 90, to: 50, gain: 0.05, length: 0.08 },
      hit: { type: "square", from: 520, to: 160, gain: 0.14, length: 0.09 },
      kill: { type: "triangle", from: 680, to: 220, gain: 0.18, length: 0.18 },
      zone: { type: "sawtooth", from: 180, to: 80, gain: 0.1, length: 0.28 },
      winner: { type: "triangle", from: 740, to: 320, gain: 0.2, length: 0.4 },
    };

    const spec = profile[kind];
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), now + spec.length);
    gain.gain.setValueAtTime(spec.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.length);

    if (position) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      osc.connect(gain);
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      osc.connect(gain);
      gain.connect(this.master);
    }

    osc.start(now);
    osc.stop(now + spec.length);
    if (kind === "footstep") this.footIndex += 1;
  }

  setListener(position: THREE.Vector3, forward: THREE.Vector3) {
    if (!this.context) return;
    const listener = this.context.listener;
    listener.positionX.value = position.x;
    listener.positionY.value = position.y;
    listener.positionZ.value = position.z;
    listener.forwardX.value = forward.x;
    listener.forwardY.value = forward.y;
    listener.forwardZ.value = forward.z;
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
  }

  playAt(kind: SoundKind, x: number, y: number) {
    this.playTone(kind, worldToScene(x, y, 1.3));
  }

  playUi(kind: SoundKind) {
    this.playTone(kind);
  }

  maybeStep(isMoving: boolean) {
    if (!isMoving || !this.context) return;
    const now = performance.now();
    if (now - this.lastStepAt < 360) return;
    this.lastStepAt = now;
    this.playTone("footstep");
  }
}
