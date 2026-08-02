import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } from '@zip.js/zip.js';
import { avg, type Bench, type BenchResult } from './lib.ts';
import {
  validateBookScorePackageArchive,
  sha256Hex,
} from '../src/services/bookscore/packageValidation.ts';
import type { SoundtrackCue } from '../src/services/bookscore/types.ts';

// --- Local implementation of CFI utils to avoid @/* path alias import resolution issues in Node ---

function parseCfi(cfi: string): { steps: number[]; offset: number } {
  if (!cfi) return { steps: [], offset: 0 };
  const raw = cfi.replace(/^epubcfi\((.*)\)$/, '$1');
  const parts = raw.split(':');
  const pathPart = parts[0] ?? '';
  const offsetPart = parts[1];

  const cleanPath = pathPart.replace(/\[[^\]]*\]/g, '');
  const stepStrings = cleanPath.split(/[\/!]/).filter(Boolean);
  const steps = stepStrings.map((s) => {
    const num = parseInt(s, 10);
    return isNaN(num) ? 0 : num;
  });

  const offset = offsetPart ? parseInt(offsetPart, 10) : 0;
  return { steps, offset: isNaN(offset) ? 0 : offset };
}

function compareCfi(cfiA: string, cfiB: string): number {
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

function findCueForCfi(cfi: string, cues: SoundtrackCue[]): SoundtrackCue | null {
  if (!cfi || !cues || cues.length === 0) return null;

  const sortedCues = [...cues].sort((a, b) => compareCfi(a.startCfi, b.startCfi));
  const first = sortedCues[0];

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

function createMinimalValidMp3Bytes(): Uint8Array {
  const frameHeader = [0xff, 0xfb, 0x90, 0x64];
  const frameLength = 417;
  const numFrames = 100;
  const totalLength = frameLength * numFrames;
  const bytes = new Uint8Array(totalLength);

  for (let i = 0; i < numFrames; i++) {
    const offset = i * frameLength;
    bytes.set(frameHeader, offset);
  }
  return bytes;
}

function generateRandomCfi(index: number): string {
  return `epubcfi(/6/${index * 2}!/4/2:${index * 10})`;
}

function seededShuffle<T>(array: T[], seed: number): T[] {
  const result = [...array];
  let currentSeed = seed;
  const random = () => {
    const x = Math.sin(currentSeed++) * 10000;
    return x - Math.floor(x);
  };

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

function createDummyCues(n: number): SoundtrackCue[] {
  const cues: SoundtrackCue[] = [];
  for (let i = 0; i < n; i++) {
    cues.push({
      id: `cue-${i}`,
      startCfi: generateRandomCfi(i),
      type: i % 10 === 0 ? 'silence' : 'audio',
      assetId: 'track-1',
      startSec: 0,
      loopStartSec: 0,
      loopEndSec: 2.0,
      volume: 1,
      crossfadeSec: 0.5,
    } as SoundtrackCue);
  }
  // Use a fixed seed to guarantee deterministic sorting permutations across runs
  return seededShuffle(cues, 12345);
}

export default {
  name: 'soundtrack',
  description:
    'Benchmarks for soundtrack feature: reader navigation impact, import validation, and PCM memory footprint.',

  async run(): Promise<BenchResult[]> {
    const results: BenchResult[] = [];

    // --- Part 1: Reader navigation / transition impact ---
    const navScenarios = [10, 100, 1000, 5000];
    for (const size of navScenarios) {
      const cues = createDummyCues(size);
      const searchCfi = generateRandomCfi(Math.floor(size / 2));

      const ms = await avg(
        async () => {
          findCueForCfi(searchCfi, cues);
        },
        100,
        10,
      );

      results.push({
        scenario: `nav-lookup: ${size} cues`,
        unit: 'us',
        value: ms * 1000,
        meta: { cueCount: size },
      });
    }

    // --- Part 2: Import-validation time ---
    const assetBytes = createMinimalValidMp3Bytes();
    const assetHash = await sha256Hex(assetBytes);

    const manifestObj = {
      packageId: 'bench-pkg',
      title: 'Benchmark Soundtrack Package',
      version: 1,
      manifestHash: '',
      editionCompatibility: [
        {
          algorithm: 'readest-partial-md5-v1',
          digest: 'md5digest',
          epubByteLength: 10000,
        },
      ],
      assets: [
        {
          id: 'track-1',
          path: 'audio/track1.mp3',
          mimeType: 'audio/mpeg',
          hash: assetHash,
          durationSec: 2.6, // matches decoded 100-frame MP3 duration
        },
      ],
      cues: [
        {
          id: 'cue-1',
          startCfi: 'epubcfi(/6/2!/4/2:0)',
          type: 'audio',
          assetId: 'track-1',
          startSec: 0,
          loopStartSec: 0,
          loopEndSec: 2.0,
          volume: 1,
          crossfadeSec: 0.5,
        },
      ],
    };

    const encoder = new TextEncoder();
    const manifestCopy = { ...manifestObj };
    delete (manifestCopy as Partial<typeof manifestObj>).manifestHash;
    manifestObj.manifestHash = await sha256Hex(encoder.encode(JSON.stringify(manifestCopy)));

    const zipWriter = new ZipWriter(new Uint8ArrayWriter());
    await zipWriter.add('manifest.json', new TextReader(JSON.stringify(manifestObj)));
    await zipWriter.add('audio/track1.mp3', new Uint8ArrayReader(assetBytes));
    const zipArchiveBytes = await zipWriter.close();

    // Verify package correctness using production validator before benchmarking
    const verification = await validateBookScorePackageArchive(zipArchiveBytes);
    if (!verification.valid) {
      throw new Error(`Benchmark package validation failed: ${verification.errors.join(', ')}`);
    }

    const valMs = await avg(
      async () => {
        await validateBookScorePackageArchive(zipArchiveBytes);
      },
      10,
      2,
    );

    results.push({
      scenario: 'import-validation',
      unit: 'ms',
      value: valMs,
      meta: { archiveSizeBytes: zipArchiveBytes.length },
    });

    // --- Part 3: Installed-audio memory budget (calculated PCM footprint) ---
    // Printed to console outside of BenchResult to avoid formatting in time units (us)
    const audioScenarios = [
      { name: '1m loop', durationSec: 60 },
      { name: '5m track', durationSec: 300 },
      { name: '15m album', durationSec: 900 },
      { name: '60m soundtrack', durationSec: 3600 },
    ];

    const sampleRate = 44100;
    const channels = 2;
    const bytesPerSample = 4; // 32-bit float PCM

    console.log('\n═' + '═'.repeat(68));
    console.log('  Calculated Installed-Audio PCM Memory Footprint Budgets (Web Audio)');
    console.log('  (Sample Rate: 44.1 kHz, Channels: 2, 32-bit Float PCM)');
    console.log('═' + '═'.repeat(68));
    for (const sc of audioScenarios) {
      const bytes = sc.durationSec * sampleRate * channels * bytesPerSample;
      const mib = bytes / (1024 * 1024);
      console.log(
        `  - ${sc.name.padEnd(16)}: ${mib.toFixed(2)} MiB (${bytes.toLocaleString()} bytes)`,
      );
    }
    console.log('═' + '═'.repeat(68));

    return results;
  },
} satisfies Bench;
