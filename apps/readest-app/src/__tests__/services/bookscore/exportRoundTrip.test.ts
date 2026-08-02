/**
 * Round-trip tests for BookScore export/import.
 *
 * These tests exercise the full production export→import pipeline:
 *   1. Install a package revision (production importAndAssociateBookScorePackage)
 *   2. Export it to a portable .bookscore archive (production exportBookScorePackage)
 *   3. Import the archive into a clean profile (fresh FS, production importAndAssociateBookScorePackage)
 *   4. Find the matching EPUB candidate (computeSoundtrackCandidates)
 *   5. Explicitly attach it (associateSoundtrackToEdition)
 *   6. Verify the store can replay it (loadSoundtrackForBook → playback state)
 *
 * Local-only fields (association status, active selection, mismatch consent,
 * installedAt, local editability) must NOT travel with the export.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BaseDir, FileSystem } from '@/types/system';
import {
  importAndAssociateBookScorePackage,
  computeSoundtrackCandidates,
  associateSoundtrackToEdition,
  createDevelopmentFixturePackageBytes,
} from '@/services/bookscore/importService';
import { exportBookScorePackage } from '@/services/bookscore/exportService';
import { loadInstalledPackages, loadLocalAssociations } from '@/services/bookscore/persistence';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import { createTestFileSystem } from './testHelpers';

function makeTmpFs(): Promise<{ fs: FileSystem; dir: string; cleanup: () => Promise<void> }> {
  return fsPromises.mkdtemp(path.join(os.tmpdir(), 'bookscore-rt-')).then((dir) => ({
    fs: createTestFileSystem(dir),
    dir,
    cleanup: () => fsPromises.rm(dir, { recursive: true, force: true }),
  }));
}

const baseDir: BaseDir = 'Data';

describe('BookScore export/import round-trip', () => {
  let source: { fs: FileSystem; dir: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    source = await makeTmpFs();
  });

  afterEach(async () => {
    await source.cleanup();
    useSoundtrackStore.getState().resetSoundtrack();
  });

  it('exports and re-imports a package: manifest identity, cues, assets, and hashes are preserved', async () => {
    const editionId = 'rt-edition-preserve';
    const fixture = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-rt-preserve',
      'Round-trip preserve test',
      editionId,
    );

    // Install in source profile
    const installRes = await importAndAssociateBookScorePackage(
      source.fs,
      baseDir,
      fixture,
      editionId,
    );
    expect(installRes.success).toBe(true);
    const { packageId, manifestHash } = installRes.package!;

    // Export from source profile
    const exportRes = await exportBookScorePackage(source.fs, baseDir, packageId, manifestHash);
    expect(exportRes.success).toBe(true);
    const archiveBytes = (exportRes as { success: true; archiveBytes: Uint8Array }).archiveBytes;
    expect(archiveBytes.byteLength).toBeGreaterThan(0);

    // Import into clean profile
    const { fs: cleanFs, cleanup } = await makeTmpFs();
    try {
      const importRes = await importAndAssociateBookScorePackage(
        cleanFs,
        baseDir,
        archiveBytes,
        editionId,
      );
      expect(importRes.success).toBe(true);

      const importedPkg = importRes.package!;
      // Immutable revision identity: packageId and manifestHash survive the round-trip
      expect(importedPkg.packageId).toBe(packageId);
      expect(importedPkg.manifestHash).toBe(manifestHash);

      // Manifest content is preserved
      const { manifest } = importedPkg;
      expect(manifest.title).toBe('Round-trip preserve test');
      expect(manifest.version).toBe(1);
      expect(manifest.assets).toHaveLength(1);
      expect(manifest.assets[0]!.mimeType).toBe('audio/mpeg');

      // Ordered cues are preserved
      expect(manifest.cues).toHaveLength(1);
      expect(manifest.cues[0]!.type).toBe('audio');
      expect(manifest.cues[0]!.id).toBe('cue-opening');

      // editionCompatibility (portable lineage) travels with the export
      expect(manifest.editionCompatibility).toHaveLength(1);
      expect(manifest.editionCompatibility[0]!.digest).toBe(editionId);
    } finally {
      await cleanup();
    }
  });

  it('export strips local-only fields: association status, selection, and installedAt do not travel', async () => {
    const editionId = 'rt-edition-strip-local';
    const fixture = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-rt-strip',
      'Strip local fields',
      editionId,
    );

    // Install and attach in source profile (selection = true)
    const installRes = await importAndAssociateBookScorePackage(
      source.fs,
      baseDir,
      fixture,
      editionId,
      undefined,
      { autoAttach: true },
    );
    expect(installRes.success).toBe(true);
    expect(installRes.association?.selected).toBe(true);

    const { packageId, manifestHash, installedAt } = installRes.package!;

    // Export
    const exportRes = await exportBookScorePackage(source.fs, baseDir, packageId, manifestHash);
    expect(exportRes.success).toBe(true);
    const archiveBytes = (exportRes as { success: true; archiveBytes: Uint8Array }).archiveBytes;

    // Import into clean profile without auto-attach
    const { fs: cleanFs, cleanup } = await makeTmpFs();
    try {
      const importRes = await importAndAssociateBookScorePackage(
        cleanFs,
        baseDir,
        archiveBytes,
        editionId,
      );
      expect(importRes.success).toBe(true);

      // No association should exist in clean profile — was not requested
      expect(importRes.association).toBeUndefined();
      const cleanAssociations = await loadLocalAssociations(cleanFs, baseDir);
      expect(cleanAssociations[editionId]).toBeUndefined();

      // installedAt in clean profile is a new timestamp, not the original source value
      expect(importRes.package!.installedAt).toBeGreaterThan(0);
      // (may equal or differ — the point is the export doesn't carry it across)
      // We confirm the exported archive does not carry the source installedAt
      // by checking the manifest JSON in the archive does NOT contain installedAt
      type EntryWithGetData = { filename: string; getData: (w: unknown) => Promise<unknown> };
      const { ZipReader, Uint8ArrayReader, TextWriter } = await import('@zip.js/zip.js');
      const reader = new ZipReader(new Uint8ArrayReader(archiveBytes));
      const entries = (await reader.getEntries()) as unknown as EntryWithGetData[];
      const manifestEntry = entries.find((e) => e.filename === 'manifest.json');
      expect(manifestEntry).toBeDefined();
      const manifestText = (await manifestEntry!.getData(new TextWriter())) as string;
      const manifestJson = JSON.parse(manifestText) as Record<string, unknown>;
      expect(manifestJson['installedAt']).toBeUndefined();
      expect(manifestJson['selected']).toBeUndefined();
      expect(manifestJson['trustState']).toBeUndefined();
      expect(manifestJson['editionId']).toBeUndefined();
      await reader.close();

      void installedAt; // used only for documentation
    } finally {
      await cleanup();
    }
  });

  it('clean profile can find matching EPUB candidate and explicitly attach then replay', async () => {
    const editionId = 'rt-edition-attach-replay';
    const fixture = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-rt-attach',
      'Attach and Replay',
      editionId,
    );

    // Install in source profile (no autoAttach)
    const installRes = await importAndAssociateBookScorePackage(
      source.fs,
      baseDir,
      fixture,
      editionId,
    );
    expect(installRes.success).toBe(true);

    // Export
    const exportRes = await exportBookScorePackage(
      source.fs,
      baseDir,
      installRes.package!.packageId,
      installRes.package!.manifestHash,
    );
    expect(exportRes.success).toBe(true);
    const archiveBytes = (exportRes as { success: true; archiveBytes: Uint8Array }).archiveBytes;

    // Import into clean profile — no autoAttach
    const { fs: cleanFs, cleanup } = await makeTmpFs();
    try {
      const importRes = await importAndAssociateBookScorePackage(
        cleanFs,
        baseDir,
        archiveBytes,
        editionId,
      );
      expect(importRes.success).toBe(true);

      const cleanPackages = await loadInstalledPackages(cleanFs, baseDir);
      const cleanAssociations = await loadLocalAssociations(cleanFs, baseDir);

      // computeSoundtrackCandidates surfaces the imported package as a verified candidate
      const { candidates, activeAssociation } = computeSoundtrackCandidates(
        editionId,
        cleanPackages,
        cleanAssociations,
      );

      expect(activeAssociation).toBeNull(); // not yet attached
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.trustState).toBe('verified'); // editionCompatibility matches
      expect(candidates[0]!.isSelected).toBe(false);

      // Explicitly attach the candidate
      const { packageId, manifestHash } = importRes.package!;
      const attachRes = await associateSoundtrackToEdition(
        cleanFs,
        baseDir,
        editionId,
        packageId,
        manifestHash,
      );
      expect(attachRes.success).toBe(true);
      expect(attachRes.association?.selected).toBe(true);

      // Reload for playback
      const finalPackages = await loadInstalledPackages(cleanFs, baseDir);
      const finalAssociations = await loadLocalAssociations(cleanFs, baseDir);

      const store = useSoundtrackStore.getState();
      store.setCapabilityEnabled(true);
      store.loadSoundtrackForBook(
        editionId,
        finalPackages,
        finalAssociations,
        'epubcfi(/6/2!/4/2:0)',
      );

      const state = useSoundtrackStore.getState();
      expect(state.activePackage?.packageId).toBe(packageId);
      expect(state.selectedCue).not.toBeNull();
      expect(state.selectedCue?.type).toBe('audio');
      // Reopen-paused semantics: status is paused until user explicitly plays
      expect(state.playbackStatus).toBe('paused');
    } finally {
      await cleanup();
    }
  });

  it('explicit silence cues survive the round-trip', async () => {
    const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } = await import(
      '@zip.js/zip.js'
    );
    const { sha256Hex } = await import('@/services/bookscore/packageValidation');
    const { createMinimalValidMp3Bytes } = await import('@/services/bookscore/importService');

    const editionId = 'rt-edition-silence';
    const mp3 = createMinimalValidMp3Bytes();
    const assetHash = await sha256Hex(mp3);

    const manifestObj = {
      packageId: 'pkg-rt-silence',
      title: 'Silence Round-trip',
      version: 1,
      manifestHash: '',
      editionCompatibility: [
        {
          algorithm: 'readest-partial-md5-v1' as const,
          digest: editionId,
          epubByteLength: 1048576,
        },
      ],
      assets: [
        {
          id: 'asset-bg',
          path: 'audio/asset-bg.mp3',
          mimeType: 'audio/mpeg' as const,
          hash: assetHash,
          durationSec: 2.6,
        },
      ],
      cues: [
        {
          id: 'cue-1',
          startCfi: 'epubcfi(/6/2!/4/2:0)',
          type: 'audio' as const,
          assetId: 'asset-bg',
          startSec: 0,
          loopStartSec: 0.2,
          loopEndSec: 2.4,
          volume: 0.9,
          crossfadeSec: 0.5,
        },
        {
          id: 'cue-silence',
          startCfi: 'epubcfi(/6/4!/4/2:0)',
          type: 'silence' as const,
        },
      ],
    };

    // Compute manifestHash (strip manifestHash field before hashing)
    const encoder = new TextEncoder();
    const copy = { ...manifestObj };
    delete (copy as Partial<typeof copy>).manifestHash;
    const { sha256Hex: hash } = await import('@/services/bookscore/packageValidation');
    manifestObj.manifestHash = await hash(encoder.encode(JSON.stringify(copy)));

    const zipWriter = new ZipWriter(new Uint8ArrayWriter());
    await zipWriter.add('manifest.json', new TextReader(JSON.stringify(manifestObj)));
    await zipWriter.add('audio/asset-bg.mp3', new Uint8ArrayReader(mp3));
    const fixture = await zipWriter.close();

    const installRes = await importAndAssociateBookScorePackage(
      source.fs,
      baseDir,
      fixture,
      editionId,
    );
    expect(installRes.success).toBe(true);

    const exportRes = await exportBookScorePackage(
      source.fs,
      baseDir,
      installRes.package!.packageId,
      installRes.package!.manifestHash,
    );
    expect(exportRes.success).toBe(true);

    const { fs: cleanFs, cleanup } = await makeTmpFs();
    try {
      const importRes = await importAndAssociateBookScorePackage(
        cleanFs,
        baseDir,
        (exportRes as { success: true; archiveBytes: Uint8Array }).archiveBytes,
        editionId,
      );
      expect(importRes.success).toBe(true);

      const { cues } = importRes.package!.manifest;
      expect(cues).toHaveLength(2);
      const silenceCue = cues.find((c) => c.type === 'silence');
      expect(silenceCue).toBeDefined();
      expect(silenceCue!.id).toBe('cue-silence');
    } finally {
      await cleanup();
    }
  });

  it('returns an error when a required asset is missing from storage', async () => {
    const editionId = 'rt-edition-missing-asset';
    const fixture = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-rt-missing',
      'Missing Asset Test',
      editionId,
    );

    const installRes = await importAndAssociateBookScorePackage(
      source.fs,
      baseDir,
      fixture,
      editionId,
    );
    expect(installRes.success).toBe(true);
    const { packageId, manifestHash } = installRes.package!;

    // Corrupt storage by removing the asset file directly
    const assetPath = `soundtracks/${packageId}/${manifestHash}/asset-main.mp3`;
    await (
      source.fs as unknown as { deleteFile: (p: string, b: typeof baseDir) => Promise<void> }
    ).deleteFile(assetPath, baseDir);

    const exportRes = await exportBookScorePackage(source.fs, baseDir, packageId, manifestHash);
    expect(exportRes.success).toBe(false);
    expect((exportRes as { success: false; error: string }).error).toContain('asset-main');
  });

  it('returns an error when the package revision is not installed', async () => {
    const exportRes = await exportBookScorePackage(
      source.fs,
      baseDir,
      'pkg-nonexistent',
      'hash-nonexistent',
    );
    expect(exportRes.success).toBe(false);
    expect((exportRes as { success: false; error: string }).error).toContain('not installed');
  });
});
