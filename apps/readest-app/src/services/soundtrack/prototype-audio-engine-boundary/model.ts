export type Cue = {
  id: string;
  label: string;
  target:
    | { kind: 'loop'; assetId: string; loopStartSec: number; loopEndSec: number }
    | { kind: 'silence' };
};

export type Transport = 'waiting-for-gesture' | 'playing' | 'paused' | 'tts-active';

export type PrototypeState = {
  cues: readonly Cue[];
  cueIndex: number;
  transport: Transport;
  audioUnlocked: boolean;
  soundtrackStarted: boolean;
  adapterCueId: string | null;
  lastAction: string;
  effects: readonly AdapterEffect[];
};

export type PrototypeAction =
  | { type: 'play-from-gesture' }
  | { type: 'pause' }
  | { type: 'next-cue' }
  | { type: 'previous-cue' }
  | { type: 'reenter-cue' }
  | { type: 'tts-started' }
  | { type: 'tts-stopped' }
  | { type: 'close-and-reopen' };

export type AdapterEffect =
  | { type: 'unlock-from-gesture' }
  | { type: 'request-tts-stop' }
  | { type: 'transition-to'; cue: Cue; fadeMs: number; restart: true }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'dispose' };

export const CUES: readonly Cue[] = [
  {
    id: 'arrival',
    label: 'Arrival at Blackwood',
    target: { kind: 'loop', assetId: 'rain.mp3', loopStartSec: 4.2, loopEndSec: 52.8 },
  },
  {
    id: 'library',
    label: 'The sealed library',
    target: { kind: 'loop', assetId: 'library.mp3', loopStartSec: 2, loopEndSec: 44.5 },
  },
  { id: 'letter', label: 'The letter', target: { kind: 'silence' } },
];

export const initialState = (cueIndex = 0): PrototypeState => ({
  cues: CUES,
  cueIndex,
  transport: 'waiting-for-gesture',
  audioUnlocked: false,
  soundtrackStarted: false,
  adapterCueId: null,
  lastAction: 'book opened; containing cue selected',
  effects: [],
});

const selectedCue = (state: PrototypeState): Cue => state.cues[state.cueIndex]!;

const startSelectedCue = (state: PrototypeState): PrototypeState => {
  const cue = selectedCue(state);
  const effects: AdapterEffect[] = [];
  if (!state.audioUnlocked) effects.push({ type: 'unlock-from-gesture' });
  if (state.transport === 'tts-active') effects.push({ type: 'request-tts-stop' });

  if (state.adapterCueId === cue.id && state.transport === 'paused') {
    effects.push({ type: 'resume' });
  } else {
    effects.push({ type: 'transition-to', cue, fadeMs: 1200, restart: true });
  }

  return {
    ...state,
    transport: 'playing',
    audioUnlocked: true,
    soundtrackStarted: true,
    adapterCueId: cue.id,
    lastAction: 'Play pressed in a user gesture',
    effects,
  };
};

const moveCue = (state: PrototypeState, delta: number): PrototypeState => {
  const cueIndex = (state.cueIndex + delta + state.cues.length) % state.cues.length;
  const cue = state.cues[cueIndex]!;
  const effects: AdapterEffect[] =
    state.transport === 'playing'
      ? [{ type: 'transition-to', cue, fadeMs: 1200, restart: true }]
      : [];
  return {
    ...state,
    cueIndex,
    adapterCueId: state.transport === 'playing' ? cue.id : state.adapterCueId,
    lastAction: delta > 0 ? 'reader crossed the next cue boundary' : 'reader moved to a prior cue',
    effects,
  };
};

export const reducePrototype = (
  state: PrototypeState,
  action: PrototypeAction,
): PrototypeState => {
  switch (action.type) {
    case 'play-from-gesture':
      return startSelectedCue(state);
    case 'pause':
      if (state.transport !== 'playing') return { ...state, effects: [], lastAction: 'Pause ignored' };
      return { ...state, transport: 'paused', effects: [{ type: 'pause' }], lastAction: 'Pause pressed' };
    case 'next-cue':
      return moveCue(state, 1);
    case 'previous-cue':
      return moveCue(state, -1);
    case 'reenter-cue': {
      const cue = selectedCue(state);
      return {
        ...state,
        adapterCueId: state.transport === 'playing' ? cue.id : state.adapterCueId,
        effects:
          state.transport === 'playing'
            ? [{ type: 'transition-to', cue, fadeMs: 1200, restart: true }]
            : [],
        lastAction: 'current cue re-entered; cue restarts only while playing',
      };
    }
    case 'tts-started':
      return {
        ...state,
        transport: 'tts-active',
        effects: state.transport === 'playing' ? [{ type: 'pause' }] : [],
        lastAction: 'TTS started; soundtrack yields audio focus',
      };
    case 'tts-stopped':
      if (state.transport !== 'tts-active') {
        return { ...state, effects: [], lastAction: 'TTS stop ignored' };
      }
      return {
        ...state,
        transport: state.soundtrackStarted ? 'paused' : 'waiting-for-gesture',
        effects: [],
        lastAction: 'TTS stopped; soundtrack does not resume unexpectedly',
      };
    case 'close-and-reopen': {
      const reopened = initialState(state.cueIndex);
      return {
        ...reopened,
        effects: [{ type: 'stop' }, { type: 'dispose' }],
        lastAction: 'book closed and reopened at the saved reading position',
      };
    }
  }
};
