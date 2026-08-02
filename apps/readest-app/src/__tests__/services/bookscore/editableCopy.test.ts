/**
 * editableCopy.test.ts – issue #18
 *
 * Tests for:
 *  1. Copy lineage:  makeEditableCopy captures source reference and all asset bytes
 *  2. CFI capture through location seam: current CFI is used as the cue anchor
 *  3. Cue order / silence:  addCueAtCfi keeps canonical CFI order; silence cues work
 *  4. Preview:  resolvePreviewAsset returns audio data starting at cue.startSec
 *  5. Validation:  validateEditableCopy reports actionable issues; only errors block export
 *  6. Export descendant compatibility:  exported archive re-imports via the #17 pipeline
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BaseDir, FileSystem } from '@/types/system';
import {
  makeEditableCopy,
  addCueAtCfi,
  editCue,
  removeCue,
  reorderCue,
  updateCopyTitle,
  validateEditableCopy,
  exportEditableCopy,
  resolvePreviewAsset,
  saveEditableCopy,
  loadEditableCopy,
} from '@/services/bookscore/authoringService';
import {
  createDevelopmentFixturePackageBytes,
  createMinimalValidMp3Bytes,
  importAndAssociateBookScorePackage,
} from '@/services/bookscore/importService';
import { loadInstalledPackages, loadLocalAssociations } from '@/services/bookscore/persistence';
import { importAndAssociateBookScorePackage as reimport } from '@/services/bookscore/importService';
import { AudioCue, EditableCopy, SilenceCue, SoundtrackCue } from '@/services/bookscore/types';

import { createTestFileSystem } from './testHelpers';

// ── helpers ──────────────────────────────────────────────────────────────────

async function makeTmpFs(): Promise<{ fs: FileSystem; dir: string; cleanup: () => Promise<void> }> {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'bookscore-editable-copy-'));
  const fs = createTestFileSystem(dir);
  return {
    fs,
    dir,
    cleanup: () => fsPromises.rm(dir, { recursive: true, force: true }),
  };
}

const BASE_DIR: BaseDir = 'Data';
const EDITION_ID = 'test-edition-authoring-18';

/** Installs a fixture package and returns { packageId, manifestHash }. */
async function installFixture(
  fs: FileSystem,
  editionId = EDITION_ID,
): Promise<{ packageId: string; manifestHash: string }> {
  const mp3 = createMinimalValidMp3Bytes();
  const zip = await createDevelopmentFixturePackageBytes(
    mp3,
    'pkg-author-18',
    'Author Test',
    editionId,
  );
  const res = await importAndAssociateBookScorePackage(fs, BASE_DIR, zip, editionId, undefined, {
    autoAttach: true,
  });
  if (!res.success || !res.package) throw new Error('Fixture install failed: ' + res.error);
  return { packageId: res.package.packageId, manifestHash: res.package.manifestHash };
}

// ── 1. Copy lineage ──────────────────────────────────────────────────────────

