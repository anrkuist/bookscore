import { AudioCue } from './types';

export interface SoundSourceNode {
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
  connect(destination: unknown): void;
  disconnect(): void;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  onended: (() => void) | null;
}

export interface GainNodeInterface {
  gain: {
    value: number;
    setValueAtTime(value: number, startTime: number): void;
    linearRampToValueAtTime(value: number, endTime: number): void;
    exponentialRampToValueAtTime(value: number, endTime: number): void;
  };
  connect(destination: unknown): void;
  disconnect(): void;
}

export interface AudioContextInterface {
  state: 'suspended' | 'running' | 'closed';
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createGain(): GainNodeInterface;
  createBufferSource(): SoundSourceNode;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): unknown;
  decodeAudioData(audioData: ArrayBuffer): Promise<unknown>;
}

export interface SoundtrackPlayer {
  isUnlocked(): boolean;
  unlockGesture(): Promise<boolean>;
  playCue(cue: AudioCue, audioData?: ArrayBuffer, startOffsetSec?: number): Promise<void>;
  transitionToSilence(crossfadeSec?: number): Promise<void>;
  pause(): void;
  stop(): void;
  dispose(): Promise<void>;
  getCurrentCue(): AudioCue | null;
  getSavedOffset(cueId: string): number | undefined;
}

export class WebAudioSoundtrackPlayer implements SoundtrackPlayer {
  private ctx: AudioContextInterface | null = null;
  private masterGain: GainNodeInterface | null = null;
  private activeGain: GainNodeInterface | null = null;
  private activeSource: SoundSourceNode | null = null;
  private currentCue: AudioCue | null = null;
  private gestureUnlocked = false;

  private cueStartTime = 0;
  private cueStartOffset = 0;
  private savedOffsets = new Map<string, number>();

  constructor(customContext?: AudioContextInterface) {
    if (customContext) {
      this.ctx = customContext;
      this.initNodes();
    }
  }

  private initNodes() {
    if (!this.ctx) return;
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
  }

  private ensureContext(): AudioContextInterface | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx() as unknown as AudioContextInterface;
        this.initNodes();
      }
    }
    return this.ctx;
  }

  public isUnlocked(): boolean {
    return this.gestureUnlocked || this.ctx?.state === 'running';
  }

  public async unlockGesture(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (!ctx) return false;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (ctx.state === 'running') {
      this.gestureUnlocked = true;
      return true;
    }
    return false;
  }

  public getSavedOffset(cueId: string): number | undefined {
    return this.savedOffsets.get(cueId);
  }

  public async playCue(
    cue: AudioCue,
    audioData?: ArrayBuffer,
    startOffsetSec?: number,
  ): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx) return;

    if (!this.isUnlocked()) {
      const unlocked = await this.unlockGesture();
      if (!unlocked) {
        throw new Error('Gesture unlock required for audio playback');
      }
    }

    let startSec = startOffsetSec ?? this.savedOffsets.get(cue.id) ?? cue.startSec;
    if (startSec >= cue.loopEndSec) {
      const loopDuration = cue.loopEndSec - cue.loopStartSec;
      if (loopDuration > 0) {
        startSec = cue.loopStartSec + ((startSec - cue.loopStartSec) % loopDuration);
      }
    }

    const now = ctx.currentTime;
    const fadeTime = Math.max(0.05, cue.crossfadeSec || 0.5);

    // Crossfade old source if playing
    if (this.activeGain && this.activeSource) {
      const oldGain = this.activeGain;
      const oldSource = this.activeSource;
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0, now + fadeTime);
      setTimeout(
        () => {
          try {
            oldSource.stop();
            oldSource.disconnect();
            oldGain.disconnect();
          } catch (_) {}
        },
        fadeTime * 1000 + 50,
      );
    }

    const newGain = ctx.createGain();
    newGain.gain.setValueAtTime(0, now);
    const targetVol = Math.min(1, Math.max(0, cue.volume));
    newGain.gain.linearRampToValueAtTime(targetVol, now + fadeTime);

    if (this.masterGain) {
      newGain.connect(this.masterGain);
    }

    const source = ctx.createBufferSource();
    if (audioData) {
      try {
        const buffer = await ctx.decodeAudioData(audioData);
        (source as unknown as { buffer: unknown }).buffer = buffer;
      } catch (_) {}
    }

    source.loop = true;
    source.loopStart = cue.loopStartSec;
    source.loopEnd = cue.loopEndSec;

    source.connect(newGain);
    source.start(now, startSec);

    this.cueStartTime = now;
    this.cueStartOffset = startSec;

    this.activeSource = source;
    this.activeGain = newGain;
    this.currentCue = cue;
  }

  public async transitionToSilence(crossfadeSec = 0.5): Promise<void> {
    if (!this.ctx || !this.activeGain || !this.activeSource) {
      this.currentCue = null;
      return;
    }
    const now = this.ctx.currentTime;
    const fadeTime = Math.max(0.05, crossfadeSec);

    const oldGain = this.activeGain;
    const oldSource = this.activeSource;

    oldGain.gain.setValueAtTime(oldGain.gain.value, now);
    oldGain.gain.linearRampToValueAtTime(0, now + fadeTime);

    this.activeGain = null;
    this.activeSource = null;
    this.currentCue = null;

    setTimeout(
      () => {
        try {
          oldSource.stop();
          oldSource.disconnect();
          oldGain.disconnect();
        } catch (_) {}
      },
      fadeTime * 1000 + 50,
    );
  }

  public pause(): void {
    if (this.activeSource && this.ctx && this.currentCue) {
      const elapsed = this.ctx.currentTime - this.cueStartTime;
      let pos = this.cueStartOffset + elapsed;
      const cue = this.currentCue;
      if (pos >= cue.loopEndSec) {
        const loopDuration = cue.loopEndSec - cue.loopStartSec;
        if (loopDuration > 0) {
          pos = cue.loopStartSec + ((pos - cue.loopStartSec) % loopDuration);
        }
      }
      this.savedOffsets.set(cue.id, pos);

      try {
        this.activeSource.stop();
      } catch (_) {}
    }
    if (this.activeGain) {
      try {
        this.activeGain.disconnect();
      } catch (_) {}
    }
    this.activeSource = null;
    this.activeGain = null;
  }

  public stop(): void {
    this.pause();
    this.currentCue = null;
    this.savedOffsets.clear();
  }

  public async dispose(): Promise<void> {
    this.stop();
    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch (_) {}
      this.masterGain = null;
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        await this.ctx.close();
      } catch (_) {}
      this.ctx = null;
    }
  }

  public getCurrentCue(): AudioCue | null {
    return this.currentCue;
  }
}
