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

class NodeTestFileSystem {
  constructor(private rootDir: string) {}

  resolvePath(fp: string, base: BaseDir) {
    return {
      baseDir: 0,
      basePrefix: async () => this.rootDir,
      fp,
      base,
    };
  }

  getURL(pathStr: string) {
    return `file://${path.join(this.rootDir, pathStr)}`;
  }

  async getBlobURL(pathStr: string): Promise<string> {
    return this.getURL(pathStr);
  }

  async getImageURL(pathStr: string): Promise<string> {
    return this.getURL(pathStr);
  }

  async openFile(pathStr: string): Promise<File> {
    const fullPath = path.join(this.rootDir, pathStr);
    const buf = await fsPromises.readFile(fullPath);
    return new File([buf], path.basename(pathStr));
  }

  async copyFile(srcPath: string, _srcBase: BaseDir, dstPath: string): Promise<void> {
    const src = path.join(this.rootDir, srcPath);
    const dst = path.join(this.rootDir, dstPath);
    await fsPromises.mkdir(path.dirname(dst), { recursive: true });
    await fsPromises.copyFile(src, dst);
  }

  async readFile(
    pathStr: string,
    _base: BaseDir,
    mode: 'text' | 'binary',
  ): Promise<string | ArrayBuffer> {
    const fullPath = path.join(this.rootDir, pathStr);
    if (mode === 'binary') {
      const buf = await fsPromises.readFile(fullPath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    return fsPromises.readFile(fullPath, 'utf8');
  }

  async writeFile(
    pathStr: string,
    _base: BaseDir,
    data: string | ArrayBuffer | Uint8Array,
  ): Promise<void> {
    const fullPath = path.join(this.rootDir, pathStr);
    await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
    if (typeof data === 'string') {
      await fsPromises.writeFile(fullPath, data, 'utf8');
    } else if (data instanceof ArrayBuffer || data?.constructor?.name === 'ArrayBuffer') {
      await fsPromises.writeFile(fullPath, Buffer.from(data as ArrayBuffer));
    } else {
      const view = data as unknown as Uint8Array;
      await fsPromises.writeFile(
        fullPath,
        Buffer.from(view.buffer, view.byteOffset, view.byteLength),
      );
    }
  }

  async exists(pathStr: string, _base: BaseDir): Promise<boolean> {
    const fullPath = path.join(this.rootDir, pathStr);
    try {
      await fsPromises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async remove(pathStr: string, _base: BaseDir): Promise<void> {
    const fullPath = path.join(this.rootDir, pathStr);
    await fsPromises.rm(fullPath, { recursive: true, force: true });
  }
}

describe('BookScore Import and Binary Storage Integration', () => {
  let tmpDir: string;
  let fs: FileSystem;
  const baseDir: BaseDir = 'Data';

  beforeEach(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'bookscore-import-test-'));
    fs = new NodeTestFileSystem(tmpDir) as unknown as FileSystem;
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

  it('atomically imports, validates, persists asset files, saves package and association, and loads into soundtrack store', async () => {
    const { createMinimalValidMp3Bytes } = await import('@/services/bookscore/importService');
    const assetAudioBytes = createMinimalValidMp3Bytes();
    const zipBytes = await createDevelopmentFixturePackageBytes(
      assetAudioBytes,
      'pkg-prod-seam',
      'Production Seam Test Soundtrack',
    );

    const editionId = 'edition-epub-prod-123';

    const importRes = await importAndAssociateBookScorePackage(fs, baseDir, zipBytes, editionId);
    expect(importRes.success).toBe(true);
    expect(importRes.package).toBeDefined();
    expect(importRes.association).toBeDefined();

    // Verify package and association are saved to disk storage
    const loadedPackages = await loadInstalledPackages(fs, baseDir);
    const loadedAssociations = await loadLocalAssociations(fs, baseDir);

    expect(loadedAssociations[editionId]).toBeDefined();
    expect(loadedAssociations[editionId]?.packageId).toBe('pkg-prod-seam');

    const pkgKey = `${importRes.package!.packageId}:${importRes.package!.manifestHash}`;
    expect(loadedPackages[pkgKey]).toBeDefined();

    // Verify reader store can load soundtrack for book
    const store = useSoundtrackStore.getState();
    store.setCapabilityEnabled(true);
    store.loadSoundtrackForBook(
      editionId,
      loadedPackages,
      loadedAssociations,
      'epubcfi(/6/2!/4/2:0)',
    );

    expect(useSoundtrackStore.getState().activePackage?.packageId).toBe('pkg-prod-seam');
    expect(useSoundtrackStore.getState().selectedCue?.id).toBe('cue-opening');
    expect(useSoundtrackStore.getState().playbackStatus).toBe('paused');
  });

  it('runs ensureBookScoreFixtureInstalled production seam when opening edition with no prior association', async () => {
    const editionId = 'edition-desktop-open-456';
    const { packages, associations } = await ensureBookScoreFixtureInstalled(
      fs,
      baseDir,
      editionId,
    );

    expect(associations[editionId]).toBeDefined();
    expect(associations[editionId]?.packageId).toBe('pkg-m1-fixture');
    expect(Object.keys(packages).length).toBeGreaterThan(0);
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
    const zipBytes = await createDevelopmentFixturePackageBytes(mp3Bytes, 'pkg-meta-rollback');

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
      'edition-fail-assoc',
      mockDecoder,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('rolled back cleanly');

    // Verify packages map was restored to initial state (new package removed)
    const currentPackages = await loadInstalledPackages(fs, baseDir);
    expect(Object.keys(currentPackages)).toEqual(['pkg-initial:hash-initial']);
  });

  it('deduplicates re-imported package revision without changing existing selected preference', async () => {
    const { createMinimalValidMp3Bytes } = await import('@/services/bookscore/importService');
    const { saveLocalAssociations } = await import('@/services/bookscore/persistence');
    const mp3Bytes = createMinimalValidMp3Bytes();
    const zipBytes = await createDevelopmentFixturePackageBytes(
      mp3Bytes,
      'pkg-dedupe-test',
      'Dedupe Test Soundtrack',
    );
    const editionId = 'edition-dedupe-1';

    // First import
    const res1 = await importAndAssociateBookScorePackage(fs, baseDir, zipBytes, editionId);
    expect(res1.success).toBe(true);

    // User explicitly deselects this association
    const assocMap = await loadLocalAssociations(fs, baseDir);
    assocMap[editionId]!.selected = false;
    await saveLocalAssociations(fs, baseDir, assocMap);

    // Re-import identical package revision
    const res2 = await importAndAssociateBookScorePackage(fs, baseDir, zipBytes, editionId);
    expect(res2.success).toBe(true);

    // Selection preference remains false
    const finalAssocMap = await loadLocalAssociations(fs, baseDir);
    expect(finalAssocMap[editionId]?.selected).toBe(false);
  });

  it('allows coexistence of changed-hash revisions for the same packageId', async () => {
    const { createMinimalValidMp3Bytes } = await import('@/services/bookscore/importService');
    const mp3Bytes = createMinimalValidMp3Bytes();

    // Import Revision 1
    const zipBytesV1 = await createDevelopmentFixturePackageBytes(
      mp3Bytes,
      'pkg-coexist',
      'Coexistence Soundtrack Rev 1',
    );
    const editionId = 'edition-coexist-1';
    const res1 = await importAndAssociateBookScorePackage(fs, baseDir, zipBytesV1, editionId);
    expect(res1.success).toBe(true);
    const pkg1Key = `${res1.package!.packageId}:${res1.package!.manifestHash}`;

    // Import Revision 2 (different title -> different manifestHash)
    const zipBytesV2 = await createDevelopmentFixturePackageBytes(
      mp3Bytes,
      'pkg-coexist',
      'Coexistence Soundtrack Rev 2 Updated',
    );
    const res2 = await importAndAssociateBookScorePackage(fs, baseDir, zipBytesV2, editionId);
    expect(res2.success).toBe(true);
    const pkg2Key = `${res2.package!.packageId}:${res2.package!.manifestHash}`;

    expect(pkg1Key).not.toBe(pkg2Key);

    // Both revisions coexist in installed packages
    const packagesMap = await loadInstalledPackages(fs, baseDir);
    expect(packagesMap[pkg1Key]).toBeDefined();
    expect(packagesMap[pkg2Key]).toBeDefined();

    // Association is updated to point to Revision 2
    const assocMap = await loadLocalAssociations(fs, baseDir);
    expect(assocMap[editionId]?.manifestHash).toBe(res2.package!.manifestHash);
  });
});
