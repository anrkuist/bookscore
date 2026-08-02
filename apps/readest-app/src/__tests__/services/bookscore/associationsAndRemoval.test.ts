import { describe, expect, it, beforeEach } from 'vitest';
import { BaseDir, FileSystem } from '@/types/system';
import {
  associateSoundtrackToEdition,
  computeSoundtrackCandidates,
  createDevelopmentFixturePackageBytes,
  detachSoundtrackFromEdition,
  getAffectedAssociationsForPackage,
  importAndAssociateBookScorePackage,
  isEditionCompatibleWithManifest,
  removeInstalledPackage,
} from '@/services/bookscore/importService';
import { loadInstalledPackages, loadLocalAssociations } from '@/services/bookscore/persistence';

class MockFileSystem {
  files: Map<string, string | ArrayBuffer> = new Map();

  async readFile(path: string): Promise<unknown> {
    if (!this.files.has(path)) {
      throw new Error(`File not found: ${path}`);
    }
    return this.files.get(path);
  }

  async writeFile(path: string, _baseDir: BaseDir, data: string | ArrayBuffer): Promise<void> {
    this.files.set(path, data);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

describe('BookScore Associations, Trust, and Safe Removal', () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = new MockFileSystem() as unknown as FileSystem;
  });

  it('checks edition compatibility correctly', async () => {
    const pkgBytes = await createDevelopmentFixturePackageBytes();
    const mockAudioDecoder = async () => ({
      durationSec: 2.6,
      sampleRate: 44100,
      numberOfChannels: 2,
    });
    const { validateBookScorePackageArchive } = await import(
      '@/services/bookscore/packageValidation'
    );
    const valRes = await validateBookScorePackageArchive(pkgBytes, mockAudioDecoder);
    expect(valRes.valid).toBe(true);

    const manifest = valRes.package!.manifest;
    expect(isEditionCompatibleWithManifest(manifest, 'dev-edition-digest')).toBe(true);
    expect(isEditionCompatibleWithManifest(manifest, 'DEV-EDITION-DIGEST')).toBe(true);
    expect(isEditionCompatibleWithManifest(manifest, 'other-edition')).toBe(false);
  });

