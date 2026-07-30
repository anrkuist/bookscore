export type EpubLocator = {
  type: 'epub-cfi';
  value: string;
};

export type ReaderNavigation =
  | { kind: 'restore' }
  | { kind: 'page'; direction: 'forward' | 'backward' }
  | { kind: 'scroll'; direction: 'forward' | 'backward' }
  | { kind: 'jump'; direction: 'forward' | 'backward' | 'unknown' };

export type ReaderLocationReport = {
  transition: number;
  navigation: ReaderNavigation;
} & (
  | {
      phase: 'started';
      requested?: EpubLocator;
    }
  | {
      phase: 'settled';
      location:
        | { status: 'located'; locator: EpubLocator }
        | {
            status: 'unavailable';
            requested?: EpubLocator;
            reason: 'invalid-anchor' | 'missing-anchor' | 'unsupported-anchor';
          };
    }
);

export type ReaderLocationState = {
  current: ReaderLocationReport | null;
  lastDisposition: 'accepted' | 'ignored-stale' | 'ignored-duplicate';
};

export const initialReaderLocationState = (): ReaderLocationState => ({
  current: null,
  lastDisposition: 'accepted',
});

export const reportReaderLocation = (
  state: ReaderLocationState,
  report: ReaderLocationReport,
): ReaderLocationState => {
  const current = state.current;
  if (current && report.transition < current.transition) {
    return { ...state, lastDisposition: 'ignored-stale' };
  }

  if (current && report.transition === current.transition) {
    const completesCurrentTransition = current.phase === 'started' && report.phase === 'settled';
    if (!completesCurrentTransition) {
      return { ...state, lastDisposition: 'ignored-duplicate' };
    }
  }

  return { current: report, lastDisposition: 'accepted' };
};

export const isCueSelectionSafe = (state: ReaderLocationState): boolean =>
  state.current?.phase === 'settled' && state.current.location.status === 'located';
