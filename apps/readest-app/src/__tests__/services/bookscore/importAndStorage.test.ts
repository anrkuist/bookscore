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
    const assetAudioBytes = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x80, 0xff]);
    const zipBytes = await createDevelopmentFixturePackageBytes(
      assetAudioBytes,
      'pkg-prod-seam',
      'Production Seam Test Soundtrack',
    );

    const editionId = 'edition-epub-prod-123';
    const mockAudioDecoder = async () => ({ durationSec: 60 });

    const importRes = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      zipBytes,
      editionId,
      mockAudioDecoder,
    );
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
});
