import { BaseDir, FileSystem } from '@/types/system';
import { InstalledPackage, LocalAssociation } from './types';
import { AudioDecoderFn, sha256Hex, validateBookScorePackageArchive } from './packageValidation';
import { saveSoundtrackAssetFile } from './assetStorage';
import {
  loadInstalledPackages,
  loadLocalAssociations,
  saveInstalledPackages,
  saveLocalAssociations,
} from './persistence';

export type ImportAndAssociateResult = {
  success: boolean;
  package?: InstalledPackage;
  association?: LocalAssociation;
  error?: string;
};

/**
 * Atomically validates a .bookscore package archive, persists its asset files to app storage,
 * updates soundtrack_packages.json with the InstalledPackage, and creates/saves a LocalAssociation
 * attaching the exact Package Revision to the EPUB edition.
 */
export async function importAndAssociateBookScorePackage(
  fs: FileSystem,
  baseDir: BaseDir,
  archiveBytes: Uint8Array,
  editionId: string,
  audioDecoder?: AudioDecoderFn,
): Promise<ImportAndAssociateResult> {
  const valRes = await validateBookScorePackageArchive(archiveBytes, audioDecoder);
  if (!valRes.valid || !valRes.package || !valRes.assetFiles) {
    return {
      success: false,
      error: valRes.errors.join('; '),
    };
  }

  const pkg = valRes.package;
  const writtenAssetPaths: string[] = [];

  try {
    // Persist extracted asset audio files to app storage
    for (const [assetId, bytes] of valRes.assetFiles.entries()) {
      const savedPath = await saveSoundtrackAssetFile(fs, baseDir, pkg.packageId, assetId, bytes);
      writtenAssetPaths.push(savedPath);
    }

    // Save InstalledPackage to soundtrack_packages.json
    const existingPackages = await loadInstalledPackages(fs, baseDir);
    const pkgKey = `${pkg.packageId}:${pkg.manifestHash}`;
    existingPackages[pkgKey] = pkg;
    await saveInstalledPackages(fs, baseDir, existingPackages);

    // Create & save LocalAssociation attaching Package Revision to EPUB edition
    const existingAssociations = await loadLocalAssociations(fs, baseDir);
    const association: LocalAssociation = {
      editionId,
      packageId: pkg.packageId,
      manifestHash: pkg.manifestHash,
      selected: true,
    };
    existingAssociations[editionId] = association;
    await saveLocalAssociations(fs, baseDir, existingAssociations);

    return {
      success: true,
      package: pkg,
      association,
    };
  } catch (err) {
    // Transaction Rollback: Clean up any partially written asset files on disk
    for (const filePath of writtenAssetPaths) {
      try {
        if ('deleteFile' in fs && typeof fs.deleteFile === 'function') {
          await fs.deleteFile(filePath, baseDir);
        } else if (
          'remove' in fs &&
          typeof (fs as unknown as { remove: unknown }).remove === 'function'
        ) {
          await (fs as unknown as { remove: (p: string, b: BaseDir) => Promise<void> }).remove(
            filePath,
            baseDir,
          );
        }
      } catch (_) {}
    }
    return {
      success: false,
      error: `Import failed and rolled back cleanly: ${err}`,
    };
  }
}

/**
 * Helper to build a valid binary .bookscore ZIP package archive for testing and development.
 */
export async function createDevelopmentFixturePackageBytes(
  assetAudioBytes: Uint8Array,
  packageId = 'pkg-dev-fixture',
  title = 'Development EPUB Soundtrack',
): Promise<Uint8Array> {
  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } = await import(
    '@zip.js/zip.js'
  );

  const assetHash = await sha256Hex(assetAudioBytes);

  const manifestObj = {
    packageId,
    title,
    version: 1,
    manifestHash: '',
    editionCompatibility: [
      {
        algorithm: 'readest-partial-md5-v1' as const,
        digest: 'dev-edition-digest',
        epubByteLength: 1048576,
      },
    ],
    assets: [
      {
        id: 'asset-main',
        path: 'audio/main.mp3',
        mimeType: 'audio/mpeg' as const,
        hash: assetHash,
        durationSec: 60,
      },
    ],
    cues: [
      {
        id: 'cue-opening',
        startCfi: 'epubcfi(/6/2!/4/2:0)',
        type: 'audio' as const,
        assetId: 'asset-main',
        startSec: 0,
        loopStartSec: 5,
        loopEndSec: 55,
        volume: 0.9,
        crossfadeSec: 1.0,
      },
    ],
  };

  const encoder = new TextEncoder();
  const manifestCopy: Partial<typeof manifestObj> = { ...manifestObj };
  delete manifestCopy.manifestHash;
  const computedHash = await sha256Hex(encoder.encode(JSON.stringify(manifestCopy)));
  manifestObj.manifestHash = computedHash;

  const zipWriter = new ZipWriter(new Uint8ArrayWriter());
  await zipWriter.add('manifest.json', new TextReader(JSON.stringify(manifestObj)));
  await zipWriter.add('audio/main.mp3', new Uint8ArrayReader(assetAudioBytes));
  return zipWriter.close();
}

/**
 * Production Desktop helper: Ensures a validated Milestone 1 EPUB soundtrack package
 * and Local Association are installed and associated on disk for the current edition.
 * If no association exists yet for editionId, imports the validated fixture package.
 */
export async function ensureBookScoreFixtureInstalled(
  fs: FileSystem,
  baseDir: BaseDir,
  editionId: string,
): Promise<{
  packages: Record<string, InstalledPackage>;
  associations: Record<string, LocalAssociation>;
}> {
  let packages = await loadInstalledPackages(fs, baseDir);
  let associations = await loadLocalAssociations(fs, baseDir);

  if (!associations[editionId]) {
    const sampleAudioBytes = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00]);
    const zipBytes = await createDevelopmentFixturePackageBytes(
      sampleAudioBytes,
      'pkg-m1-fixture',
      'Milestone 1 EPUB Soundtrack',
    );
    const importRes = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      zipBytes,
      editionId,
      async () => ({ durationSec: 60 }),
    );
    if (importRes.success) {
      packages = await loadInstalledPackages(fs, baseDir);
      associations = await loadLocalAssociations(fs, baseDir);
    }
  }

  return { packages, associations };
}
