import * as CFI from 'foliate-js/epubcfi.js';
import { getCfiSpinePrefix, isMalformedLocationCfi } from '@/utils/cfi';

export interface MoodAnalysisBlock {
  id?: string;
  text: string;
  startCfi: string;
  endCfi: string;
}

export interface ProtectedRange {
  id?: string;
  startCfi: string;
  endCfi: string;
  reason?: string;
}

export interface MoodAnalysisOptions {
  language?: string;
  granularity?: 'paragraph' | 'sentence' | 'scene' | 'chapter';
  minSpanChars?: number;
  targetSpanChars?: number;
  fallbackMood?: string;
  confidenceThreshold?: number;
  timestamp?: number;
}

export interface MoodSegment {
  id: string;
  startCfi: string;
  endCfi: string;
  mood: string;
  confidence: number;
  textSummary?: string;
  scores: Record<string, number>;
  isProtected: boolean;
  blockIds: string[];
}

export type QualityDisposition = 'accepted' | 'review_suggested' | 'rejected';

export interface MoodAnalysisDraftQuality {
  totalBlocks: number;
  acceptedBlocks: number;
  rejectedBlocks: number;
  coverageRatio: number;
  hasFallback: boolean;
  protectedExclusions: number;
  disposition: QualityDisposition;
  reasons: string[];
}

export interface MoodAnalysisDraft {
  draftId: string;
  chapterId: string;
  spinePrefix: string | null;
  primaryMood: string;
  overallScores: Record<string, number>;
  segments: MoodSegment[];
  quality: MoodAnalysisDraftQuality;
  createdAt: number;
  isIsolated: true;
}

export interface MoodAnalysisInput {
  chapterId: string;
  spinePrefix?: string;
  /** The chapter DOM that originated these anchors. */
  chapterDocument: Document;
  blocks: MoodAnalysisBlock[];
  protectedRanges?: ProtectedRange[];
  options?: MoodAnalysisOptions;
}

export const CANONICAL_MOODS = [
  'Tension',
  'Wonder',
  'Melancholy',
  'Joy',
  'Calm',
  'Dread',
  'Mystery',
  'Hope',
] as const;

export type CanonicalMood = (typeof CANONICAL_MOODS)[number];

const MOOD_LEXICON: Record<CanonicalMood, string[]> = {
  Tension: [
    'danger',
    'threat',
    'shadow',
    'crept',
    'suddenly',
    'gasp',
    'sword',
    'fear',
    'blade',
    'strike',
    'heartbeat',
    'breathless',
    'alarm',
    'tight',
    'chase',
    'trapped',
    'warning',
  ],
  Wonder: [
    'magical',
    'glowing',
    'stars',
    'vast',
    'radiance',
    'miracle',
    'dazzling',
    'glorious',
    'marvel',
    'starlight',
    'infinite',
    'enchanted',
    'splendor',
    'beauty',
    'awe',
  ],
  Melancholy: [
    'tear',
    'grief',
    'lonely',
    'lost',
    'faded',
    'sorrow',
    'mourn',
    'sadness',
    'regret',
    'despair',
    'solitude',
    'wept',
    'empty',
    'darkness',
    'gloom',
  ],
  Joy: [
    'laugh',
    'smile',
    'happy',
    'delight',
    'cheer',
    'triumph',
    'celebrate',
    'bright',
    'warmth',
    'rejoice',
    'pleasure',
    'sunshine',
    'sparkle',
    'jubilant',
  ],
  Calm: [
    'peaceful',
    'quiet',
    'soft',
    'breeze',
    'gentle',
    'stillness',
    'tranquil',
    'serene',
    'rest',
    'silent',
    'whisper',
    'smooth',
    'calm',
    'slumber',
  ],
  Dread: [
    'terror',
    'horror',
    'monster',
    'blood',
    'scream',
    'nightmare',
    'ghastly',
    'doomed',
    'sinister',
    'creeping',
    'grim',
    'chilling',
    'macabre',
    'panic',
  ],
  Mystery: [
    'secret',
    'riddle',
    'puzzle',
    'hidden',
    'strange',
    'curious',
    'unknown',
    'enigma',
    'obscure',
    'shadowy',
    'whispered',
    'clue',
    'bizarre',
    'mysterious',
  ],
  Hope: [
    'promise',
    'dawn',
    'faith',
    'courage',
    'aspire',
    'dream',
    'believe',
    'salvation',
    'healing',
    'light',
    'future',
    'resolve',
    'triumph',
    'restored',
  ],
};

function roundScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function compareCanonicalCfi(cfiA: string, cfiB: string): number | null {
  if (!isValidCfi(cfiA) || !isValidCfi(cfiB)) return null;
  try {
    return CFI.compare(cfiA, cfiB);
  } catch {
    return null;
  }
}

function simpleStringHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function isValidCfi(cfi: string | undefined | null): boolean {
  if (!cfi || typeof cfi !== 'string') return false;
  if (!cfi.startsWith('epubcfi(')) return false;
  if (hasUnescapedRangeSeparator(cfi)) return false; // Block boundaries must be point CFIs
  if (isMalformedLocationCfi(cfi)) return false;
  try {
    CFI.parse(cfi);
    return getCfiSpinePrefix(cfi) !== null;
  } catch {
    return false;
  }
}

function hasUnescapedRangeSeparator(cfi: string): boolean {
  for (let index = 0; index < cfi.length; index++) {
    if (cfi[index] !== ',') continue;
    let escapes = 0;
    for (let cursor = index - 1; cursor >= 0 && cfi[cursor] === '^'; cursor--) escapes++;
    if (escapes % 2 === 0) return true;
  }
  return false;
}

function isInert(node: Node): boolean {
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as Element;
      if (element.hasAttribute('cfi-inert') || element.classList.contains('cfi-inert')) return true;
    }
    current = current.parentNode;
  }
  return false;
}

function toChapterRange(doc: Document, cfi: string): Range | null {
  const spinePrefix = getCfiSpinePrefix(cfi);
  if (!spinePrefix) return null;
  const prefix = `epubcfi(${spinePrefix}!`;
  if (!cfi.startsWith(prefix)) return null;
  const inner = cfi.slice(prefix.length, -1);
  if (!inner) return null;
  try {
    return CFI.toRange(doc, CFI.parse(`epubcfi(${inner})`)) ?? null;
  } catch {
    return null;
  }
}

function isReadableRange(range: Range): boolean {
  if (isInert(range.startContainer) || isInert(range.endContainer)) return false;
  if (range.collapsed) {
    return (
      range.startContainer.nodeType === Node.TEXT_NODE &&
      Boolean(range.startContainer.nodeValue?.trim())
    );
  }
  const doc = range.commonAncestorContainer.ownerDocument;
  if (!doc) return false;
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (isInert(node) || !(node.nodeValue ?? '').trim()) return NodeFilter.FILTER_REJECT;
      const nodeRange = range.cloneRange();
      nodeRange.selectNodeContents(node);
      return range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
        range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  return Boolean(walker.nextNode());
}

function verifyCanonicalRoundTrip(cfi: string, range: Range): boolean {
  const spinePrefix = getCfiSpinePrefix(cfi);
  if (!spinePrefix) return false;
  try {
    const regeneratedInner = CFI.fromRange(range);
    if (
      !regeneratedInner ||
      typeof regeneratedInner !== 'string' ||
      !regeneratedInner.startsWith('epubcfi(')
    ) {
      return false;
    }
    const innerCfi = regeneratedInner.slice('epubcfi('.length, -1);
    const regeneratedCfi = `epubcfi(${spinePrefix}!${innerCfi})`;
    const cmp = compareCanonicalCfi(regeneratedCfi, cfi);
    return cmp === 0;
  } catch {
    return false;
  }
}

function isValidChapterDocument(doc: unknown): doc is Document {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as Record<string, unknown>;
  return (
    d.nodeType === 9 &&
    typeof d.createRange === 'function' &&
    typeof d.createElement === 'function' &&
    typeof d.createTreeWalker === 'function'
  );
}

