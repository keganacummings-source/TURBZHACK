/**
 * Small, procedural sound bank for the turn-based game.
 *
 * The layered, synthesized-cue approach is adapted from Main-game's
 * `src/game/sfx-bank.ts`; these samples are original to TURBZHACK and generated
 * in memory, so gameplay effects have no external asset dependency.
 */
export type SfxName = "step" | "hit" | "hurt" | "cast";

export const MUSIC_TRACKS = [
  "Background.ogg",
  "Background2.ogg",
  "Track4.ogg",
  "WINGRIDDENTURBZ.ogg",
  "WINGRIDDENTURBZ2.ogg",
  "Track9.ogg",
  "halloweenyEXT.ogg",
  "TURBZ10.ogg",
] as const;

const DURATIONS: Record<SfxName, number> = {
  step: 0.12,
  hit: 0.3,
  hurt: 0.24,
  cast: 0.36,
};

const SEEDS: Record<SfxName, number> = { step: 7, hit: 19, hurt: 31, cast: 43 };
const TAU = Math.PI * 2;

/** Render a deterministic, normalised mono sample; kept pure so it is testable in Node. */
export function renderSfx(name: SfxName, sampleRate: number): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000) {
    throw new RangeError("sampleRate must be at least 8000 Hz");
  }
  const duration = DURATIONS[name];
  if (duration === undefined) throw new RangeError(`Unknown sound effect: ${name}`);
  const out = new Float32Array(Math.ceil(sampleRate * duration));
  let state = SEEDS[name]!;
  let peak = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const progress = t / duration;
    const decay = Math.exp(-progress * (name === "cast" ? 5 : 10));
    const frequency = name === "cast"
      ? 250 + 900 * progress
      : name === "hurt"
        ? 320 - 190 * progress
        : name === "step"
          ? 115 - 58 * progress
          : 170 - 105 * progress;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const noise = ((state >>> 0) / 0x80000000) - 1;
    const transient = name === "step" ? 0.07 : name === "cast" ? 0.025 : 0.12;
    const tone = Math.sin(TAU * frequency * t) * (name === "cast" ? 0.65 : 0.8);
    const grit = noise * (name === "cast" ? 0.08 : 0.35) * Math.exp(-t * (name === "cast" ? 24 : 34));
    const sample = (tone * decay + grit) * Math.max(0, Math.min(1, t / transient));
    out[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  if (peak > 0) {
    const gain = 0.82 / peak;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! * gain;
  }
  return out;
}

/**
 * Browser playback is lazy: no audio device or context is touched until the
 * player makes an input, which is also the browser's required user gesture.
 */
export class SoundEffects {
  enabled = true;
  private context: AudioContext | null = null;
  private buffers = new Map<SfxName, AudioBuffer>();
  private music: HTMLAudioElement | null = null;
  private trackIndex = 0;

  get currentTrack(): string {
    return MUSIC_TRACKS[this.trackIndex]!;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.music?.pause();
      return;
    }
    this.unlock();
  }

  unlock(): void {
    if (!this.enabled) return;
    const context = this.audioContext();
    if (context?.state === "suspended") {
      void context.resume().catch((error: unknown) => {
        console.warn("TURBZHACK audio could not resume.", error);
      });
    }
    this.startMusic();
  }

  play(name: SfxName): void {
    if (!this.enabled) return;
    this.unlock();
    const context = this.audioContext();
    if (!context) return;

    let buffer = this.buffers.get(name);
    if (!buffer) {
      const samples = renderSfx(name, context.sampleRate);
      buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.buffers.set(name, buffer);
    }

    const source = context.createBufferSource();
    const volume = context.createGain();
    volume.gain.value = name === "step" ? 0.22 : name === "cast" ? 0.28 : 0.34;
    source.buffer = buffer;
    source.connect(volume);
    volume.connect(context.destination);
    source.start();
  }

  private audioContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof AudioContext === "undefined") return null;
    this.context = new AudioContext();
    return this.context;
  }

  private startMusic(): void {
    if (!this.enabled) return;
    if (!this.music) {
      this.music = new Audio();
      this.music.volume = 0.24;
      this.music.addEventListener("ended", () => this.advanceTrack());
      this.music.addEventListener("error", () => {
        console.warn(`TURBZHACK music could not load ${this.currentTrack}.`);
        this.advanceTrack();
      });
    }
    if (this.music.src.endsWith(encodeURIComponent(this.currentTrack)) && !this.music.paused) return;
    if (!this.music.src.endsWith(encodeURIComponent(this.currentTrack))) {
      this.music.src = `assets/audio/${encodeURIComponent(this.currentTrack)}`;
    }
    void this.music.play().catch((error: unknown) => {
      console.warn("TURBZHACK background music could not start.", error);
    });
  }

  private advanceTrack(): void {
    this.trackIndex = (this.trackIndex + 1) % MUSIC_TRACKS.length;
    if (!this.enabled) return;
    if (this.music) this.music.src = `assets/audio/${encodeURIComponent(this.currentTrack)}`;
    this.startMusic();
  }
}