  it('offers a Verified candidate on fingerprint match but does not auto-attach if autoAttach is false', async () => {
    const pkgBytes = await createDevelopmentFixturePackageBytes();
    const mockAudioDecoder = async () => ({
      durationSec: 2.6,
      sampleRate: 44100,
      numberOfChannels: 2,
    });

    const res = await importAndAssociateBookScorePackage(
      fs,
      'Data',
      pkgBytes,
      'dev-edition-digest',
      mockAudioDecoder,
      { autoAttach: false },
    );

    expect(res.success).toBe(true);
    expect(res.package).toBeDefined();
    expect(res.association).toBeUndefined();

    const packages = await loadInstalledPackages(fs, 'Data');
    const associations = await loadLocalAssociations(fs, 'Data');
    const { activeAssociation, candidates } = computeSoundtrackCandidates(
      'dev-edition-digest',
      packages,
      associations,
    );

    expect(activeAssociation).toBeNull();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.trustState).toBe('verified');
    expect(candidates[0]?.isSelected).toBe(false);
  });

  it('requires explicit consent for unverified edition association', async () => {
    const pkgBytes = await createDevelopmentFixturePackageBytes();
    const mockAudioDecoder = async () => ({
      durationSec: 2.6,
      sampleRate: 44100,
      numberOfChannels: 2,
    });

    // Import package for a different edition without autoAttach
    const res = await importAndAssociateBookScorePackage(
      fs,
      'Data',
      pkgBytes,
      'different-edition',
      mockAudioDecoder,
      { autoAttach: false },
    );
    expect(res.success).toBe(true);
    const pkg = res.package!;

    // Attempt to associate without consent -> fails
    const assocFail = await associateSoundtrackToEdition(
      fs,
      'Data',
      'different-edition',
      pkg.packageId,
      pkg.manifestHash,
      { consentGiven: false },
    );
    expect(assocFail.success).toBe(false);
    expect(assocFail.error).toContain('consent required');

    // Attempt with consent -> succeeds with trustState 'unverified'
    const assocSuccess = await associateSoundtrackToEdition(
      fs,
      'Data',
      'different-edition',
      pkg.packageId,
      pkg.manifestHash,
      { consentGiven: true },
    );
    expect(assocSuccess.success).toBe(true);
    expect(assocSuccess.association?.trustState).toBe('unverified');
    expect(assocSuccess.association?.selected).toBe(true);
  });

  it('enforces one active soundtrack per edition when switching associations', async () => {
    const pkg1Bytes = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-1',
      'Soundtrack 1',
    );
    const pkg2Bytes = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-2',
      'Soundtrack 2',
    );
    const mockAudioDecoder = async () => ({
      durationSec: 2.6,
      sampleRate: 44100,
      numberOfChannels: 2,
    });

    const res1 = await importAndAssociateBookScorePackage(
      fs,
      'Data',
      pkg1Bytes,
      'dev-edition-digest',
      mockAudioDecoder,
      { autoAttach: true },
    );
    const res2 = await importAndAssociateBookScorePackage(
      fs,
      'Data',
      pkg2Bytes,
      'dev-edition-digest',
      mockAudioDecoder,
      { autoAttach: true },
    );

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);

    const packages = await loadInstalledPackages(fs, 'Data');
    const associations = await loadLocalAssociations(fs, 'Data');
    const { activeAssociation, candidates } = computeSoundtrackCandidates(
      'dev-edition-digest',
      packages,
      associations,
    );

    expect(activeAssociation?.packageId).toBe('pkg-2');
    const selectedCount = candidates.filter((c) => c.isSelected).length;
    expect(selectedCount).toBe(1);
  });

  it('allows detaching the active soundtrack from an edition', async () => {
    const pkgBytes = await createDevelopmentFixturePackageBytes();
    const mockAudioDecoder = async () => ({
      durationSec: 2.6,
      sampleRate: 44100,
      numberOfChannels: 2,
    });

    await importAndAssociateBookScorePackage(
      fs,
      'Data',
      pkgBytes,
      'dev-edition-digest',
      mockAudioDecoder,
      { autoAttach: true },
    );

    const detachRes = await detachSoundtrackFromEdition(fs, 'Data', 'dev-edition-digest');
    expect(detachRes.success).toBe(true);

    const packages = await loadInstalledPackages(fs, 'Data');
    const associations = await loadLocalAssociations(fs, 'Data');
    const { activeAssociation } = computeSoundtrackCandidates(
      'dev-edition-digest',
      packages,
      associations,
    );
    expect(activeAssociation).toBeNull();
  });

  it('safely removes an installed package, detaching only that package without auto-switching', async () => {
    const pkg1Bytes = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-1',
      'Soundtrack 1',
    );
    const pkg2Bytes = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-2',
      'Soundtrack 2',
    );
    const mockAudioDecoder = async () => ({
      durationSec: 2.6,
      sampleRate: 44100,
      numberOfChannels: 2,
    });

    const res1 = await importAndAssociateBookScorePackage(
      fs,
      'Data',
      pkg1Bytes,
      'edition-A',
      mockAudioDecoder,
      { autoAttach: true, consentGiven: true },
    );
    await importAndAssociateBookScorePackage(fs, 'Data', pkg2Bytes, 'edition-B', mockAudioDecoder, {
      autoAttach: true,
      consentGiven: true,
    });

    const pkg1 = res1.package!;
    const associationsBefore = await loadLocalAssociations(fs, 'Data');
    const affected = getAffectedAssociationsForPackage(
      pkg1.packageId,
      pkg1.manifestHash,
      associationsBefore,
    );
    expect(affected.map((a) => a.editionId)).toContain('edition-A');

    // Remove pkg1
    const removeRes = await removeInstalledPackage(fs, 'Data', pkg1.packageId, pkg1.manifestHash);
    expect(removeRes.success).toBe(true);
    expect(removeRes.affectedEditionIds).toContain('edition-A');

    const packagesAfter = await loadInstalledPackages(fs, 'Data');
    const associationsAfter = await loadLocalAssociations(fs, 'Data');

    expect(packagesAfter[`${pkg1.packageId}:${pkg1.manifestHash}`]).toBeUndefined();

    // Check edition-A has no active soundtrack and did NOT auto-switch
    const { activeAssociation: activeA } = computeSoundtrackCandidates(
      'edition-A',
      packagesAfter,
      associationsAfter,
    );
    expect(activeA).toBeNull();

    // Check edition-B still has pkg2 active
    const { activeAssociation: activeB } = computeSoundtrackCandidates(
      'edition-B',
      packagesAfter,
      associationsAfter,
    );
    expect(activeB?.packageId).toBe('pkg-2');
  });
});