function isBlockValid(
  block: Pick<MoodAnalysisBlock, 'startCfi' | 'endCfi'>,
  expectedSpinePrefix?: string | null,
  chapterDocument?: Document,
): { valid: boolean; reason?: string } {
  if (!isValidCfi(block.startCfi)) {
    return { valid: false, reason: 'Invalid or malformed startCfi' };
  }
  if (!isValidCfi(block.endCfi)) {
    return { valid: false, reason: 'Invalid or malformed endCfi' };
  }

  const startSpine = getCfiSpinePrefix(block.startCfi);
  const endSpine = getCfiSpinePrefix(block.endCfi);

  if (startSpine !== endSpine) {
    return {
      valid: false,
      reason: `Anchor provenance mismatch: startCfi spine (${startSpine}) != endCfi spine (${endSpine})`,
    };
  }

  const comparison = compareCanonicalCfi(block.startCfi, block.endCfi);
  if (comparison === null) {
    return { valid: false, reason: 'Unable to canonically compare CFI range' };
  }
  if (comparison > 0) {
    return { valid: false, reason: 'Backwards CFI range (startCfi > endCfi)' };
  }

  if (expectedSpinePrefix) {
    if (startSpine && startSpine !== expectedSpinePrefix) {
      return {
        valid: false,
        reason: `Block startCfi spine (${startSpine}) does not match chapter spine (${expectedSpinePrefix})`,
      };
    }
  }

  if (!isValidChapterDocument(chapterDocument)) {
    return { valid: false, reason: 'chapterDocument is required and must be a valid Document' };
  }
  const startRange = toChapterRange(chapterDocument, block.startCfi);
  const endRange = toChapterRange(chapterDocument, block.endCfi);
  if (!startRange || !endRange) {
    return { valid: false, reason: 'CFI does not resolve against chapter document' };
  }
  if (!verifyCanonicalRoundTrip(block.startCfi, startRange)) {
    return {
      valid: false,
      reason: 'startCfi does not canonically round-trip from resolved chapter DOM range',
    };
  }
  if (!verifyCanonicalRoundTrip(block.endCfi, endRange)) {
    return {
      valid: false,
      reason: 'endCfi does not canonically round-trip from resolved chapter DOM range',
    };
  }
  if (!isReadableRange(startRange) || !isReadableRange(endRange)) {
    return { valid: false, reason: 'CFI resolves to inert or unreadable chapter content' };
  }

  return { valid: true };
}

function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): { overlaps: boolean; comparisonFailed: boolean } {
  const startToEnd = compareCanonicalCfi(startA, endB);
  const endToStart = compareCanonicalCfi(endA, startB);
  if (startToEnd === null || endToStart === null) {
    return { overlaps: true, comparisonFailed: true };
  }
  return {
    overlaps: startToEnd < 0 && endToStart > 0,
    comparisonFailed: false,
  };
}

function scoreText(text: string): {
  primaryMood: CanonicalMood;
  confidence: number;
  scores: Record<string, number>;
} {
  const lower = text.toLowerCase();
  const rawScores: Record<CanonicalMood, number> = {
    Tension: 0,
    Wonder: 0,
    Melancholy: 0,
    Joy: 0,
    Calm: 0,
    Dread: 0,
    Mystery: 0,
    Hope: 0,
  };

  let totalHits = 0;
  for (const mood of CANONICAL_MOODS) {
    const keywords = MOOD_LEXICON[mood];
    for (const kw of keywords) {
      const matches = lower.split(kw).length - 1;
      if (matches > 0) {
        rawScores[mood] += matches;
        totalHits += matches;
      }
    }
  }

  const scores: Record<string, number> = {};
  if (totalHits === 0) {
    for (const mood of CANONICAL_MOODS) {
      scores[mood] = mood === 'Calm' ? 0.5 : 0.1;
    }
    return { primaryMood: 'Calm', confidence: 0.5, scores };
  }

  let topMood: CanonicalMood = 'Calm';
  let maxScore = -1;

  for (const mood of CANONICAL_MOODS) {
    const norm = roundScore(rawScores[mood] / totalHits);
    scores[mood] = norm;
    if (norm > maxScore) {
      maxScore = norm;
      topMood = mood;
    } else if (norm === maxScore) {
      if (mood < topMood) {
        topMood = mood;
      }
    }
  }

  return {
    primaryMood: topMood,
    confidence: maxScore,
    scores,
  };
}

export class ChapterMoodAnalyzer {
  static extractSpinePrefix(cfi: string): string | null {
    return getCfiSpinePrefix(cfi);
  }

