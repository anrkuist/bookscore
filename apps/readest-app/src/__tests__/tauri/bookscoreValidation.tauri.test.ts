import { describe, it, expect, vi } from 'vitest';
import { WebAudioSoundtrackPlayer } from '@/services/bookscore/soundtrackPlayer';
import { defaultAudioDecoder } from '@/services/bookscore/packageValidation';
import {
  createMinimalValidMp3Bytes,
  createCorruptMp3Bytes,
  createTestAudioCue,
} from './bookscoreHelpers';

interface WebkitWindow extends Window {
  webkitAudioContext: typeof AudioContext;
}

describe('Tauri WebView BookScore Validation', () => {
  // 1. Packaged MP3 Decode Validation
  describe('Packaged MP3 Decode', () => {
    it('should successfully decode valid minimal MP3 bytes and return duration', async () => {
      const validBytes = createMinimalValidMp3Bytes();
      try {
        const result = await defaultAudioDecoder(validBytes);
        expect(result.durationSec).toBeGreaterThan(0);
        // Minimal valid MP3 is ~2.6 seconds
        expect(result.durationSec).toBeCloseTo(2.6, 1);
        console.log(`[PASS] Decoded valid MP3: duration = ${result.durationSec}s`);
      } catch (err) {
        // If the WebView environment strictly blocks Web Audio, report constraint clearly.
        console.warn(
          '[WARN] Web Audio API decodeAudioData failed, possibly due to autoplay/sandbox policies:',
          err,
        );
        // Fallback checks to see if the fallback decoder was triggered
        expect(err).toBeUndefined();
      }
    });

    it('should throw an error when decoding corrupt MP3 bytes', async () => {
      const corruptBytes = createCorruptMp3Bytes();
      await expect(defaultAudioDecoder(corruptBytes)).rejects.toThrow();
      console.log('[PASS] Corrupt MP3 bytes failed decoding as expected.');
    });
  });

  // 2. Player Integration (Loops, Transitions, Pause/Resume, Cleanup, Silence failures)
  describe('Soundtrack Player playback logic', () => {
    // Create a helper to instantiate the player with a wrapped/spied context
    interface TrackedSource {
      src: AudioBufferSourceNode;
      startSpy: ReturnType<typeof vi.fn>;
      stopSpy: ReturnType<typeof vi.fn>;
      disconnectSpy: ReturnType<typeof vi.fn>;
    }

    interface TrackedGain {
      gainNode: GainNode;
      setValueSpy: ReturnType<typeof vi.fn>;
      rampSpy: ReturnType<typeof vi.fn>;
      disconnectSpy: ReturnType<typeof vi.fn>;
    }

    function createSpiedPlayer() {
      const AudioCtx =
        window.AudioContext || (window as unknown as WebkitWindow).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Web Audio API (AudioContext) is not supported in this environment');
      }

      const realCtx = new AudioCtx();
      let lastCreatedSource: AudioBufferSourceNode | null = null;
      const createdSources: TrackedSource[] = [];
      const createdGains: TrackedGain[] = [];

      // Wrap AudioContext to intercept source node creation and monitor loops/playback
      const wrappedCtx = {
        state: realCtx.state,
        get currentTime() {
          return realCtx.currentTime;
        },
        get destination() {
          return realCtx.destination;
        },
        resume: async () => {
          await realCtx.resume();
          wrappedCtx.state = realCtx.state;
        },
        close: async () => {
          await realCtx.close();
          wrappedCtx.state = realCtx.state;
        },
        createGain: () => {
          const g = realCtx.createGain();
          const setValueSpy = vi.spyOn(g.gain, 'setValueAtTime');
          const rampSpy = vi.spyOn(g.gain, 'linearRampToValueAtTime');
          const disconnectSpy = vi.spyOn(g, 'disconnect');
          createdGains.push({ gainNode: g, setValueSpy, rampSpy, disconnectSpy });
          return g;
        },
        createBuffer: (channels: number, len: number, rate: number) =>
          realCtx.createBuffer(channels, len, rate),
        decodeAudioData: (buf: ArrayBuffer) => realCtx.decodeAudioData(buf),
        createBufferSource: () => {
          const src = realCtx.createBufferSource();
          const startSpy = vi.spyOn(src, 'start');
          const stopSpy = vi.spyOn(src, 'stop');
          const disconnectSpy = vi.spyOn(src, 'disconnect');
          lastCreatedSource = src;
          createdSources.push({ src, startSpy, stopSpy, disconnectSpy });
          return src;
        },
      };

      const player = new WebAudioSoundtrackPlayer(
        wrappedCtx as unknown as ConstructorParameters<typeof WebAudioSoundtrackPlayer>[0],
      );
      return {
        player,
        realCtx,
        wrappedCtx,
        getLastSource: () => lastCreatedSource,
        getCreatedSources: () => createdSources,
        getCreatedGains: () => createdGains,
      };
    }

    it('should configure loops and start playback on target source node', async () => {
      const { player, realCtx, getLastSource } = createSpiedPlayer();
      const cue = createTestAudioCue({ loopStartSec: 0.5, loopEndSec: 2.0 });
      const validBytes = createMinimalValidMp3Bytes();

      try {
        // Unlock gesture (required before playback)
        await player.unlockGesture();
        expect(player.isUnlocked()).toBe(true);

        // Play cue
        await player.playCue(cue, validBytes.buffer as ArrayBuffer);

        const sourceNode = getLastSource();
        expect(sourceNode).not.toBeNull();
        expect(sourceNode!.loop).toBe(true);
        expect(sourceNode!.loopStart).toBe(0.5);
        expect(sourceNode!.loopEnd).toBe(2.0);
        expect(player.getCurrentCue()?.id).toBe(cue.id);

        console.log('[PASS] Configured loop properties and verified active cue.');
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });

    it('should handle pause and resume by saving and passing the correct offset to source.start', async () => {
      const { player, realCtx, getCreatedSources } = createSpiedPlayer();
      const cue = createTestAudioCue({ startSec: 0.2, loopStartSec: 0.5, loopEndSec: 2.0 });
      const validBytes = createMinimalValidMp3Bytes();

      try {
        await player.unlockGesture();
        await player.playCue(cue, validBytes.buffer as ArrayBuffer);

        const sourcesBeforePause = getCreatedSources();
        expect(sourcesBeforePause.length).toBe(1);
        const source1 = sourcesBeforePause[0];
        expect(source1).toBeDefined();
        // Initial play must start at cue.startSec (0.2)
        expect(source1!.startSpy).toHaveBeenCalledWith(expect.any(Number), 0.2);

        // Pause the player
        player.pause();
        const savedOffset = player.getSavedOffset(cue.id);
        expect(savedOffset).toBeDefined();
        expect(savedOffset).toBeGreaterThanOrEqual(0.2);
        expect(player.getCurrentCue()?.id).toBe(cue.id);

        // Resume playback (isResume = true)
        await player.playCue(cue, validBytes.buffer as ArrayBuffer, true);
        const sourcesAfterResume = getCreatedSources();
        expect(sourcesAfterResume.length).toBe(2);
        const source2 = sourcesAfterResume[1];
        expect(source2).toBeDefined();
        expect(source2!.src).not.toBe(source1!.src);

        // Explicitly assert that source2.start was invoked with savedOffset
        expect(source2!.startSpy).toHaveBeenCalledWith(expect.any(Number), savedOffset);

        console.log(
          '[PASS] Player successfully paused and resumed with start offset:',
          savedOffset,
        );
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });

    it('should handle transitionToSilence and cleanup on stop', async () => {
      const { player, realCtx } = createSpiedPlayer();
      const cue = createTestAudioCue();
      const validBytes = createMinimalValidMp3Bytes();

      try {
        await player.unlockGesture();
        await player.playCue(cue, validBytes.buffer as ArrayBuffer);

        expect(player.getCurrentCue()).not.toBeNull();

        // Stop playback (clears saved offsets and stops nodes)
        player.stop();
        expect(player.getCurrentCue()).toBeNull();
        expect(player.getSavedOffset(cue.id)).toBeUndefined();

        console.log('[PASS] Player stopped and references cleaned up.');
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });

    it('should transition to silence and propagate errors on silence-first decode failures', async () => {
      const { player, realCtx, getCreatedSources, getCreatedGains } = createSpiedPlayer();
      const corruptCue = createTestAudioCue({ id: 'cue-corrupt-silence-first' });
      const corruptBytes = createCorruptMp3Bytes();

      try {
        await player.unlockGesture();
        expect(player.getCurrentCue()).toBeNull();

        // Silence-first decode failure: play cue with invalid bytes from clean idle state
        await expect(
          player.playCue(corruptCue, corruptBytes.buffer as ArrayBuffer),
        ).rejects.toThrow();

        // Player must remain in silent/null state with no active cue
        expect(player.getCurrentCue()).toBeNull();

        // Verify per-cue created gain node (gains[1]) was disconnected to prevent resource leak
        const gains = getCreatedGains();
        expect(gains.length).toBeGreaterThanOrEqual(2);
        expect(gains[1]!.disconnectSpy).toHaveBeenCalled();

        // Verify created source node was disconnected and never started
        const sources = getCreatedSources();
        expect(sources.length).toBeGreaterThanOrEqual(1);
        expect(sources[0]!.startSpy).not.toHaveBeenCalled();
        expect(sources[0]!.disconnectSpy).toHaveBeenCalled();

        console.log(
          '[PASS] Silence-first decode failure correctly rejected, cleaned up nodes, and maintained silent state.',
        );
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });

    it('should transition active playback to silence and propagate errors on active-source decode failure', async () => {
      const { player, realCtx, getCreatedSources } = createSpiedPlayer();
      const validCue = createTestAudioCue({ id: 'cue-active-valid' });
      const corruptCue = createTestAudioCue({ id: 'cue-corrupt' });
      const validBytes = createMinimalValidMp3Bytes();
      const corruptBytes = createCorruptMp3Bytes();

      try {
        await player.unlockGesture();

        // 1. Play valid cue to establish active playback
        await player.playCue(validCue, validBytes.buffer as ArrayBuffer);
        expect(player.getCurrentCue()?.id).toBe('cue-active-valid');
        const activeSource = getCreatedSources()[0];

        // 2. Play corrupt cue to trigger active-source decode failure
        await expect(
          player.playCue(corruptCue, corruptBytes.buffer as ArrayBuffer),
        ).rejects.toThrow();

        // 3. Player must tear down active playback, clear currentCue, and transition to silence
        expect(player.getCurrentCue()).toBeNull();

        // Wait for transitionToSilence fadeout timeout (0.5s default + 50ms)
        await new Promise((res) => setTimeout(res, 600));

        expect(activeSource!.stopSpy).toHaveBeenCalled();
        expect(activeSource!.disconnectSpy).toHaveBeenCalled();

        console.log(
          '[PASS] Active playback correctly transitioned to silence on corrupt decode failure.',
        );
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });

    it('should crossfade and transition smoothly between two cues with gain ramp and node cleanup', async () => {
      const { player, realCtx, getCreatedSources, getCreatedGains } = createSpiedPlayer();
      const cueA = createTestAudioCue({ id: 'cue-a', volume: 0.9, crossfadeSec: 0.1 });
      const cueB = createTestAudioCue({ id: 'cue-b', volume: 0.5, crossfadeSec: 0.1 });
      const validBytes = createMinimalValidMp3Bytes();

      try {
        await player.unlockGesture();

        // Play cue A
        await player.playCue(cueA, validBytes.buffer as ArrayBuffer);
        const sourcesAfterA = getCreatedSources();
        expect(sourcesAfterA.length).toBe(1);
        const sourceA = sourcesAfterA[0];
        expect(player.getCurrentCue()?.id).toBe('cue-a');

        // Transition to cue B (triggers crossfade of sourceA and fade in of sourceB)
        await player.playCue(cueB, validBytes.buffer as ArrayBuffer);
        const sourcesAfterB = getCreatedSources();
        expect(sourcesAfterB.length).toBe(2);
        const sourceB = sourcesAfterB[1];

        expect(sourceB!.src).not.toBe(sourceA!.src);
        expect(player.getCurrentCue()?.id).toBe('cue-b');

        // Verify gain ramp down was initiated for sourceA gain node (gains[1], since gains[0] is masterGain)
        const gains = getCreatedGains();
        expect(gains.length).toBeGreaterThanOrEqual(3);
        expect(gains[1]!.rampSpy).toHaveBeenCalledWith(0, expect.any(Number));

        // Wait for crossfade timeout (0.1s + 50ms buffer) to complete cleanup of old source
        await new Promise((res) => setTimeout(res, 200));

        expect(sourceA!.stopSpy).toHaveBeenCalled();
        expect(sourceA!.disconnectSpy).toHaveBeenCalled();

        console.log(
          '[PASS] Successfully crossfaded from cue A to cue B and verified gain ramping and node teardown.',
        );
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });
  });
});
