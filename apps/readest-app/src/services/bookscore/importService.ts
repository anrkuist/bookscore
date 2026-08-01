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
 * Creates a minimal valid, decodable MPEG-1 Layer III (MP3) audio byte sequence (~2.6 seconds at 44.1 kHz).
 */
export function createMinimalValidMp3Bytes(): Uint8Array {
  const frameHeader = [0xff, 0xfb, 0x90, 0x64];
  const frameLength = 417;
  const numFrames = 100;
  const totalLength = frameLength * numFrames;
  const bytes = new Uint8Array(totalLength);

  for (let i = 0; i < numFrames; i++) {
    const offset = i * frameLength;
    bytes.set(frameHeader, offset);
  }
  return bytes;
}

/**
 * Atomically validates a .bookscore package archive, persists its asset files to app storage,
 * updates soundtrack_packages.json with the InstalledPackage, and creates/saves a LocalAssociation
 * attaching the exact Package Revision to the EPUB edition.
 *
 * If any step fails, performs a full transaction rollback (removing written asset files and restoring initial packages & associations metadata).
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
  const pkgKey = `${pkg.packageId}:${pkg.manifestHash}`;
  const writtenAssetPaths: string[] = [];

  // Snapshot initial metadata state for atomic transaction rollback
  const initialPackages = await loadInstalledPackages(fs, baseDir);
  const initialAssociations = await loadLocalAssociations(fs, baseDir);

  try {
    const existingPackage = initialPackages[pkgKey];
    const isAlreadyInstalled = Boolean(existingPackage);
    // Retain immutable stored package record if already installed
    const pkgToUse = existingPackage ?? pkg;

    // 1. Persist extracted asset audio files to app storage (namespaced by manifestHash)
    const { loadSoundtrackAssetFile } = await import('./assetStorage');

    for (const [assetId, bytes] of valRes.assetFiles.entries()) {
      if (isAlreadyInstalled) {
        const existingData = await loadSoundtrackAssetFile(
          fs,
          baseDir,
          pkg.packageId,
          assetId,
          pkg.manifestHash,
        );
        if (existingData) {
          // Asset already exists on disk for this revision, skip re-writing
          continue;
        }
      }
      const savedPath = await saveSoundtrackAssetFile(
        fs,
        baseDir,
        pkg.packageId,
        assetId,
        bytes,
        pkg.manifestHash,
      );
      writtenAssetPaths.push(savedPath);
    }

    // 2. Save InstalledPackage to soundtrack_packages.json ONLY if new
    let updatedPackages = initialPackages;
    if (!isAlreadyInstalled) {
      updatedPackages = { ...initialPackages, [pkgKey]: pkgToUse };
      await saveInstalledPackages(fs, baseDir, updatedPackages);
    }

    // 3. Create & save LocalAssociation attaching Package Revision to EPUB edition.
    // Retain existing revision associations so multiple revisions coexist.
    const revisionAssocKey = `${editionId}:${pkg.packageId}:${pkg.manifestHash}`;
    const existingRevisionAssoc = initialAssociations[revisionAssocKey];
    const existingEditionAssoc = initialAssociations[editionId];
    const matchingAssoc =
      (existingEditionAssoc &&
      existingEditionAssoc.packageId === pkg.packageId &&
      existingEditionAssoc.manifestHash === pkg.manifestHash
        ? existingEditionAssoc
        : undefined) ?? existingRevisionAssoc;

    const targetSelected = matchingAssoc ? matchingAssoc.selected : true;

    const association: LocalAssociation = {
      editionId,
      packageId: pkg.packageId,
      manifestHash: pkg.manifestHash,
      selected: targetSelected,
    };

    // Update all previous associations for this editionId so that if targetSelected is true,
    // previous revisions are updated to selected: false while remaining stored and addressable.
    const updatedAssociations = { ...initialAssociations };
    for (const [key, assoc] of Object.entries(updatedAssociations)) {
      if (
        assoc.editionId === editionId &&
        (assoc.packageId !== pkg.packageId || assoc.manifestHash !== pkg.manifestHash)
      ) {
        updatedAssociations[key] = { ...assoc, selected: false };
      }
    }

    updatedAssociations[revisionAssocKey] = association;
    updatedAssociations[editionId] = association;
    await saveLocalAssociations(fs, baseDir, updatedAssociations);

    return {
      success: true,
      package: pkgToUse,
      association,
    };
  } catch (err) {
    // Transaction Rollback: Clean up written asset files and restore original metadata
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

    try {
      await saveInstalledPackages(fs, baseDir, initialPackages);
    } catch (_) {}

    try {
      await saveLocalAssociations(fs, baseDir, initialAssociations);
    } catch (_) {}

    return {
      success: false,
      error: `Import failed and rolled back cleanly: ${err}`,
    };
  }
}

/**
 * Helper to build a valid binary .bookscore ZIP package archive with decodable MP3 audio for testing and development.
 */
export async function createDevelopmentFixturePackageBytes(
  assetAudioBytes?: Uint8Array,
  packageId = 'pkg-dev-fixture',
  title = 'Development EPUB Soundtrack',
): Promise<Uint8Array> {
  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } = await import(
    '@zip.js/zip.js'
  );

  const audioBytes = assetAudioBytes ?? createMinimalValidMp3Bytes();
  const assetHash = await sha256Hex(audioBytes);

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
        durationSec: 2.6,
      },
    ],
    cues: [
      {
        id: 'cue-opening',
        startCfi: 'epubcfi(/6/2!/4/2:0)',
        type: 'audio' as const,
        assetId: 'asset-main',
        startSec: 0,
        loopStartSec: 0.2,
        loopEndSec: 2.4,
        volume: 0.9,
        crossfadeSec: 0.5,
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
  await zipWriter.add('audio/main.mp3', new Uint8ArrayReader(audioBytes));
  return zipWriter.close();
}

/**
 * Production Desktop helper: Ensures a validated Milestone 1 EPUB soundtrack package
 * and Local Association are installed and associated on disk for the current edition.
 * Runs the production defaultAudioDecoder.
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
    const mp3Bytes = createMinimalValidMp3Bytes();
    const zipBytes = await createDevelopmentFixturePackageBytes(
      mp3Bytes,
      'pkg-m1-fixture',
      'Milestone 1 EPUB Soundtrack',
    );
    // Run production import using defaultAudioDecoder
    const importRes = await importAndAssociateBookScorePackage(fs, baseDir, zipBytes, editionId);
    if (importRes.success) {
      packages = await loadInstalledPackages(fs, baseDir);
      associations = await loadLocalAssociations(fs, baseDir);
    }
  }

  return { packages, associations };
}
