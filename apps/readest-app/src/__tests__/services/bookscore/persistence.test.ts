import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BaseDir, FileSystem } from '@/types/system';
import {
  loadInstalledPackages,
  saveInstalledPackages,
  loadLocalAssociations,
  saveLocalAssociations,
  PACKAGES_FILENAME,
  ASSOCIATIONS_FILENAME,
} from '@/services/bookscore/persistence';
import { InstalledPackage, LocalAssociation } from '@/services/bookscore/types';
import {
  saveSoundtrackAssetFile,
  loadSoundtrackAssetFile,
} from '@/services/bookscore/assetStorage';

import { createTestFileSystem } from './testHelpers';

describe('BookScore Real Disk Persistence', () => {
  let tmpDir: string;
  let fs: FileSystem;
  const baseDir: BaseDir = 'Data';

  beforeEach(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'bookscore-test-'));
    fs = createTestFileSystem(tmpDir);
  });

  afterEach(async () => {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  const sampleManifest = {
    packageId: 'pkg-real-disk-fixture',
    title: 'Fixture Real Disk Soundtrack',
    version: 1,
    manifestHash: 'hash123456789',
    editionCompatibility: [
      {
        algorithm: 'readest-partial-md5-v1' as const,
        digest: 'md5digest123',
        epubByteLength: 50000,
      },
    ],
    assets: [
      {
        id: 'asset-bg',
        path: 'audio/bg.mp3',
        mimeType: 'audio/mpeg' as const,
        hash: 'sha256hash',
        durationSec: 60,
      },
    ],
    cues: [
      {
        id: 'cue-1',
        startCfi: 'epubcfi(/6/2!/4/2:0)',
        type: 'audio' as const,
        assetId: 'asset-bg',
        startSec: 0,
        loopStartSec: 0,
        loopEndSec: 30,
        volume: 0.8,
        crossfadeSec: 0.5,
      },
    ],
  };

  const samplePackage: InstalledPackage = {
    packageId: 'pkg-real-disk-fixture',
    manifestHash: 'hash123456789',
    manifest: sampleManifest,
    installedAt: 1700000000000,
  };

  const sampleAssociation: LocalAssociation = {
    editionId: 'edition-epub-disk-1',
    packageId: 'pkg-real-disk-fixture',
    manifestHash: 'hash123456789',
    selected: true,
  };

  it('persists and loads validated package fixture to real disk storage', async () => {
    const packagesMap = { 'pkg-real-disk-fixture:hash123456789': samplePackage };
    await saveInstalledPackages(fs, baseDir, packagesMap);

    const exists = await fs.exists(PACKAGES_FILENAME, baseDir);
    expect(exists).toBe(true);

    const loadedPackages = await loadInstalledPackages(fs, baseDir);
    expect(loadedPackages['pkg-real-disk-fixture:hash123456789']).toBeDefined();
    expect(loadedPackages['pkg-real-disk-fixture:hash123456789']?.packageId).toBe(
      'pkg-real-disk-fixture',
    );
  });

  it('persists and loads local associations on real disk', async () => {
    const associationsMap = { 'edition-epub-disk-1': sampleAssociation };
    await saveLocalAssociations(fs, baseDir, associationsMap);

    const exists = await fs.exists(ASSOCIATIONS_FILENAME, baseDir);
    expect(exists).toBe(true);

    const loadedAssociations = await loadLocalAssociations(fs, baseDir);
    expect(loadedAssociations['edition-epub-disk-1']).toBeDefined();
    expect(loadedAssociations['edition-epub-disk-1']?.packageId).toBe('pkg-real-disk-fixture');
  });

  it('persists and retrieves binary soundtrack audio asset files on real disk', async () => {
    const testBytes = new Uint8Array([10, 20, 30, 40, 50, 60]);
    await saveSoundtrackAssetFile(fs, baseDir, 'pkg-real-disk-fixture', 'asset-bg', testBytes);

    const loadedBuffer = await loadSoundtrackAssetFile(
      fs,
      baseDir,
      'pkg-real-disk-fixture',
      'asset-bg',
    );
    expect(loadedBuffer).not.toBeNull();
    const loadedBytes = new Uint8Array(loadedBuffer!);
    expect(loadedBytes).toEqual(testBytes);
  });
});
