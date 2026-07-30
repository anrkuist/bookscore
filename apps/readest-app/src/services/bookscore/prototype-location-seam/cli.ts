/**
 * PROTOTYPE — throw away after resolving "Choose the reader-to-soundtrack location seam".
 *
 * Question: Is one ordered `reportReaderLocation(report)` interface enough to preserve
 * authored EPUB location, navigation semantics, safe unresolved states, and latest-wins
 * behavior across pagination, scrolling, jumps, history, restore, and rapid transitions?
 */
import { createInterface } from 'node:readline';
import { initialReaderLocationState, isCueSelectionSafe, reportReaderLocation } from './model.ts';
import type {
  EpubLocator,
  ReaderLocationReport,
  ReaderLocationState,
  ReaderNavigation,
} from './model.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

let state: ReaderLocationState = initialReaderLocationState();
let nextTransition = 1;
let ordinal = 10;
let pending: ReaderLocationReport[] = [];

const locator = (position: number): EpubLocator => ({
  type: 'epub-cfi',
  value: `epubcfi(/6/${position * 2}[chapter-${position}]!/4/2/1:0)`,
});

const describeNavigation = (navigation: ReaderNavigation): string => {
  if (navigation.kind === 'restore') return 'restore (system)';
  return `${navigation.kind} ${navigation.direction} (user)`;
};

const apply = (report: ReaderLocationReport) => {
  state = reportReaderLocation(state, report);
};

const settled = (navigation: ReaderNavigation, position = ordinal): ReaderLocationReport => ({
  transition: nextTransition++,
  navigation,
  phase: 'settled',
  location: { status: 'located', locator: locator(position) },
});

const startJump = () => {
  ordinal += 10;
  const report: ReaderLocationReport = {
    transition: nextTransition++,
    navigation: { kind: 'jump', direction: 'unknown' },
    phase: 'started',
    requested: locator(ordinal),
  };
  pending.push(report);
  apply(report);
};

const settlePending = (index: number, available: boolean) => {
  const started = pending[index];
  if (!started || started.phase !== 'started') return;
  const requested = started.requested;
  apply({
    transition: started.transition,
    navigation: started.navigation,
    phase: 'settled',
    location:
      available && requested
        ? { status: 'located', locator: requested }
        : { status: 'unavailable', requested, reason: 'invalid-anchor' },
  });
  pending.splice(index, 1);
};

const render = () => {
  console.clear();
  const current = state.current;
  console.log(`${bold}Reader → soundtrack location seam prototype${reset}`);
  console.log(
    `${dim}One ordered report interface; soundtrack logic sees no Foliate or DOM types.${reset}\n`,
  );
  console.log(`${bold}transition${reset}: ${current?.transition ?? 'none'}`);
  console.log(
    `${bold}navigation${reset}: ${current ? describeNavigation(current.navigation) : 'none'}`,
  );
  console.log(`${bold}phase${reset}: ${current?.phase ?? 'none'}`);
  if (!current) {
    console.log(`${bold}authored location${reset}: none`);
  } else if (current.phase === 'started') {
    console.log(
      `${bold}authored location${reset}: resolving ${current.requested?.value ?? 'unknown'}`,
    );
  } else if (current.location.status === 'located') {
    console.log(`${bold}authored location${reset}: ${current.location.locator.value}`);
  } else {
    console.log(
      `${bold}authored location${reset}: unavailable (${current.location.reason}) ${current.location.requested?.value ?? ''}`,
    );
  }
  console.log(
    `${bold}cue selection${reset}: ${isCueSelectionSafe(state) ? 'enabled' : 'safe silence'}`,
  );
  console.log(`${bold}last report${reset}: ${state.lastDisposition}`);
  console.log(
    `${bold}pending jumps${reset}: ${pending.map((item) => item.transition).join(', ') || 'none'}`,
  );

  console.log(`\n${bold}Actions${reset}`);
  console.log('[n] page forward  [p] page backward  [s] scroll forward  [b] scroll backward');
  console.log('[r] restore  [j] start jump  [l] settle latest  [o] settle oldest late');
  console.log('[x] fail latest jump  [z] rapid-race scenario  [q] quit');
};

const runRapidRace = () => {
  startJump();
  startJump();
  settlePending(pending.length - 1, true);
  settlePending(0, true);
};

const handle = (input: string) => {
  switch (input.trim().toLowerCase()) {
    case 'n':
      ordinal += 1;
      apply(settled({ kind: 'page', direction: 'forward' }));
      break;
    case 'p':
      ordinal = Math.max(0, ordinal - 1);
      apply(settled({ kind: 'page', direction: 'backward' }));
      break;
    case 's':
      ordinal += 1;
      apply(settled({ kind: 'scroll', direction: 'forward' }));
      break;
    case 'b':
      ordinal = Math.max(0, ordinal - 1);
      apply(settled({ kind: 'scroll', direction: 'backward' }));
      break;
    case 'r':
      apply(settled({ kind: 'restore' }));
      break;
    case 'j':
      startJump();
      break;
    case 'l':
      settlePending(pending.length - 1, true);
      break;
    case 'o':
      settlePending(0, true);
      break;
    case 'x':
      settlePending(pending.length - 1, false);
      break;
    case 'z':
      runRapidRace();
      break;
    case 'q':
      process.exit(0);
  }
  render();
};

const readline = createInterface({ input: process.stdin, output: process.stdout });
readline.on('line', handle);
readline.on('close', () => process.exit(0));
render();
