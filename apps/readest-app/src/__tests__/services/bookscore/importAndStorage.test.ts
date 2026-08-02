import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BaseDir, FileSystem } from '@/types/system';
import {
  saveSoundtrackAssetFile,
  loadSoundtrackAssetFile,
} from '@/services/bookscore/assetStorage';
import {
  importAndAssociateBookScorePackage,
  createDevelopmentFixturePackageBytes,
  ensureBookScoreFixtureInstalled,
} from '@/services/bookscore/importService';
import { loadInstalledPackages, loadLocalAssociations } from '@/services/bookscore/persistence';
import { useSoundtrackStore } from '@/store/soundtrackStore';

import { createTestFileSystem } from './testHelpers';

describe('BookScore Import and Binary Storage Integration', () => {
  let tmpDir: string;
  let fs: FileSystem;
  const baseDir: BaseDir = 'Data';

  beforeEach(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'bookscore-import-storage-'));
    fs = createTestFileSystem(tmpDir);
  });

  afterEach(async () => {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  it('preserves raw binary bytes including 0x80 and 0xFF without string/UTF-8 corruption', async () => {
    const rawBinaryBytes = new Uint8Array([0x00, 0x10, 0x7f, 0x80, 0x9a, 0xc3, 0xef, 0xff]);
    await saveSoundtrackAssetFile(fs, baseDir, 'pkg-binary-test', 'asset-bin', rawBinaryBytes);

    const loadedBuffer = await loadSoundtrackAssetFile(fs, baseDir, 'pkg-binary-test', 'asset-bin');
    expect(loadedBuffer).not.toBeNull();
    const loadedBytes = new Uint8Array(loadedBuffer!);
    expect(loadedBytes).toEqual(rawBinaryBytes);
  });

  it('atomically imports, validates, persists asset files, saves package without auto-attaching, and loads into soundtrack store when attached', async () => {
    const { createMinimalValidMp3Bytes, associateSoundtrackToEdition } = await import(
      '@/services/bookscore/importService'
    );
    const editionId = 'edition-epub-prod-123';
    const assetAudioBytes = createMinimalValidMp3Bytes();
    const zipBytes = await createDevelopmentFixturePackageBytes(
      assetAudioBytes,
      'pkg-prod-seam',
      'Production Seam Test Soundtrack',
      editionId,
    );

    // Default import without autoAttach options leaves association undefined
    const importRes = await importAndAssociateBookScorePackage(fs, baseDir, zipBytes, editionId);

    expect(importRes.success).toBe(true);
    expect(importRes.package).toBeDefined();
    expect(importRes.association).toBeUndefined();

    // Verify package is saved to disk storage, but no association is created yet
    const loadedPackages = await loadInstalledPackages(fs, baseDir);
    const loadedAssociations = await loadLocalAssociations(fs, baseDir);

    expect(loadedAssociations[editionId]).toBeUndefined();

    const pkgKey = `${importRes.package!.packageId}:${importRes.package!.manifestHash}`;
    expect(loadedPackages[pkgKey]).toBeDefined();

    // Explicitly associate package to edition
    const assocRes = await associateSoundtrackToEdition(
      fs,
      baseDir,
      editionId,
      importRes.package!.packageId,
      importRes.package!.manifestHash,
    );
    expect(assocRes.success).toBe(true);

    const updatedAssociations = await loadLocalAssociations(fs, baseDir);

    // Verify reader store can load soundtrack for book
    const store = useSoundtrackStore.getState();
    store.setCapabilityEnabled(true);
    store.loadSoundtrackForBook(
      editionId,
      loadedPackages,
      updatedAssociations,
      'epubcfi(/6/2!/4/2:0)',
    );

    expect(useSoundtrackStore.getState().activePackage?.packageId).toBe('pkg-prod-seam');
    expect(useSoundtrackStore.getState().selectedCue?.id).toBe('cue-opening');
    expect(useSoundtrackStore.getState().playbackStatus).toBe('paused');
  });

  it('runs ensureBookScoreFixtureInstalled production seam when opening edition without auto-attaching an active soundtrack', async () => {
    const editionId = 'edition-desktop-open-456';
    const { packages, associations } = await ensureBookScoreFixtureInstalled(
      fs,
      baseDir,
      editionId,
    );

    expect(associations[editionId]).toBeUndefined();
    expect(Object.keys(packages).some((k) => k.startsWith('pkg-m1-fixture:'))).toBe(true);
  });

  it('rolls back asset file writes on persistence failure to guarantee atomic package import', async () => {
    const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } = await import(
      '@zip.js/zip.js'
    );
    const { sha256Hex } = await import('@/services/bookscore/packageValidation');
    const asset1Bytes = new Uint8Array([1, 2, 3, 4]);
    const asset2Bytes = new Uint8Array([5, 6, 7, 8]);
    const hash1 = await sha256Hex(asset1Bytes);
    const hash2 = await sha256Hex(asset2Bytes);

    const manifestObj = {
      packageId: 'pkg-rollback-test',
      title: 'Rollback Package Test',
      version: 1,
      manifestHash: '',
      editionCompatibility: [
        {
          algorithm: 'readest-partial-md5-v1' as const,
          digest: 'digest',
          epubByteLength: 1000,
        },
      ],
      assets: [
        {
          id: 'asset-1',
          path: 'audio/asset1.mp3',
          mimeType: 'audio/mpeg' as const,
          hash: hash1,
          durationSec: 60,
        },
        {
          id: 'asset-2',
          path: 'audio/asset2.mp3',
          mimeType: 'audio/mpeg' as const,
          hash: hash2,
          durationSec: 60,
        },
      ],
      cues: [
        {
          id: 'cue-1',
          startCfi: 'epubcfi(/6/2!/4/2:0)',
          type: 'audio' as const,
          assetId: 'asset-1',
          startSec: 0,
          loopStartSec: 0,
          loopEndSec: 30,
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
    await zipWriter.add('audio/asset1.mp3', new Uint8ArrayReader(asset1Bytes));
    await zipWriter.add('audio/asset2.mp3', new Uint8ArrayReader(asset2Bytes));
    const zipArchiveBytes = await zipWriter.close();

    // Fault-injecting FileSystem that fails when writing asset-2
    const faultyFs: FileSystem = Object.assign(Object.create(fs), {
      writeFile: async (pathStr: string, b: BaseDir, data: string | ArrayBuffer) => {
        if (pathStr.includes('asset-2')) {
          throw new Error('Disk error during asset 2 write');
        }
        return fs.writeFile(pathStr, b, data);
      },
    });

    const res = await importAndAssociateBookScorePackage(
      faultyFs,
      baseDir,
      zipArchiveBytes,
      'edition-fault-1',
      async () => ({ durationSec: 60 }),
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('rolled back cleanly');

    // Verify written asset-1 file was cleaned up by rollback
    const asset1Path = 'soundtracks/pkg-rollback-test/asset-1.mp3';
    const asset1Exists = await fs.exists(asset1Path, baseDir);
    expect(asset1Exists).toBe(false);
  });

  it('restores original metadata on package/association persistence failure during import', async () => {
    const { createMinimalValidMp3Bytes } = await import('@/services/bookscore/importService');
    const mp3Bytes = createMinimalValidMp3Bytes();
    const editionId = 'edition-meta-rollback';
    const zipBytes = await createDevelopmentFixturePackageBytes(
      mp3Bytes,
      'pkg-meta-rollback',
      'Development EPUB Soundtrack',
      editionId,
    );

    // Pre-existing package and association state
    const initialPkg = {
      packageId: 'pkg-initial',
      manifestHash: 'hash-initial',
      installedAt: 1000,
      manifest: {
        packageId: 'pkg-initial',
        title: 'Initial',
        version: 1,
        manifestHash: 'hash-initial',
        editionCompatibility: [
          { algorithm: 'readest-partial-md5-v1' as const, digest: 'd', epubByteLength: 100 },
        ],
        assets: [
          {
            id: 'a1',
            path: 'audio/a1.mp3',
            mimeType: 'audio/mpeg' as const,
            hash: 'h1',
            durationSec: 10,
          },
        ],
        cues: [
          {
            id: 'c1',
            startCfi: 'cfi',
            type: 'audio' as const,
            assetId: 'a1',
            startSec: 0,
            loopStartSec: 0,
            loopEndSec: 10,
            volume: 1,
            crossfadeSec: 0.5,
          },
        ],
      },
    };
    const { saveInstalledPackages } = await import('@/services/bookscore/persistence');
    await saveInstalledPackages(fs, baseDir, { 'pkg-initial:hash-initial': initialPkg });

    // Faulty FS that fails when writing associations JSON
    const faultyFs: FileSystem = Object.assign(Object.create(fs), {
      writeFile: async (pathStr: string, b: BaseDir, data: string | ArrayBuffer) => {
        if (pathStr.includes('soundtrack_associations')) {
          throw new Error('Association write failure injection');
        }
        return fs.writeFile(pathStr, b, data);
      },
    });

    const mockDecoder = async () => ({ durationSec: 2.6 });
    const res = await importAndAssociateBookScorePackage(
      faultyFs,
      baseDir,
      zipBytes,
      editionId,
      mockDecoder,
      { autoAttach: true },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('rolled back cleanly');

    // Verify packages map was restored to initial state (new package removed)
    const currentPackages = await loadInstalledPackages(fs, baseDir);
    expect(Object.keys(currentPackages)).toEqual(['pkg-initial:hash-initial']);
  });

  it('deduplicates re-imported package revision without mutating stored installedAt or package record', async () => {
    const { createMinimalValidMp3Bytes } = await import('@/services/bookscore/importService');
    const { saveLocalAssociations } = await import('@/services/bookscore/persistence');
    const mp3Bytes = createMinimalValidMp3Bytes();
    const editionId = 'edition-dedupe-1';
    const zipBytes = await createDevelopmentFixturePackageBytes(
      mp3Bytes,
      'pkg-dedupe-test',
      'Dedupe Test Soundtrack',
      editionId,
    );

    // First import
    const res1 = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      zipBytes,
      editionId,
      undefined,
      {
        autoAttach: true,
      },
    );
    expect(res1.success).toBe(true);
    const originalInstalledAt = res1.package!.installedAt;

    // User explicitly deselects this association
    const assocMap = await loadLocalAssociations(fs, baseDir);
    assocMap[editionId]!.selected = false;
    await saveLocalAssociations(fs, baseDir, assocMap);

    // Re-import identical package revision after delay
    await new Promise((r) => setTimeout(r, 10));
    const res2 = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      zipBytes,
      editionId,
      undefined,
      {
        autoAttach: true,
      },
    );
    expect(res2.success).toBe(true);

    // InstalledPackage record is retained unchanged (installedAt not mutated)
    expect(res2.package!.installedAt).toBe(originalInstalledAt);

    // Selection preference remains false
    const finalAssocMap = await loadLocalAssociations(fs, baseDir);
    expect(finalAssocMap[editionId]?.selected).toBe(false);
  });

  it('allows coexistence of changed-hash revisions and retains addressable associations for both', async () => {
    const { createMinimalValidMp3Bytes } = await import('@/services/bookscore/importService');
    const mp3Bytes = createMinimalValidMp3Bytes();
    const editionId = 'edition-coexist-1';

    // Import Revision 1
    const zipBytesV1 = await createDevelopmentFixturePackageBytes(
      mp3Bytes,
      'pkg-coexist',
      'Coexistence Soundtrack Rev 1',
      editionId,
    );
    const res1 = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      zipBytesV1,
      editionId,
      undefined,
      {
        autoAttach: true,
      },
    );
    expect(res1.success).toBe(true);
    const pkg1Key = `${res1.package!.packageId}:${res1.package!.manifestHash}`;

    // Import Revision 2 (different title -> different manifestHash)
    const zipBytesV2 = await createDevelopmentFixturePackageBytes(
      mp3Bytes,
      'pkg-coexist',
      'Coexistence Soundtrack Rev 2 Updated',
      editionId,
    );
    const res2 = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      zipBytesV2,
      editionId,
      undefined,
      {
        autoAttach: true,
      },
    );
    expect(res2.success).toBe(true);

    const pkg2Key = `${res2.package!.packageId}:${res2.package!.manifestHash}`;

    expect(pkg1Key).not.toBe(pkg2Key);

    // Both revisions coexist in installed packages
    const packagesMap = await loadInstalledPackages(fs, baseDir);
    expect(packagesMap[pkg1Key]).toBeDefined();
    expect(packagesMap[pkg2Key]).toBeDefined();

    // Associations for both revisions coexist and remain addressable
    const assocMap = await loadLocalAssociations(fs, baseDir);
    const rev1AssocKey = `${editionId}:${res1.package!.packageId}:${res1.package!.manifestHash}`;
    const rev2AssocKey = `${editionId}:${res2.package!.packageId}:${res2.package!.manifestHash}`;

    expect(assocMap[rev1AssocKey]).toBeDefined();
    expect(assocMap[rev1AssocKey]?.selected).toBe(false);
    expect(assocMap[rev2AssocKey]).toBeDefined();
    expect(assocMap[rev2AssocKey]?.selected).toBe(true);
    expect(assocMap[editionId]?.manifestHash).toBe(res2.package!.manifestHash);
  });

  it('namespaces asset storage by revision and preserves existing revision assets on failed rollback of a new revision', async () => {
    const { createMinimalValidMp3Bytes } = await import('@/services/bookscore/importService');
    const { loadSoundtrackAssetFile } = await import('@/services/bookscore/assetStorage');
    const mp3BytesV1 = createMinimalValidMp3Bytes();
    const mp3BytesV2 = new Uint8Array([...mp3BytesV1, 0xff, 0xfb, 0x90, 0x64]); // Different bytes

    const packageId = 'pkg-namespaced-rollback';
    const editionId = 'edition-rollback-ns';

    // Import Revision 1 successfully
    const zipBytesV1 = await createDevelopmentFixturePackageBytes(
      mp3BytesV1,
      packageId,
      'Namespaced Rev 1',
      editionId,
    );
    const res1 = await importAndAssociateBookScorePackage(fs, baseDir, zipBytesV1, editionId);
    expect(res1.success).toBe(true);
    const hash1 = res1.package!.manifestHash;

    // Verify Revision 1 asset is readable
    const asset1Buffer = await loadSoundtrackAssetFile(fs, baseDir, packageId, 'asset-main', hash1);
    expect(asset1Buffer).not.toBeNull();

    // Build Revision 2 zip bytes
    const zipBytesV2 = await createDevelopmentFixturePackageBytes(
      mp3BytesV2,
      packageId,
      'Namespaced Rev 2',
      editionId,
    );

    // Faulty FS that fails when saving soundtrack_packages.json on Revision 2
    const faultyFs: FileSystem = Object.assign(Object.create(fs), {
      writeFile: async (pathStr: string, b: BaseDir, data: string | ArrayBuffer) => {
        if (pathStr.includes('soundtrack_packages')) {
          throw new Error('Disk error during soundtrack_packages write');
        }
        return fs.writeFile(pathStr, b, data);
      },
    });

    const res2 = await importAndAssociateBookScorePackage(
      faultyFs,
      baseDir,
      zipBytesV2,
      editionId,
      async () => ({ durationSec: 2.6 }),
    );
    expect(res2.success).toBe(false);

    // Verify Revision 1's asset is still intact and readable on disk!
    const asset1StillExists = await loadSoundtrackAssetFile(
      fs,
      baseDir,
      packageId,
      'asset-main',
      hash1,
    );
    expect(asset1StillExists).not.toBeNull();
    expect(new Uint8Array(asset1StillExists!)).toEqual(mp3BytesV1);
  });
});