describe('makeEditableCopy – copy lineage', () => {
  let ctx: Awaited<ReturnType<typeof makeTmpFs>>;
  beforeEach(async () => {
    ctx = await makeTmpFs();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it('returns error when source package is not installed', async () => {
    const res = await makeEditableCopy(ctx.fs, BASE_DIR, 'pkg-nonexistent', 'hash-x', EDITION_ID);
    expect(res.success).toBe(false);
    expect((res as { success: false; error: string }).error).toMatch(/not installed/i);
  });

  it('creates a self-contained copy with source references and embedded asset bytes', async () => {
    const { packageId, manifestHash } = await installFixture(ctx.fs);
    const res = await makeEditableCopy(ctx.fs, BASE_DIR, packageId, manifestHash, EDITION_ID);

    expect(res.success).toBe(true);
    const copy = (res as { success: true; copy: EditableCopy }).copy;

    // Lineage fields preserved
    expect(copy.sourcePackageId).toBe(packageId);
    expect(copy.sourceManifestHash).toBe(manifestHash);
    expect(copy.editionId).toBe(EDITION_ID);

    // The copy gets a fresh packageId (not the source's)
    expect(copy.manifest.packageId).not.toBe(packageId);
    expect(copy.copyId).toBe(copy.manifest.packageId);

    // At least one asset with bytes
    const assetIds = Object.keys(copy.assetBytes);
    expect(assetIds.length).toBeGreaterThan(0);
    for (const id of assetIds) {
      expect(copy.assetBytes[id]!.byteLength).toBeGreaterThan(0);
    }
  });

  it('is self-contained after source asset files are removed', async () => {
    const { packageId, manifestHash } = await installFixture(ctx.fs);
    const res = await makeEditableCopy(ctx.fs, BASE_DIR, packageId, manifestHash, EDITION_ID);
    expect(res.success).toBe(true);
    const copy = (res as { success: true; copy: EditableCopy }).copy;

    // Delete source asset file from disk
    const assetPath = `soundtracks/${packageId}/${manifestHash}/asset-main.mp3`;
    await (
      ctx.fs as unknown as { deleteFile: (p: string, b: BaseDir) => Promise<void> }
    ).deleteFile(assetPath, BASE_DIR);

    // The copy's embedded bytes are independent
    const bytes = copy.assetBytes['asset-main'];
    expect(bytes).toBeDefined();
    expect(bytes!.byteLength).toBeGreaterThan(0);
  });
});

// ── 2. CFI capture through location seam ─────────────────────────────────────

describe('addCueAtCfi – CFI capture', () => {
  let ctx: Awaited<ReturnType<typeof makeTmpFs>>;
  let copy: EditableCopy;

  beforeEach(async () => {
    ctx = await makeTmpFs();
    const { packageId, manifestHash } = await installFixture(ctx.fs);
    const res = await makeEditableCopy(ctx.fs, BASE_DIR, packageId, manifestHash, EDITION_ID);
    expect(res.success).toBe(true);
    copy = (res as { success: true; copy: EditableCopy }).copy;
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it('anchors a new silence cue to the supplied CFI', () => {
    const cfi = 'epubcfi(/6/10!/4/12:0)';
    const newCue: SilenceCue = { id: 'test-silence', startCfi: cfi, type: 'silence' };
    const updated = addCueAtCfi(copy, newCue);

    const found = updated.manifest.cues.find((c) => c.id === 'test-silence');
    expect(found).toBeDefined();
    expect(found!.startCfi).toBe(cfi);
  });

  it('preserves canonical CFI order after adding a cue with an earlier CFI', () => {
    // Fixture cue starts at epubcfi(/6/2!/4/2:0) — add something earlier
    const earlyNewCue: SilenceCue = {
      id: 'early-cue',
      startCfi: 'epubcfi(/6/1!/4/2:0)',
      type: 'silence',
    };
    const updated = addCueAtCfi(copy, earlyNewCue);

    // 'early-cue' must come first because its CFI sorts before /6/2
    expect(updated.manifest.cues[0]!.id).toBe('early-cue');
  });

  it('places a cue added with the current CFI after an existing cue with earlier CFI', () => {
    const lateCue: SilenceCue = {
      id: 'late-cue',
      startCfi: 'epubcfi(/6/100!/4/2:0)',
      type: 'silence',
    };
    const updated = addCueAtCfi(copy, lateCue);
    const last = updated.manifest.cues[updated.manifest.cues.length - 1];
    expect(last!.id).toBe('late-cue');
  });
});

// ── 3. Cue order / silence ───────────────────────────────────────────────────

describe('cue CRUD – order and silence cues', () => {
  let copy: EditableCopy;

  beforeEach(async () => {
    // Build a copy directly without FS install for pure mutation testing
    const mp3 = createMinimalValidMp3Bytes();
    const assetHash = 'dummy-hash';
    copy = {
      copyId: 'test-copy',
      sourcePackageId: 'source-pkg',
      sourceManifestHash: 'source-hash',
      editionId: 'ed-test',
      manifest: {
        packageId: 'test-copy',
        title: 'Test Copy',
        version: 1,
        manifestHash: '',
        editionCompatibility: [],
        assets: [
          {
            id: 'asset-main',
            path: 'audio/main.mp3',
            mimeType: 'audio/mpeg',
            hash: assetHash,
            durationSec: 2.6,
          },
        ],
        cues: [
          {
            id: 'cue-a',
            startCfi: 'epubcfi(/6/2!/4/2:0)',
            type: 'audio',
            assetId: 'asset-main',
            startSec: 0,
            loopStartSec: 0.2,
            loopEndSec: 2.4,
            volume: 0.9,
            crossfadeSec: 0.5,
          } as AudioCue,
        ],
      },
      assetBytes: { 'asset-main': mp3 },
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };
  });

  it('addCueAtCfi inserts a silence cue and re-sorts by CFI', () => {
    const silenceCue: SilenceCue = {
      id: 'cue-silence',
      startCfi: 'epubcfi(/6/8!/4/2:0)',
      type: 'silence',
    };
    const updated = addCueAtCfi(copy, silenceCue);
    expect(updated.manifest.cues).toHaveLength(2);
    // cue-a is CFI /6/2, silence is /6/8 — cue-a must be first
    expect(updated.manifest.cues[0]!.id).toBe('cue-a');
    expect(updated.manifest.cues[1]!.id).toBe('cue-silence');
    expect(updated.modifiedAt).toBeGreaterThanOrEqual(copy.modifiedAt);
  });

  it('editCue replaces an existing cue by id', () => {
    const changed: AudioCue = {
      ...(copy.manifest.cues[0] as AudioCue),
      volume: 0.5,
    };
    const updated = editCue(copy, changed);
    const found = updated.manifest.cues.find((c) => c.id === 'cue-a') as AudioCue | undefined;
    expect(found?.volume).toBe(0.5);
  });

  it('removeCue removes the target cue by id', () => {
    const updated = removeCue(copy, 'cue-a');
    expect(updated.manifest.cues).toHaveLength(0);
  });

  it('reorderCue moves a cue to the target index then re-sorts by CFI', () => {
    // Add a second cue with a later CFI so order matters
    const extra: SilenceCue = {
      id: 'cue-z',
      startCfi: 'epubcfi(/6/100!/4/2:0)',
      type: 'silence',
    };
    let updated = addCueAtCfi(copy, extra);
    expect(updated.manifest.cues.map((c) => c.id)).toEqual(['cue-a', 'cue-z']);

    // Move cue-z to index 0 — after re-sort by CFI it should return to index 1
    // because its CFI is still after cue-a's
    updated = reorderCue(updated, 'cue-z', 0);
    // After reorder + sort by CFI, cue-a must precede cue-z
    const ids = updated.manifest.cues.map((c) => c.id);
    expect(ids.indexOf('cue-a')).toBeLessThan(ids.indexOf('cue-z'));
  });

  it('updateCopyTitle changes the manifest title', () => {
    const updated = updateCopyTitle(copy, 'New Title');
    expect(updated.manifest.title).toBe('New Title');
  });
});

// ── 4. Preview ───────────────────────────────────────────────────────────────

describe('resolvePreviewAsset – preview', () => {
  let copy: EditableCopy;
  const mp3 = createMinimalValidMp3Bytes();

  beforeEach(() => {
    const audioCue: AudioCue = {
      id: 'cue-preview',
      startCfi: 'epubcfi(/6/2!/4/2:0)',
      type: 'audio',
      assetId: 'asset-main',
      startSec: 0.7, // non-zero configured start
      loopStartSec: 0.2,
      loopEndSec: 2.4,
      volume: 0.9,
      crossfadeSec: 0.5,
    };
    copy = {
      copyId: 'test-copy-preview',
      sourcePackageId: 'src',
      sourceManifestHash: 'src-hash',
      editionId: 'ed-preview',
      manifest: {
        packageId: 'test-copy-preview',
        title: 'Preview Test',
        version: 1,
        manifestHash: '',
        editionCompatibility: [],
        assets: [
          {
            id: 'asset-main',
            path: 'audio/main.mp3',
            mimeType: 'audio/mpeg',
            hash: 'h',
            durationSec: 2.6,
          },
        ],
        cues: [audioCue],
      },
      assetBytes: { 'asset-main': mp3 },
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };
  });

  it('resolves audio data from embedded bytes for an audio cue', () => {
    const cue = copy.manifest.cues[0] as AudioCue;
    const result = resolvePreviewAsset(copy, cue);
    expect(result).not.toBeNull();
    expect(result!.audioData.byteLength).toBe(mp3.byteLength);
    // cue is returned unchanged so caller can pass startSec to player
    expect(result!.cue.startSec).toBe(0.7);
  });

  it('returns null for a silence cue', () => {
    const silenceCue: SilenceCue = {
      id: 'silence',
      startCfi: 'epubcfi(/6/2!/4/2:0)',
      type: 'silence',
    };
    const result = resolvePreviewAsset(copy, silenceCue);
    expect(result).toBeNull();
  });

  it('returns null when asset bytes are missing', () => {
    const copy2 = { ...copy, assetBytes: {} };
    const cue = copy.manifest.cues[0]!;
    const result = resolvePreviewAsset(copy2, cue);
    expect(result).toBeNull();
  });
});

// ── 5. Validation ─────────────────────────────────────────────────────────────

describe('validateEditableCopy – validation', () => {
  const mp3 = createMinimalValidMp3Bytes();

  function baseCopy(): EditableCopy {
    const audioCue: AudioCue = {
      id: 'cue-ok',
      startCfi: 'epubcfi(/6/2!/4/2:0)',
      type: 'audio',
      assetId: 'asset-main',
      startSec: 0,
      loopStartSec: 0.2,
      loopEndSec: 2.4,
      volume: 0.9,
      crossfadeSec: 0.5,
    };
    return {
      copyId: 'copy-valid',
      sourcePackageId: 'src',
      sourceManifestHash: 'src-hash',
      editionId: 'ed-valid',
      manifest: {
        packageId: 'copy-valid',
        title: 'Valid Copy',
        version: 1,
        manifestHash: '',
        editionCompatibility: [],
        assets: [
          {
            id: 'asset-main',
            path: 'audio/main.mp3',
            mimeType: 'audio/mpeg',
            hash: 'h',
            durationSec: 2.6,
          },
        ],
        cues: [audioCue],
      },
      assetBytes: { 'asset-main': mp3 },
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };
  }

  it('passes validation for a well-formed copy', () => {
    const result = validateEditableCopy(baseCopy());
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('reports error when there are no cues', () => {
    const copy = { ...baseCopy(), manifest: { ...baseCopy().manifest, cues: [] } };
    const result = validateEditableCopy(copy);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('reports error when a cue references an undeclared asset', () => {
    const copy = baseCopy();
    const badCue: AudioCue = {
      id: 'cue-bad',
      startCfi: 'epubcfi(/6/4!/4/2:0)',
      type: 'audio',
      assetId: 'asset-nonexistent',
      startSec: 0,
      loopStartSec: 0,
      loopEndSec: 2,
      volume: 0.9,
      crossfadeSec: 0.5,
    };
    copy.manifest.cues.push(badCue);
    const result = validateEditableCopy(copy);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.cueId === 'cue-bad');
    expect(issue?.severity).toBe('error');
  });

  it('reports error when audio cue has zero-length loop', () => {
    const copy = baseCopy();
    (copy.manifest.cues[0] as AudioCue).loopEndSec = 0.2; // equals loopStartSec
    const result = validateEditableCopy(copy);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.cueId === 'cue-ok')).toBe(true);
  });

  it('reports error when volume is out of range', () => {
    const copy = baseCopy();
    (copy.manifest.cues[0] as AudioCue).volume = 1.5;
    const result = validateEditableCopy(copy);
    expect(result.valid).toBe(false);
  });

  it('reports warning for orphaned declared assets (not an error – does not block export)', () => {
    const copy = baseCopy();
    // Remove asset bytes to simulate an orphaned asset (cue still references it via assetId)
    // Instead: remove the cue ref and keep the asset declared
    copy.manifest.cues = [];
    // Add back the required-cue-count cue to pass that check, using a different asset
    const silenceCue: SilenceCue = {
      id: 'sil',
      startCfi: 'epubcfi(/6/2!/4/2:0)',
      type: 'silence',
    };
    copy.manifest.cues.push(silenceCue);

    // Now asset-main is declared but not referenced by any cue → orphan warning
    const result = validateEditableCopy(copy);
    const orphanWarning = result.issues.find(
      (i) => i.severity === 'warning' && i.assetId === 'asset-main',
    );
    expect(orphanWarning).toBeDefined();
    // Should still be valid (no errors) because silence cue is valid and no audio-cue errors
    // Note: asset with bytes but not referenced → warning only, not error
    expect(result.valid).toBe(true);
  });

  it('warns on duplicate startCfi values', () => {
    const copy = baseCopy();
    const dup: SilenceCue = {
      id: 'dup-cue',
      startCfi: copy.manifest.cues[0]!.startCfi, // same CFI
      type: 'silence',
    };
    copy.manifest.cues.push(dup);
    const result = validateEditableCopy(copy);
    const dupeWarning = result.issues.find(
      (i) => i.severity === 'warning' && i.cueId === 'dup-cue',
    );
    expect(dupeWarning).toBeDefined();
  });
});

// ── 6. Export descendant compatibility with #17 contract ─────────────────────

describe('exportEditableCopy – #17 export/import contract', () => {
  let ctx: Awaited<ReturnType<typeof makeTmpFs>>;

  beforeEach(async () => {
    ctx = await makeTmpFs();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it('returns error when validation fails (has blocking issues)', async () => {
    const mp3 = createMinimalValidMp3Bytes();
    const emptyCopy: EditableCopy = {
      copyId: 'copy-no-cues',
      sourcePackageId: 'src',
      sourceManifestHash: 'src-hash',
      editionId: 'ed-test',
      manifest: {
        packageId: 'copy-no-cues',
        title: 'No Cues Copy',
        version: 1,
        manifestHash: '',
        editionCompatibility: [],
        assets: [],
        cues: [],
      },
      assetBytes: {},
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };
    const result = await exportEditableCopy(emptyCopy);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/valid/i);
  });

  it('exports a valid copy and the archive re-imports successfully via #17 pipeline', async () => {
    const { packageId, manifestHash } = await installFixture(ctx.fs);
    const copyRes = await makeEditableCopy(ctx.fs, BASE_DIR, packageId, manifestHash, EDITION_ID);
    expect(copyRes.success).toBe(true);
    const copy = (copyRes as { success: true; copy: EditableCopy }).copy;

    // Export
    const exportRes = await exportEditableCopy(copy);
    expect(exportRes.success).toBe(true);
    const { archiveBytes } = exportRes as { success: true; archiveBytes: Uint8Array };
    expect(archiveBytes.byteLength).toBeGreaterThan(100);

    // Re-import the exported archive into a fresh filesystem (clean profile)
    const { fs: cleanFs, cleanup } = await makeTmpFs();
    try {
      const importRes = await reimport(cleanFs, BASE_DIR, archiveBytes, EDITION_ID);
      expect(importRes.success).toBe(true);
      expect(importRes.package).toBeDefined();

      // Package has same title and cues
      expect(importRes.package!.manifest.title).toBe(copy.manifest.title);
      expect(importRes.package!.manifest.cues).toHaveLength(copy.manifest.cues.length);

      // copyId / sourcePackageId do NOT travel (local-only fields)
      const pkgs = await loadInstalledPackages(cleanFs, BASE_DIR);
      const imported = Object.values(pkgs)[0];
      expect(imported).toBeDefined();
      // The manifest has a packageId (the copy's), not the original source packageId
      expect(imported!.packageId).toBe(importRes.package!.packageId);
    } finally {
      await cleanup();
    }
  });

  it('exported archive includes audio bytes that survive the binary-exact storage check', async () => {
    const { packageId, manifestHash } = await installFixture(ctx.fs);
    const copyRes = await makeEditableCopy(ctx.fs, BASE_DIR, packageId, manifestHash, EDITION_ID);
    expect(copyRes.success).toBe(true);
    const copy = (copyRes as { success: true; copy: EditableCopy }).copy;

    const exportRes = await exportEditableCopy(copy);
    expect(exportRes.success).toBe(true);
    const { archiveBytes } = exportRes as { success: true; archiveBytes: Uint8Array };

    // Import and verify asset is loadable
    const { verifySoundtrackAsset } = await import('@/services/bookscore/assetStorage');
    const { fs: cleanFs, cleanup } = await makeTmpFs();
    try {
      const importRes = await reimport(cleanFs, BASE_DIR, archiveBytes, EDITION_ID);
      expect(importRes.success).toBe(true);
      const pkg = importRes.package!;

      // Asset passes hash verification in clean storage
      const asset = pkg.manifest.assets[0]!;
      const verifyRes = await verifySoundtrackAsset(
        cleanFs,
        BASE_DIR,
        pkg.packageId,
        asset.id,
        pkg.manifestHash,
        asset.hash,
      );
      expect(verifyRes.ok).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

// ── 7. Persistence: saveEditableCopy / loadEditableCopy ──────────────────────

describe('saveEditableCopy / loadEditableCopy – persistence', () => {
  let ctx: Awaited<ReturnType<typeof makeTmpFs>>;

  beforeEach(async () => {
    ctx = await makeTmpFs();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it('persists and reloads an editable copy round-trip with all asset bytes intact', async () => {
    const { packageId, manifestHash } = await installFixture(ctx.fs);
    const res = await makeEditableCopy(ctx.fs, BASE_DIR, packageId, manifestHash, EDITION_ID);
    expect(res.success).toBe(true);
    const original = (res as { success: true; copy: EditableCopy }).copy;

    await saveEditableCopy(ctx.fs, BASE_DIR, original);

    const loaded = await loadEditableCopy(ctx.fs, BASE_DIR, original.copyId);
    expect(loaded).not.toBeNull();
    expect(loaded!.copyId).toBe(original.copyId);
    expect(loaded!.manifest.title).toBe(original.manifest.title);
    expect(Object.keys(loaded!.assetBytes)).toEqual(Object.keys(original.assetBytes));

    // Bytes must be preserved exactly
    for (const id of Object.keys(original.assetBytes)) {
      expect(loaded!.assetBytes[id]!.byteLength).toBe(original.assetBytes[id]!.byteLength);
    }
  });

  it('returns null when the copyId is not in storage', async () => {
    const result = await loadEditableCopy(ctx.fs, BASE_DIR, 'nonexistent-copy-id');
    expect(result).toBeNull();
  });
});
