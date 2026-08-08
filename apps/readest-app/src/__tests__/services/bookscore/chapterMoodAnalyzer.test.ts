import { describe, expect, it } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import {
  ChapterMoodAnalyzer,
  MoodAnalysisInput,
  analyzeChapterMood,
  validateMoodAnalysisInput,
} from '@/services/bookscore/chapterMoodAnalyzer';

describe('ChapterMoodAnalyzer Milestone 1 & 2 Requirements (#53)', () => {
  const chapterId = 'chap-1-intro';
  const spinePrefix = '/6/4';
  const chapterDocument = new DOMParser().parseFromString(
    `<body><p id="a^,b">${'Readable chapter text. '.repeat(20)}</p><p>${'Second readable paragraph. '.repeat(20)}</p><p cfi-inert>${'Injected text. '.repeat(20)}</p></body>`,
    'text/html',
  );
  const pointCfi = (elementId: string, offset: number): string => {
    const text = chapterDocument.getElementById(elementId)?.firstChild;
    if (!text) throw new Error(`Missing text node for ${elementId}`);
    const range = chapterDocument.createRange();
    range.setStart(text, offset);
    range.collapse(true);
    const inner = CFI.fromRange(range);
    return `epubcfi(${spinePrefix}!${inner.slice('epubcfi('.length, -1)})`;
  };

  describe('Milestone 1: Canonical CFI Safety, Provenance & Overlap Partitioning', () => {
    it('accepts valid CFI ranges within the chapter spine using canonical CFI.compare', () => {
      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'b1',
            text: 'The shadows crept silently across the dark hallway as danger neared.',
            startCfi: 'epubcfi(/6/4!/4/2/1:0)',
            endCfi: 'epubcfi(/6/4!/4/2/1:68)',
          },
        ],
      };

      const validation = validateMoodAnalysisInput(input);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      expect(ChapterMoodAnalyzer.extractSpinePrefix('epubcfi(/6/4!/4/2/1:0)')).toBe('/6/4');

      const draft = ChapterMoodAnalyzer.analyze(input);
      expect(draft.quality.acceptedBlocks).toBe(1);
      expect(draft.quality.rejectedBlocks).toBe(0);
      expect(draft.quality.hasFallback).toBe(false);
      expect(draft.spinePrefix).toBe(spinePrefix);
      expect(draft.quality.disposition).toBe('accepted');
    });

    it('rejects malformed, empty-path, and unparseable CFIs', () => {
      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'malformed-1',
            text: 'Test content',
            startCfi: 'epubcfi(/6/24!/4,,/20/1:58)',
            endCfi: 'epubcfi(/6/4!/4/2/1:50)',
          },
          {
            id: 'invalid-2',
            text: 'Another content',
            startCfi: 'not-a-cfi',
            endCfi: 'epubcfi(/6/4!/4/2/1:50)',
          },
        ],
      };

      const validation = validateMoodAnalysisInput(input);
      expect(validation.valid).toBe(false);

      const draft = analyzeChapterMood(input);
      expect(draft.quality.totalBlocks).toBe(2);
      expect(draft.quality.acceptedBlocks).toBe(0);
      expect(draft.quality.rejectedBlocks).toBe(2);
      expect(draft.quality.hasFallback).toBe(true);
      expect(draft.quality.disposition).toBe('rejected');
    });

    it('only admits escaped CFIs that round-trip to readable chapter DOM content', () => {
      const startCfi = pointCfi('a^,b', 2);
      const endCfi = pointCfi('a^,b', 30);
      expect(startCfi).toContain('^');

      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'escaped-roundtrip',
            text: 'Readable chapter text with an escaped assertion anchor.',
            startCfi,
            endCfi,
          },
        ],
      });

      expect(draft.quality.acceptedBlocks).toBe(1);
    });

    it('rejects unresolved and cfi-inert anchors before segmentation', () => {
      const inertText = chapterDocument.querySelector('[cfi-inert]')?.firstChild;
      if (!inertText) throw new Error('Missing inert test text');
      const inertRange = chapterDocument.createRange();
      inertRange.setStart(inertText, 1);
      inertRange.collapse(true);
      const inertInner = CFI.fromRange(inertRange);
      const inertCfi = `epubcfi(${spinePrefix}!${inertInner.slice('epubcfi('.length, -1)})`;

      const draft = analyzeChapterMood({
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'unresolved',
            text: 'No chapter node exists at this CFI.',
            startCfi: 'epubcfi(/6/4!/999/1:0)',
            endCfi: pointCfi('a^,b', 20),
          },
          {
            id: 'inert',
            text: 'Injected content is never readable input.',
            startCfi: inertCfi,
            endCfi: inertCfi,
          },
        ],
      });

      expect(draft.quality.acceptedBlocks).toBe(0);
      expect(draft.quality.rejectedBlocks).toBe(2);
    });

    it('rejects backwards CFI ranges (startCfi > endCfi)', () => {
      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'backwards-range',
            text: 'Reverse path content',
            startCfi: 'epubcfi(/6/4!/4/2/1:100)',
            endCfi: 'epubcfi(/6/4!/4/2/1:20)',
          },
        ],
      };

      const draft = analyzeChapterMood(input);
      expect(draft.quality.acceptedBlocks).toBe(0);
      expect(draft.quality.rejectedBlocks).toBe(1);
      expect(draft.quality.hasFallback).toBe(true);
    });

    it('rejects cross-spine CFI blocks and anchor provenance mismatches', () => {
      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix: '/6/4',
        chapterDocument,
        blocks: [
          {
            id: 'cross-spine',
            text: 'Different chapter content',
            startCfi: 'epubcfi(/6/8!/4/2/1:0)',
            endCfi: 'epubcfi(/6/8!/4/2/1:50)',
          },
          {
            id: 'provenance-mismatch',
            text: 'Mismatched start and end spine',
            startCfi: 'epubcfi(/6/4!/4/2/1:0)',
            endCfi: 'epubcfi(/6/6!/4/2/1:50)',
          },
        ],
      };

      const draft = analyzeChapterMood(input);
      expect(draft.quality.acceptedBlocks).toBe(0);
      expect(draft.quality.rejectedBlocks).toBe(2);
    });

    it('rejects overlapping blocks deterministically to preserve non-overlapping invariants', () => {
      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'b1',
            text: 'A dangerous shadow crept closer.',
            startCfi: 'epubcfi(/6/4!/4/2/1:0)',
            endCfi: 'epubcfi(/6/4!/4/2/1:50)',
          },
          {
            id: 'b2-overlapping',
            text: 'The sudden threat brought fear.',
            startCfi: 'epubcfi(/6/4!/4/2/1:20)', // Overlaps with b1 (0..50)
            endCfi: 'epubcfi(/6/4!/4/2/1:60)',
          },
        ],
      };

      const draft = analyzeChapterMood(input);
      expect(draft.quality.totalBlocks).toBe(2);
      expect(draft.quality.acceptedBlocks).toBe(1);
      expect(draft.quality.rejectedBlocks).toBe(1);
      expect(draft.segments).toHaveLength(1);
      expect(draft.segments[0]!.blockIds).toEqual(['b1']);
    });

    it('excludes Protected Range intersections from replaceable proposals', () => {
      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'unprotected-1',
            text: 'A dangerous shadow crept closer.',
            startCfi: 'epubcfi(/6/4!/4/2/1:0)',
            endCfi: 'epubcfi(/6/4!/4/2/1:30)',
          },
          {
            id: 'protected-1',
            text: 'The user pinned soundtrack cue plays here.',
            startCfi: 'epubcfi(/6/4!/4/4/1:0)',
            endCfi: 'epubcfi(/6/4!/4/4/1:40)',
          },
        ],
        protectedRanges: [
          {
            id: 'pinned-cue-1',
            startCfi: 'epubcfi(/6/4!/4/4/1:0)',
            endCfi: 'epubcfi(/6/4!/4/4/1:40)',
            reason: 'User pinned soundtrack cue',
          },
        ],
      };

      const draft = analyzeChapterMood(input);
      expect(draft.quality.protectedExclusions).toBe(1);

      const replaceableSegs = draft.segments.filter((s) => !s.isProtected);
      const protectedSegs = draft.segments.filter((s) => s.isProtected);

      expect(replaceableSegs).toHaveLength(1);
      expect(protectedSegs).toHaveLength(1);
      expect(protectedSegs[0]!.blockIds).toEqual(['protected-1']);
    });

    it('discards malformed, cross-spine, and backwards Protected Ranges before comparisons', () => {
      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'readable',
            text: 'A dangerous shadow crept closer.',
            startCfi: pointCfi('a^,b', 0),
            endCfi: pointCfi('a^,b', 20),
          },
        ],
        protectedRanges: [
          { startCfi: 'epubcfi(/6/4!/4,,/20/1:58)', endCfi: pointCfi('a^,b', 10) },
          { startCfi: pointCfi('a^,b', 1), endCfi: 'epubcfi(/6/8!/4/2/1:2)' },
          { startCfi: pointCfi('a^,b', 15), endCfi: pointCfi('a^,b', 5) },
        ],
      };
      expect(validateMoodAnalysisInput(input).valid).toBe(false);

      const draft = analyzeChapterMood(input);

      expect(draft.quality.acceptedBlocks).toBe(1);
      expect(draft.quality.protectedExclusions).toBe(0);
      expect(draft.segments[0]?.isProtected).toBe(false);
      expect(draft.quality.reasons.filter((reason) => reason.startsWith('ProtectedRange')).length).toBe(3);
    });
  });

  describe('Milestone 2: Quality Disposition, Contract Options & Full Determinism', () => {
    it('sets review_suggested disposition for sparse coverage or low confidence', () => {
      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'valid-1',
            text: 'The breeze blew.',
            startCfi: 'epubcfi(/6/4!/4/2/1:0)',
            endCfi: 'epubcfi(/6/4!/4/2/1:30)',
          },
          {
            id: 'invalid-1',
            text: 'Bad block',
            startCfi: 'epubcfi(/6/24!/4,,/20/1:58)',
            endCfi: 'epubcfi(/6/4!/4/2/1:30)',
          },
        ],
      };

      const draft = analyzeChapterMood(input);
      expect(draft.quality.coverageRatio).toBe(0.5);
      expect(draft.quality.disposition).toBe('review_suggested');
      expect(draft.quality.reasons.some((r) => r.includes('coverage ratio'))).toBe(true);
    });

    it('flags review_suggested disposition when an unsupported language is requested', () => {
      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'b1',
            text: 'The peaceful breeze blew gently.',
            startCfi: 'epubcfi(/6/4!/4/2/1:0)',
            endCfi: 'epubcfi(/6/4!/4/2/1:30)',
          },
        ],
        options: { language: 'fr' },
      };

      const draft = analyzeChapterMood(input);
      expect(draft.quality.disposition).toBe('review_suggested');
      expect(draft.quality.reasons.some((r) => r.includes("language 'fr'"))).toBe(true);
    });

    it('respects granularity chapter option to produce a single aggregated segment', () => {
      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'b1',
            text: 'A dangerous shadow crept closer with a threat.',
            startCfi: 'epubcfi(/6/4!/4/2/1:0)',
            endCfi: 'epubcfi(/6/4!/4/2/1:30)',
          },
          {
            id: 'b2',
            text: 'The vast magical stars shone in wonder.',
            startCfi: 'epubcfi(/6/4!/4/4/1:0)',
            endCfi: 'epubcfi(/6/4!/4/4/1:40)',
          },
        ],
        options: { granularity: 'chapter' },
      };

      const draft = analyzeChapterMood(input);
      expect(draft.segments).toHaveLength(1);
      expect(draft.segments[0]!.id).toBe(`seg-chapter-${chapterId}`);
      expect(draft.segments[0]!.blockIds).toEqual(['b1', 'b2']);
    });

    it('produces 100% byte-for-byte identical output JSON across repeated runs', () => {
      const input: MoodAnalysisInput = {
        chapterId,
        spinePrefix,
        chapterDocument,
        blocks: [
          {
            id: 'b1',
            text: 'A dangerous shadow crept with a sudden threat of alarm.',
            startCfi: 'epubcfi(/6/4!/4/2/1:0)',
            endCfi: 'epubcfi(/6/4!/4/2/1:50)',
          },
          {
            id: 'b2',
            text: 'The vast magical stars shone with dazzling brilliance in the sky.',
            startCfi: 'epubcfi(/6/4!/4/4/1:0)',
            endCfi: 'epubcfi(/6/4!/4/4/1:60)',
          },
        ],
        options: {
          timestamp: 1700000000000,
          granularity: 'paragraph',
          language: 'en',
        },
      };

      const run1 = analyzeChapterMood(input);
      const run2 = analyzeChapterMood(input);

      expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
    });
  });
});
