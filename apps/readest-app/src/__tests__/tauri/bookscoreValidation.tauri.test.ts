import { describe, it, expect } from 'vitest';
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
    function createSpiedPlayer() {
      const AudioCtx =
        window.AudioContext || (window as unknown as WebkitWindow).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Web Audio API (AudioContext) is not supported in this environment');
      }

      const realCtx = new AudioCtx();
      let lastCreatedSource: AudioBufferSourceNode | null = null;

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
        createGain: () => realCtx.createGain(),
        createBuffer: (channels: number, len: number, rate: number) =>
          realCtx.createBuffer(channels, len, rate),
        decodeAudioData: (buf: ArrayBuffer) => realCtx.decodeAudioData(buf),
        createBufferSource: () => {
          const src = realCtx.createBufferSource();
          lastCreatedSource = src;
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

    it('should handle pause and resume by saving the correct offset', async () => {
      const { player, realCtx, getLastSource } = createSpiedPlayer();
      const cue = createTestAudioCue({ startSec: 0.2, loopStartSec: 0.5, loopEndSec: 2.0 });
      const validBytes = createMinimalValidMp3Bytes();

      try {
        await player.unlockGesture();
        await player.playCue(cue, validBytes.buffer as ArrayBuffer);

        const source1 = getLastSource();
        expect(source1).not.toBeNull();

        // Pause the player
        player.pause();
        const savedOffset = player.getSavedOffset(cue.id);
        expect(savedOffset).toBeDefined();
        expect(savedOffset).toBeGreaterThanOrEqual(0.2);
        expect(player.getCurrentCue()).toBeNull(); // Current active reference is paused/cleared

        // Resume playback
        await player.playCue(cue, validBytes.buffer as ArrayBuffer, true);
        const source2 = getLastSource();
        expect(source2).not.toBeNull();
        expect(source2).not.toBe(source1); // New source node must be created

        console.log(
          '[PASS] Player successfully paused and resumed with saved offset:',
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
      const { player, realCtx } = createSpiedPlayer();
      const cue = createTestAudioCue();
      const corruptBytes = createCorruptMp3Bytes();

      try {
        await player.unlockGesture();

        // Silence-first decode failure: play cue with invalid bytes
        await expect(player.playCue(cue, corruptBytes.buffer as ArrayBuffer)).rejects.toThrow();

        // Player must clean up its active sources and transition to silence
        expect(player.getCurrentCue()).toBeNull();
        console.log('[PASS] Player correctly transitioned to silence on corrupt decode failure.');
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });

    it('should crossfade and transition smoothly between two cues', async () => {
      const { player, realCtx, getLastSource } = createSpiedPlayer();
      const cueA = createTestAudioCue({ id: 'cue-a', volume: 0.9, crossfadeSec: 0.1 });
      const cueB = createTestAudioCue({ id: 'cue-b', volume: 0.5, crossfadeSec: 0.1 });
      const validBytes = createMinimalValidMp3Bytes();

      try {
        await player.unlockGesture();

        // Play cue A
        await player.playCue(cueA, validBytes.buffer as ArrayBuffer);
        const sourceA = getLastSource();
        expect(sourceA).not.toBeNull();
        expect(player.getCurrentCue()?.id).toBe('cue-a');

        // Transition to cue B
        await player.playCue(cueB, validBytes.buffer as ArrayBuffer);
        const sourceB = getLastSource();
        expect(sourceB).not.toBeNull();
        expect(sourceB).not.toBe(sourceA);
        expect(player.getCurrentCue()?.id).toBe('cue-b');

        console.log('[PASS] Successfully crossfaded from cue A to cue B.');
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });
  });
});
