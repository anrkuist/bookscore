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
 * installedAt, local editability/trustState) must NOT travel with the export.
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

/** Build a two-asset, three-cue fixture ZIP (audio, silence, audio) for ordering tests. */
async function buildMultiCueFixtureBytes(
  editionId: string,
  packageId: string,
): Promise<Uint8Array> {
  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } = await import(
    '@zip.js/zip.js'
  );
  const { sha256Hex } = await import('@/services/bookscore/packageValidation');
  const { createMinimalValidMp3Bytes } = await import('@/services/bookscore/importService');

  const mp3A = createMinimalValidMp3Bytes();
  // Make a distinct second audio asset (different bytes, still valid MP3 frame structure)
  const mp3B = new Uint8Array([...createMinimalValidMp3Bytes(), 0xff, 0xfb, 0x90, 0x64]);
  const hashA = await sha256Hex(mp3A);
  const hashB = await sha256Hex(mp3B);

  const encoder = new TextEncoder();
  const manifestObj = {
    packageId,
    title: 'Multi-cue Round-trip',
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
        id: 'asset-a',
        path: 'audio/asset-a.mp3',
        mimeType: 'audio/mpeg' as const,
        hash: hashA,
        durationSec: 2.6,
      },
      {
        id: 'asset-b',
        path: 'audio/asset-b.mp3',
        mimeType: 'audio/mpeg' as const,
        hash: hashB,
        durationSec: 2.6,
      },
    ],
    cues: [
      {
        id: 'cue-intro',
        startCfi: 'epubcfi(/6/2!/4/2:0)',
        type: 'audio' as const,
        assetId: 'asset-a',
        startSec: 0,
        loopStartSec: 0.2,
        loopEndSec: 2.4,
        volume: 0.9,
        crossfadeSec: 0.5,
      },
      {
        id: 'cue-quiet',
        startCfi: 'epubcfi(/6/4!/4/2:0)',
        type: 'silence' as const,
      },
      {
        id: 'cue-outro',
        startCfi: 'epubcfi(/6/6!/4/2:0)',
        type: 'audio' as const,
        assetId: 'asset-b',
        startSec: 0,
        loopStartSec: 0.1,
        loopEndSec: 2.5,
        volume: 0.8,
        crossfadeSec: 0.3,
      },
    ],
  };

  const copy = { ...manifestObj };
  delete (copy as Partial<typeof copy>).manifestHash;
  manifestObj.manifestHash = await sha256Hex(encoder.encode(JSON.stringify(copy)));

  const zipWriter = new ZipWriter(new Uint8ArrayWriter());
  await zipWriter.add('manifest.json', new TextReader(JSON.stringify(manifestObj)));
  await zipWriter.add('audio/asset-a.mp3', new Uint8ArrayReader(mp3A));
  await zipWriter.add('audio/asset-b.mp3', new Uint8ArrayReader(mp3B));
  return zipWriter.close();
}

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

      // editionCompatibility (portable lineage) travels with the export
      expect(manifest.editionCompatibility).toHaveLength(1);
      expect(manifest.editionCompatibility[0]!.digest).toBe(editionId);

      // Single cue preserved
      expect(manifest.cues).toHaveLength(1);
      expect(manifest.cues[0]!.type).toBe('audio');
      expect(manifest.cues[0]!.id).toBe('cue-opening');
    } finally {
      await cleanup();
    }
  });

  it('ordered cues (audio, silence, audio) survive the round-trip in declared sequence', async () => {
    const editionId = 'rt-edition-ordered-cues';
    const fixture = await buildMultiCueFixtureBytes(editionId, 'pkg-rt-ordered');

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
      // Positional ordering assertions — not just membership
      expect(cues).toHaveLength(3);
      expect(cues[0]!.id).toBe('cue-intro');
      expect(cues[0]!.type).toBe('audio');
      expect(cues[1]!.id).toBe('cue-quiet');
      expect(cues[1]!.type).toBe('silence');
      expect(cues[2]!.id).toBe('cue-outro');
      expect(cues[2]!.type).toBe('audio');
    } finally {
      await cleanup();
    }
  });

  it('export strips local-only fields: association status, selection, installedAt, and trustState do not travel', async () => {
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

    const { packageId, manifestHash } = installRes.package!;

    // Export
    const exportRes = await exportBookScorePackage(source.fs, baseDir, packageId, manifestHash);
    expect(exportRes.success).toBe(true);
    const archiveBytes = (exportRes as { success: true; archiveBytes: Uint8Array }).archiveBytes;

    // Inspect the raw manifest.json inside the archive — no local-only keys must be present
    type EntryWithGetData = { filename: string; getData: (w: unknown) => Promise<unknown> };
    const { ZipReader, Uint8ArrayReader, TextWriter } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new Uint8ArrayReader(archiveBytes));
    const entries = (await reader.getEntries()) as unknown as EntryWithGetData[];
    const manifestEntry = entries.find((e) => e.filename === 'manifest.json');
    expect(manifestEntry).toBeDefined();
    const manifestText = (await manifestEntry!.getData(new TextWriter())) as string;
    const manifestJson = JSON.parse(manifestText) as Record<string, unknown>;
    await reader.close();

    expect(manifestJson['installedAt']).toBeUndefined();
    expect(manifestJson['selected']).toBeUndefined();
    expect(manifestJson['trustState']).toBeUndefined();
    expect(manifestJson['editionId']).toBeUndefined();

    // Import into clean profile — no association
    const { fs: cleanFs, cleanup } = await makeTmpFs();
    try {
      const importRes = await importAndAssociateBookScorePackage(
        cleanFs,
        baseDir,
        archiveBytes,
        editionId,
      );
      expect(importRes.success).toBe(true);
      expect(importRes.association).toBeUndefined();
      const cleanAssociations = await loadLocalAssociations(cleanFs, baseDir);
      expect(cleanAssociations[editionId]).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('mismatch consent is local-only: consent given in source does not grant attach rights in clean profile', async () => {
    // Use a package whose editionCompatibility lists a DIFFERENT edition (incompatible with the import target)
    const sourceEditionId = 'rt-mismatch-source-edition';
    const incompatibleTargetEditionId = 'rt-mismatch-clean-edition'; // NOT in editionCompatibility

    const fixture = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-rt-mismatch-consent',
      'Mismatch Consent Test',
      sourceEditionId, // package only declares compatibility with sourceEditionId
    );

    // Source profile: import for the target edition WITH consent (mismatch attach)
    const installRes = await importAndAssociateBookScorePackage(
      source.fs,
      baseDir,
      fixture,
      incompatibleTargetEditionId, // importing against an edition it doesn't claim compatibility with
      undefined,
      { autoAttach: true, consentGiven: true },
    );
    expect(installRes.success).toBe(true);
    // Source association exists with unverified trust (consent was given locally)
    expect(installRes.association?.trustState).toBe('unverified');
    expect(installRes.association?.selected).toBe(true);

    const { packageId, manifestHash } = installRes.package!;

    // Export — association fields must not travel
    const exportRes = await exportBookScorePackage(source.fs, baseDir, packageId, manifestHash);
    expect(exportRes.success).toBe(true);
    const archiveBytes = (exportRes as { success: true; archiveBytes: Uint8Array }).archiveBytes;

    // Import into clean profile against the same incompatible edition — no consent
    const { fs: cleanFs, cleanup } = await makeTmpFs();
    try {
      const importRes = await importAndAssociateBookScorePackage(
        cleanFs,
        baseDir,
        archiveBytes,
        incompatibleTargetEditionId,
      );
      expect(importRes.success).toBe(true);

      // No association in clean profile — consent did not travel
      expect(importRes.association).toBeUndefined();
      const cleanAssociations = await loadLocalAssociations(cleanFs, baseDir);
      expect(cleanAssociations[incompatibleTargetEditionId]).toBeUndefined();

      // Explicit attach WITHOUT consent is rejected (mismatch requires fresh consent)
      const attachNoConsent = await associateSoundtrackToEdition(
        cleanFs,
        baseDir,
        incompatibleTargetEditionId,
        packageId,
        manifestHash,
      );
      expect(attachNoConsent.success).toBe(false);
      expect(attachNoConsent.error).toMatch(/consent/i);

      // Explicit attach WITH fresh consent succeeds
      const attachWithConsent = await associateSoundtrackToEdition(
        cleanFs,
        baseDir,
        incompatibleTargetEditionId,
        packageId,
        manifestHash,
        { consentGiven: true },
      );
      expect(attachWithConsent.success).toBe(true);
      expect(attachWithConsent.association?.trustState).toBe('unverified');
      expect(attachWithConsent.association?.selected).toBe(true);
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

  it('returns an error when a stored asset is nonempty but corrupt (hash mismatch)', async () => {
    const editionId = 'rt-edition-corrupt-asset';
    const fixture = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-rt-corrupt',
      'Corrupt Asset Test',
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

    // Overwrite the stored asset with different (wrong) bytes — nonempty but corrupt
    const { saveSoundtrackAssetFile } = await import('@/services/bookscore/assetStorage');
    const corruptBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]); // not the original MP3
    await saveSoundtrackAssetFile(
      source.fs,
      baseDir,
      packageId,
      'asset-main',
      corruptBytes,
      manifestHash,
    );

    const exportRes = await exportBookScorePackage(source.fs, baseDir, packageId, manifestHash);
    expect(exportRes.success).toBe(false);
    expect((exportRes as { success: false; error: string }).error).toMatch(
      /hash mismatch|corrupt/i,
    );
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

    // Remove the asset file entirely
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
