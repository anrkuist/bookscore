# PROTOTYPE — desktop audio engine boundary

## Question

Does a platform-neutral soundtrack state model stay understandable when the runtime seam accepts playback intent (`transitionTo`, `pause`, `resume`, `dispose`) instead of exposing Web Audio nodes, native handles, or crossfade bookkeeping? Drive the difficult sequences by hand: gesture startup, cue transitions, intentional silence, pause/resume, cue re-entry, TTS exclusion, and close/reopen cleanup.

Run it from `apps/readest-app`:

```sh
pnpm prototype:soundtrack-audio
```

This is deliberately throwaway. It emits the operations a runtime adapter would receive; it does not play audio.

## Interface under test

```ts
type PlaybackTarget =
  | {
      kind: 'loop';
      assetId: string;
      startSec: number;
      loopStartSec: number;
      loopEndSec: number;
    }
  | { kind: 'silence' };

interface SoundtrackAudioAdapter {
  unlockFromGesture(): Promise<void>;
  transitionTo(target: PlaybackTarget, options: { fadeMs: number; restart: true }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  setVolume(volume: number): void;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
```

The adapter hides decoding, two-source overlap during crossfades, loop nodes, gain automation, and resource cleanup. The state model owns product policy: playback never starts without a gesture, re-entering a cue restarts it, TTS and soundtrack playback exclude each other, and reopening selects the containing cue but waits for Play.

## Runtime hypothesis to evaluate

Use a dedicated Web Audio `AudioContext` for the desktop adapter and keep the interface above independent of it. Readest already exercises Web Audio on desktop, including gesture-time warmup and lifecycle behavior. `AudioBufferSourceNode` supplies explicit loop points and gain automation supplies clock-scheduled crossfades. A future browser adapter can reuse this implementation; a future native-mobile adapter can satisfy the same interface.

The package baseline should be MP3 (`audio/mpeg`), validated by an actual decode during import. Web Audio only promises to decode formats supported by the host media implementation, so BookScore must treat decode failure as an unsupported asset rather than claim that the Web Audio specification itself guarantees MP3. Exact profile, duration, and decoded-memory limits belong with package validation.

## Reactions to capture

- **Validated:** after TTS stops, the soundtrack remains paused until the user presses Play.
- Does Pause/Resume correctly preserve position while cue re-entry restarts from the authored loop start?
- Is “transition to intentional silence” usefully the same adapter operation as transitioning to an audio asset?
- Is any caller forced to know a Web Audio or native-runtime detail?