  static validateInput(input: MoodAnalysisInput): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!input || typeof input !== 'object') {
      return { valid: false, errors: ['Input must be a valid object'] };
    }
    if (!input.chapterId || typeof input.chapterId !== 'string') {
      errors.push('chapterId is required and must be a string');
    }
    if (!isValidChapterDocument(input.chapterDocument)) {
      errors.push('chapterDocument is required and must be a valid Document');
    }
    if (!Array.isArray(input.blocks)) {
      errors.push('blocks must be an array');
    } else {
      input.blocks.forEach((b, idx) => {
        const res = isBlockValid(b, input.spinePrefix, input.chapterDocument);
        if (!res.valid) {
          errors.push(`Block[${idx}] (id=${b.id ?? idx}): ${res.reason}`);
        }
      });
    }
    if (Array.isArray(input.protectedRanges)) {
      input.protectedRanges.forEach((range, idx) => {
        const res = isBlockValid(range, input.spinePrefix, input.chapterDocument);
        if (!res.valid) {
          errors.push(`ProtectedRange[${idx}] (id=${range.id ?? idx}): ${res.reason}`);
        }
      });
    }
    return { valid: errors.length === 0, errors };
  }

  static analyze(input: MoodAnalysisInput): MoodAnalysisDraft {
    const options = input.options ?? {};
    const fallbackMood = options.fallbackMood ?? 'Calm';
    const confidenceThreshold = options.confidenceThreshold ?? 0.35;
    const requestedLanguage = (options.language ?? 'en').toLowerCase();
    const granularity = options.granularity ?? 'paragraph';
    const timestamp = options.timestamp ?? 1700000000000;

    const rawBlocks = input.blocks ?? [];
    const protectedRanges = input.protectedRanges ?? [];

    let spinePrefix = input.spinePrefix ?? null;
    if (!spinePrefix && rawBlocks.length > 0) {
      for (const b of rawBlocks) {
        const pref = getCfiSpinePrefix(b.startCfi);
        if (pref) {
          spinePrefix = pref;
          break;
        }
      }
    }

    if (!isValidChapterDocument(input.chapterDocument)) {
      const seedString = `${input.chapterId}:${spinePrefix}:${rawBlocks.length}:${timestamp}`;
      const draftHash = simpleStringHash(seedString);
      const overallScores: Record<string, number> = {};
      for (const mood of CANONICAL_MOODS) {
        overallScores[mood] = mood === fallbackMood ? 1 : 0;
      }
      return {
        draftId: `draft-${input.chapterId}-${draftHash}`,
        chapterId: input.chapterId,
        spinePrefix,
        primaryMood: fallbackMood,
        overallScores,
        segments: [],
        quality: {
          totalBlocks: rawBlocks.length,
          acceptedBlocks: 0,
          rejectedBlocks: rawBlocks.length,
          coverageRatio: 0,
          hasFallback: true,
          protectedExclusions: 0,
          disposition: 'rejected',
          reasons: ['chapterDocument is required and must be a valid Document'],
        },
        createdAt: timestamp,
        isIsolated: true,
      };
    }

    let candidateBlocks: Array<{ block: MoodAnalysisBlock; id: string }> = [];
    let rejectedCount = 0;
    const rejectionReasons: string[] = [];

    // Filter valid blocks matching spine and anchor provenance
    for (let idx = 0; idx < rawBlocks.length; idx++) {
      const b = rawBlocks[idx]!;
      const check = isBlockValid(b, spinePrefix, input.chapterDocument);
      if (!check.valid) {
        rejectedCount++;
        rejectionReasons.push(`Block[${idx}] ${check.reason}`);
        continue;
      }
      const id = b.id ?? `blk-${idx}-${b.startCfi}`;
      candidateBlocks.push({ block: b, id });
    }

    // Fail closed on candidate block sort comparisons if canonical start or end comparison is unavailable
    const sortFailedBlockIds = new Set<string>();
    for (let i = 0; i < candidateBlocks.length; i++) {
      for (let j = i + 1; j < candidateBlocks.length; j++) {
        const a = candidateBlocks[i]!;
        const b = candidateBlocks[j]!;
        const cmpStart = compareCanonicalCfi(a.block.startCfi, b.block.startCfi);
        if (cmpStart === null) {
          sortFailedBlockIds.add(a.id);
          sortFailedBlockIds.add(b.id);
          continue;
        }
        if (cmpStart === 0) {
          const cmpEnd = compareCanonicalCfi(a.block.endCfi, b.block.endCfi);
          if (cmpEnd === null) {
            sortFailedBlockIds.add(a.id);
            sortFailedBlockIds.add(b.id);
          }
        }
      }
    }

    if (sortFailedBlockIds.size > 0) {
      const validCandidates: Array<{ block: MoodAnalysisBlock; id: string }> = [];
      for (const cand of candidateBlocks) {
        if (sortFailedBlockIds.has(cand.id)) {
          rejectedCount++;
          rejectionReasons.push(
            `Block ${cand.id} rejected because canonical CFI sort comparison against candidate blocks failed or was unavailable`,
          );
        } else {
          validCandidates.push(cand);
        }
      }
      candidateBlocks = validCandidates;
    }

    // Sort candidate blocks deterministically using canonical CFI comparison
    candidateBlocks.sort((a, b) => {
      const cmpStart = compareCanonicalCfi(a.block.startCfi, b.block.startCfi);
      if (cmpStart !== null && cmpStart !== 0) return cmpStart;
      const cmpEnd = compareCanonicalCfi(a.block.endCfi, b.block.endCfi);
      if (cmpEnd !== null && cmpEnd !== 0) return cmpEnd;
      return a.id.localeCompare(b.id);
    });

    const validProtectedRanges: ProtectedRange[] = [];
    for (let idx = 0; idx < protectedRanges.length; idx++) {
      const range = protectedRanges[idx]!;
      const check = isBlockValid(range, spinePrefix, input.chapterDocument);
      if (!check.valid) {
        rejectionReasons.push(`ProtectedRange[${idx}] ${check.reason}`);
        continue;
      }
      validProtectedRanges.push(range);
    }

    // Partition and reject overlapping blocks deterministically
    const nonOverlappingBlocks: Array<{
      block: MoodAnalysisBlock;
      id: string;
      isProtected: boolean;
    }> = [];
    let protectedExclusionsCount = 0;

    for (const cand of candidateBlocks) {
      const { block, id } = cand;

      // Check overlap with previously accepted block
      const lastAccepted = nonOverlappingBlocks.at(-1);
      if (lastAccepted) {
        const overlapCheck = rangesOverlap(
          block.startCfi,
          block.endCfi,
          lastAccepted.block.startCfi,
          lastAccepted.block.endCfi,
        );
        if (overlapCheck.overlaps || overlapCheck.comparisonFailed) {
          rejectedCount++;
          if (overlapCheck.comparisonFailed) {
            rejectionReasons.push(
              `Block ${id} rejected because canonical CFI comparison against block ${lastAccepted.id} failed or was unavailable`,
            );
          } else {
            rejectionReasons.push(
              `Block ${id} overlaps with prior accepted block ${lastAccepted.id}`,
            );
          }
          continue;
        }
      }

      // Check Protected Range intersection (conservatively treat comparison failure as protected)
      let isProt = false;
      for (const p of validProtectedRanges) {
        const protCheck = rangesOverlap(block.startCfi, block.endCfi, p.startCfi, p.endCfi);
        if (protCheck.overlaps || protCheck.comparisonFailed) {
          isProt = true;
          if (protCheck.comparisonFailed) {
            rejectionReasons.push(
              `Block ${id} conservatively excluded as protected because canonical CFI comparison against Protected Range ${p.id ?? 'unnamed'} failed or was unavailable`,
            );
          }
          break;
        }
      }

      if (isProt) {
        protectedExclusionsCount++;
      }

      nonOverlappingBlocks.push({ block, id, isProtected: isProt });
    }

    const totalBlocks = rawBlocks.length;
    const acceptedCount = nonOverlappingBlocks.length;
    const coverageRatio = totalBlocks > 0 ? roundScore(acceptedCount / totalBlocks) : 0;
    const hasFallback = acceptedCount === 0;

    const qualityReasons: string[] = [...rejectionReasons];
    let disposition: QualityDisposition = 'accepted';

    if (requestedLanguage !== 'en') {
      disposition = 'review_suggested';
      qualityReasons.push(
        `Requested language '${requestedLanguage}' is not natively supported (falling back to English heuristic)`,
      );
    }

    if (hasFallback) {
      disposition = 'rejected';
      qualityReasons.push('No valid blocks accepted for mood analysis');
      const overallScores: Record<string, number> = {};
      for (const mood of CANONICAL_MOODS) {
        overallScores[mood] = mood === fallbackMood ? 1 : 0;
      }
      const seedString = `${input.chapterId}:${spinePrefix}:${totalBlocks}:${timestamp}`;
      const draftHash = simpleStringHash(seedString);

      return {
        draftId: `draft-${input.chapterId}-${draftHash}`,
        chapterId: input.chapterId,
        spinePrefix,
        primaryMood: fallbackMood,
        overallScores,
        segments: [],
        quality: {
          totalBlocks,
          acceptedBlocks: 0,
          rejectedBlocks: rejectedCount,
          coverageRatio: 0,
          hasFallback: true,
          protectedExclusions: protectedExclusionsCount,
          disposition,
          reasons: qualityReasons,
        },
        createdAt: timestamp,
        isIsolated: true,
      };
    }

    // Score non-overlapping blocks
    let lowConfidenceCount = 0;
    const scoredBlocks = nonOverlappingBlocks.map(({ block, id, isProtected }) => {
      const scoreRes = scoreText(block.text);
      if (scoreRes.confidence < confidenceThreshold) {
        lowConfidenceCount++;
      }
      return {
        id,
        startCfi: block.startCfi,
        endCfi: block.endCfi,
        text: block.text,
        primaryMood: scoreRes.primaryMood,
        confidence: scoreRes.confidence,
        scores: scoreRes.scores,
        isProtected,
      };
    });

    if (coverageRatio <= 0.5 && totalBlocks > 1) {
      if (disposition === 'accepted') disposition = 'review_suggested';
      qualityReasons.push(`Low coverage ratio (${(coverageRatio * 100).toFixed(1)}% <= 50%)`);
    }

    if (lowConfidenceCount > 0 && lowConfidenceCount >= scoredBlocks.length / 2) {
      if (disposition === 'accepted') disposition = 'review_suggested';
      qualityReasons.push(
        `Low confidence mood classifications across ${lowConfidenceCount} block(s)`,
      );
    }

    // Aggregate overall scores
    const accumulatedScores: Record<string, number> = {};
    for (const mood of CANONICAL_MOODS) {
      accumulatedScores[mood] = 0;
    }
    for (const sb of scoredBlocks) {
      for (const mood of CANONICAL_MOODS) {
        accumulatedScores[mood] = (accumulatedScores[mood] ?? 0) + (sb.scores[mood] ?? 0);
      }
    }
    const overallScores: Record<string, number> = {};
    let topOverallMood = fallbackMood;
    let topOverallVal = -1;

    for (const mood of CANONICAL_MOODS) {
      const avg = roundScore(accumulatedScores[mood]! / scoredBlocks.length);
      overallScores[mood] = avg;
      if (avg > topOverallVal) {
        topOverallVal = avg;
        topOverallMood = mood;
      } else if (avg === topOverallVal && mood < topOverallMood) {
        topOverallMood = mood;
      }
    }

    // Group segments based on granularity & mood & protection state
    const segments: MoodSegment[] = [];

    if (granularity === 'chapter') {
      // Single overall chapter segment
      const first = scoredBlocks[0]!;
      const last = scoredBlocks.at(-1)!;
      const summary = scoredBlocks
        .map((b) => b.text)
        .join(' ')
        .slice(0, 150);
      segments.push({
        id: `seg-chapter-${input.chapterId}`,
        startCfi: first.startCfi,
        endCfi: last.endCfi,
        mood: topOverallMood,
        confidence: roundScore(
          scoredBlocks.reduce((sum, b) => sum + b.confidence, 0) / scoredBlocks.length,
        ),
        textSummary: summary,
        scores: overallScores,
        isProtected: scoredBlocks.some((b) => b.isProtected),
        blockIds: scoredBlocks.map((b) => b.id),
      });
    } else {
      // Paragraph/Scene granularity grouping
      let currentGroup: {
        blockIds: string[];
        startCfi: string;
        endCfi: string;
        mood: string;
        confidences: number[];
        scoreSums: Record<string, number>;
        isProtected: boolean;
        texts: string[];
      } | null = null;

      for (let i = 0; i < scoredBlocks.length; i++) {
        const sb = scoredBlocks[i]!;
        if (
          currentGroup &&
          currentGroup.mood === sb.primaryMood &&
          currentGroup.isProtected === sb.isProtected
        ) {
          currentGroup.blockIds.push(sb.id);
          currentGroup.endCfi = sb.endCfi;
          currentGroup.confidences.push(sb.confidence);
          currentGroup.texts.push(sb.text);
          for (const mood of CANONICAL_MOODS) {
            currentGroup.scoreSums[mood] =
              (currentGroup.scoreSums[mood] ?? 0) + (sb.scores[mood] ?? 0);
          }
        } else {
          if (currentGroup) {
            const count = currentGroup.blockIds.length;
            const avgConf = roundScore(currentGroup.confidences.reduce((a, b) => a + b, 0) / count);
            const segScores: Record<string, number> = {};
            for (const mood of CANONICAL_MOODS) {
              segScores[mood] = roundScore((currentGroup.scoreSums[mood] ?? 0) / count);
            }
            const summary = currentGroup.texts.join(' ').slice(0, 120);
            segments.push({
              id: `seg-${segments.length + 1}-${currentGroup.startCfi}`,
              startCfi: currentGroup.startCfi,
              endCfi: currentGroup.endCfi,
              mood: currentGroup.mood,
              confidence: avgConf,
              textSummary:
                summary.length < currentGroup.texts.join(' ').length ? `${summary}...` : summary,
              scores: segScores,
              isProtected: currentGroup.isProtected,
              blockIds: currentGroup.blockIds,
            });
          }

          const scoreSums: Record<string, number> = {};
          for (const mood of CANONICAL_MOODS) {
            scoreSums[mood] = sb.scores[mood] ?? 0;
          }

          currentGroup = {
            blockIds: [sb.id],
            startCfi: sb.startCfi,
            endCfi: sb.endCfi,
            mood: sb.primaryMood,
            confidences: [sb.confidence],
            scoreSums,
            isProtected: sb.isProtected,
            texts: [sb.text],
          };
        }
      }

      if (currentGroup) {
        const count = currentGroup.blockIds.length;
        const avgConf = roundScore(currentGroup.confidences.reduce((a, b) => a + b, 0) / count);
        const segScores: Record<string, number> = {};
        for (const mood of CANONICAL_MOODS) {
          segScores[mood] = roundScore((currentGroup.scoreSums[mood] ?? 0) / count);
        }
        const summary = currentGroup.texts.join(' ').slice(0, 120);
        segments.push({
          id: `seg-${segments.length + 1}-${currentGroup.startCfi}`,
          startCfi: currentGroup.startCfi,
          endCfi: currentGroup.endCfi,
          mood: currentGroup.mood,
          confidence: avgConf,
          textSummary:
            summary.length < currentGroup.texts.join(' ').length ? `${summary}...` : summary,
          scores: segScores,
          isProtected: currentGroup.isProtected,
          blockIds: currentGroup.blockIds,
        });
      }
    }

    const seedString = `${input.chapterId}:${spinePrefix}:${scoredBlocks.map((b) => b.id).join(',')}:${requestedLanguage}:${granularity}`;
    const draftHash = simpleStringHash(seedString);

    return {
      draftId: `draft-${input.chapterId}-${draftHash}`,
      chapterId: input.chapterId,
      spinePrefix,
      primaryMood: topOverallMood,
      overallScores,
      segments,
      quality: {
        totalBlocks,
        acceptedBlocks: acceptedCount,
        rejectedBlocks: rejectedCount,
        coverageRatio,
        hasFallback: false,
        protectedExclusions: protectedExclusionsCount,
        disposition,
        reasons: qualityReasons,
      },
      createdAt: timestamp,
      isIsolated: true,
    };
  }
}

export function analyzeChapterMood(input: MoodAnalysisInput): MoodAnalysisDraft {
  return ChapterMoodAnalyzer.analyze(input);
}

export function validateMoodAnalysisInput(input: MoodAnalysisInput): {
  valid: boolean;
  errors: string[];
} {
  return ChapterMoodAnalyzer.validateInput(input);
}
