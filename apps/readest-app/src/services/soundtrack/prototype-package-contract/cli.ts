import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  addCue,
  corruptAsset,
  initialState,
  makeEditableCopy,
  validate,
  type PrototypeState,
} from './model.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
let state: PrototypeState = initialState();

function render() {
  console.clear();
  const errors = validate(state.active);
  console.log(`${bold}Soundtrack package contract — THROWAWAY PROTOTYPE${reset}`);
  console.log(
    `${dim}Question: does this manifest separate portable package facts from local mutability?${reset}\n`,
  );
  console.log(`${bold}Local state${reset}`);
  console.log(`mode: ${state.mode}`);
  console.log(`active package: ${state.active.id}`);
  console.log(`derived from: ${state.active.derivedFrom?.packageId ?? 'none (original import)'}`);
  console.log(
    `assets: ${state.active.assets.map((asset) => `${asset.id} → ${asset.path}`).join(', ')}`,
  );
  console.log(`cues: ${state.active.cues.map((cue) => `${cue.id} (${cue.kind})`).join(', ')}`);
  console.log(`validation: ${errors.length ? `INVALID — ${errors.join(' ')}` : 'valid'}`);
  console.log(`last action: ${state.lastAction}\n`);
  console.log(`${bold}Commands${reset}`);
  console.log('[c] create editable descendant  [a] add silent cue  [v] validate');
  console.log('[x] corrupt checksum            [r] reset             [q] quit');
}

const terminal = readline.createInterface({ input, output });
for (;;) {
  render();
  const command = (await terminal.question('> ')).trim().toLowerCase();
  if (command === 'q') break;
  if (command === 'c') state = makeEditableCopy(state);
  else if (command === 'a') state = addCue(state);
  else if (command === 'x') state = corruptAsset(state);
  else if (command === 'v')
    state = {
      ...state,
      lastAction: `Validation ran: ${validate(state.active).length || 'no'} error(s).`,
    };
  else if (command === 'r') state = initialState();
  else state = { ...state, lastAction: 'Unknown command.' };
}
terminal.close();
