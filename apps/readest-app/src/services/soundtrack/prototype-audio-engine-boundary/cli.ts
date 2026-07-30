import { emitKeypressEvents } from 'node:readline';
import { initialState, reducePrototype, type PrototypeAction, type PrototypeState } from './model.ts';

const BOLD = '\u001B[1m';
const DIM = '\u001B[2m';
const RESET = '\u001B[0m';

let state = initialState();

const cueTarget = (current: PrototypeState): string => {
  const cue = current.cues[current.cueIndex]!;
  if (cue.target.kind === 'silence') return 'intentional silence';
  return `${cue.target.assetId} [start ${cue.target.startSec.toFixed(1)}s; loop ${cue.target.loopStartSec.toFixed(1)}s–${cue.target.loopEndSec.toFixed(1)}s]`;
};

const effectLabel = (effect: PrototypeState['effects'][number]): string => {
  if (effect.type !== 'transition-to') return effect.type;
  const target = effect.cue.target.kind === 'silence' ? 'silence' : effect.cue.target.assetId;
  return `transition-to ${target} (${effect.fadeMs}ms crossfade, restart=${effect.restart})`;
};

const render = (): void => {
  console.clear();
  const cue = state.cues[state.cueIndex]!;
  const effects = state.effects.length === 0 ? ['(none)'] : state.effects.map(effectLabel);
  console.log(`${BOLD}PROTOTYPE — desktop audio engine boundary${RESET}`);
  console.log(`${DIM}Question: does a high-level playback-intent seam preserve the MVP rules?${RESET}\n`);
  console.log(`${BOLD}transport${RESET}          ${state.transport}`);
  console.log(`${BOLD}audio unlocked${RESET}     ${state.audioUnlocked}`);
  console.log(`${BOLD}soundtrack started${RESET} ${state.soundtrackStarted}`);
  console.log(`${BOLD}selected cue${RESET}       ${cue.label} (${cue.id})`);
  console.log(`${BOLD}target${RESET}             ${cueTarget(state)}`);
  console.log(`${BOLD}adapter cue${RESET}        ${state.adapterCueId ?? '(none)'}`);
  console.log(`${BOLD}master volume${RESET}      ${Math.round(state.volume * 100)}%`);
  console.log(`${BOLD}last action${RESET}        ${state.lastAction}`);
  console.log(`\n${BOLD}adapter effects${RESET}`);
  for (const effect of effects) console.log(`  ${effect}`);
  console.log(`\n${BOLD}Drive the model${RESET}`);
  console.log(`${BOLD}[space]${RESET} Play/resume from gesture   ${BOLD}[p]${RESET} Pause`);
  console.log(`${BOLD}[→/n]${RESET} Next cue                   ${BOLD}[←/b]${RESET} Previous cue`);
  console.log(`${BOLD}[r]${RESET} Re-enter current cue        ${BOLD}[t]${RESET} Start/stop TTS`);
  console.log(`${BOLD}[+/-]${RESET} Adjust master volume`);
  console.log(`${BOLD}[o]${RESET} Close + reopen book         ${BOLD}[q]${RESET} Quit`);
};

const dispatch = (action: PrototypeAction): void => {
  state = reducePrototype(state, action);
  render();
};

emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('keypress', (input, key) => {
  if (key.ctrl && key.name === 'c') process.exit(0);
  if (key.name === 'q') process.exit(0);
  if (key.name === 'space') dispatch({ type: 'play-from-gesture' });
  if (key.name === 'p') dispatch({ type: 'pause' });
  if (key.name === 'right' || key.name === 'n') dispatch({ type: 'next-cue' });
  if (key.name === 'left' || key.name === 'b') dispatch({ type: 'previous-cue' });
  if (key.name === 'r') dispatch({ type: 'reenter-cue' });
  if (key.name === 't') {
    dispatch({ type: state.transport === 'tts-active' ? 'tts-stopped' : 'tts-started' });
  }
  if (input === '+') dispatch({ type: 'change-volume', delta: 0.1 });
  if (input === '-') dispatch({ type: 'change-volume', delta: -0.1 });
  if (key.name === 'o') dispatch({ type: 'close-and-reopen' });
});

render();
