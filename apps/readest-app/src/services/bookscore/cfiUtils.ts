import { SoundtrackCue } from './types';

/**
 * Parses an EPUB CFI string into a list of numeric step parts and character offset for structural ordering.
 * Example: "epubcfi(/6/4[chap1]!/4/2/1:10)" -> { steps: [6, 4, 4, 2, 1], offset: 10 }
 */
export function parseCfi(cfi: string): { steps: number[]; offset: number } {
  if (!cfi) return { steps: [], offset: 0 };
  const raw = cfi.replace(/^epubcfi\((.*)\)$/, '$1');
  const parts = raw.split(':');
  const pathPart = parts[0] ?? '';
  const offsetPart = parts[1];

  // Remove assertions like [chap1] and split steps by / or !
  const cleanPath = pathPart.replace(/\[[^\]]*\]/g, '');
  const stepStrings = cleanPath.split(/[\/!]/).filter(Boolean);
  const steps = stepStrings.map((s) => {
    const num = parseInt(s, 10);
    return isNaN(num) ? 0 : num;
  });

  const offset = offsetPart ? parseInt(offsetPart, 10) : 0;
  return { steps, offset: isNaN(offset) ? 0 : offset };
}

/**
 * Compares two EPUB CFI strings.
 * Returns < 0 if cfiA < cfiB, > 0 if cfiA > cfiB, and 0 if equal.
 */
export function compareCfi(cfiA: string, cfiB: string): number {
  if (cfiA === cfiB) return 0;
  const parsedA = parseCfi(cfiA);
  const parsedB = parseCfi(cfiB);

  const len = Math.max(parsedA.steps.length, parsedB.steps.length);
  for (let i = 0; i < len; i++) {
    const stepA = parsedA.steps[i] ?? 0;
    const stepB = parsedB.steps[i] ?? 0;
    if (stepA !== stepB) {
      return stepA - stepB;
    }
  }

  return parsedA.offset - parsedB.offset;
}

/**
 * Finds the containing soundtrack cue for a given EPUB-CFI location.
 * Cues are assumed sorted by startCfi. A cue is active for a CFI if:
 * startCfi <= cfi < nextCue.startCfi.
 * If cfi is before the first cue's startCfi, returns null (unresolved location).
 */
export function findCueForCfi(cfi: string, cues: SoundtrackCue[]): SoundtrackCue | null {
  if (!cfi || !cues || cues.length === 0) return null;

  // Ensure cues are sorted by startCfi
  const sortedCues = [...cues].sort((a, b) => compareCfi(a.startCfi, b.startCfi));
  const first = sortedCues[0];

  // If location is before the first cue's start boundary, it's unresolved
  if (first && compareCfi(cfi, first.startCfi) < 0) {
    return null;
  }

  let activeCue: SoundtrackCue | null = null;
  for (const cue of sortedCues) {
    if (compareCfi(cfi, cue.startCfi) >= 0) {
      activeCue = cue;
    } else {
      break;
    }
  }

  return activeCue;
}
