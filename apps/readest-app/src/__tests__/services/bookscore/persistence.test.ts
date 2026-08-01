import { describe, it, expect } from 'vitest';
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

class MemoryFileSystem {
  private files = new Map<string, string>();

  async readFile(path: string, base: BaseDir, _format: 'text'): Promise<string> {
    const key = `${base}:${path}`;
    const content = this.files.get(key);
    if (!content) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, base: BaseDir, data: string): Promise<void> {
    const key = `${base}:${path}`;
    this.files.set(key, data);
  }

  async exists(path: string, base: BaseDir): Promise<boolean> {
    return this.files.has(`${base}:${path}`);
  }

  async remove(path: string, base: BaseDir): Promise<void> {
    this.files.delete(`${base}:${path}`);
  }
}

describe('BookScore Persistence', () => {
  const sampleManifest = {
    packageId: 'pkg-real-fixture',
    title: 'Fixture Soundtrack',
    version: 1,
    manifestHash: 'hash12345',
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
    packageId: 'pkg-real-fixture',
    manifestHash: 'hash12345',
    manifest: sampleManifest,
    installedAt: 1700000000000,
  };

  const sampleAssociation: LocalAssociation = {
    editionId: 'edition-epub-1',
    packageId: 'pkg-real-fixture',
    manifestHash: 'hash12345',
    selected: true,
  };

  it('persists and loads validated package fixture through real safeLoad/SaveJSON pipeline', async () => {
    const fs = new MemoryFileSystem() as unknown as FileSystem;
    const baseDir: BaseDir = 'Data';

    // Save package
    const packagesMap = { 'pkg-real-fixture:hash12345': samplePackage };
    await saveInstalledPackages(fs, baseDir, packagesMap);

    // Verify file written to storage
    const exists = await fs.exists(PACKAGES_FILENAME, baseDir);
    expect(exists).toBe(true);

    // Load package back and verify package validation executed
    const loadedPackages = await loadInstalledPackages(fs, baseDir);
    expect(loadedPackages['pkg-real-fixture:hash12345']).toBeDefined();
    expect(loadedPackages['pkg-real-fixture:hash12345']?.packageId).toBe('pkg-real-fixture');
    expect(loadedPackages['pkg-real-fixture:hash12345']?.manifest.title).toBe('Fixture Soundtrack');
  });

  it('persists and loads local associations', async () => {
    const fs = new MemoryFileSystem() as unknown as FileSystem;
    const baseDir: BaseDir = 'Data';

    const associationsMap = { 'edition-epub-1': sampleAssociation };
    await saveLocalAssociations(fs, baseDir, associationsMap);

    const exists = await fs.exists(ASSOCIATIONS_FILENAME, baseDir);
    expect(exists).toBe(true);

    const loadedAssociations = await loadLocalAssociations(fs, baseDir);
    expect(loadedAssociations['edition-epub-1']).toBeDefined();
    expect(loadedAssociations['edition-epub-1']?.packageId).toBe('pkg-real-fixture');
    expect(loadedAssociations['edition-epub-1']?.selected).toBe(true);
  });
});
