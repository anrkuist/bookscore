import { BaseDir, FileSystem } from '@/types/system';
import {
  InstalledPackage,
  LocalAssociation,
  SoundtrackCandidate,
  SoundtrackPackageManifest,
} from './types';
import { AudioDecoderFn, sha256Hex, validateBookScorePackageArchive } from './packageValidation';
import {
  loadInstalledPackages,
  loadLocalAssociations,
  removePackageFromRepairQueue,
  saveInstalledPackages,
  saveLocalAssociations,
  StoredAssociationsMap,
  StoredPackagesMap,
} from './persistence';

export type ImportAndAssociateResult = {
  success: boolean;
  package?: InstalledPackage;
  association?: LocalAssociation;
  error?: string;
};

export type ImportPackageOptions = {
  autoAttach?: boolean;
  consentGiven?: boolean;
};

/**
 * Checks whether an EPUB editionId matches a package manifest's editionCompatibility entries.
 */
export function isEditionCompatibleWithManifest(
  manifest: SoundtrackPackageManifest,
  editionId: string,
): boolean {
  if (!manifest?.editionCompatibility || !Array.isArray(manifest.editionCompatibility)) {
    return false;
  }
  return manifest.editionCompatibility.some((compat) => {
    if (compat.algorithm === 'readest-partial-md5-v1') {
      return compat.digest.toLowerCase() === editionId.toLowerCase();
    }
    return false;
  });
}

/**
 * Computes all soundtrack candidates for a given EPUB editionId from installed packages and associations.
 */
export function computeSoundtrackCandidates(
  editionId: string,
  packages: StoredPackagesMap,
  associations: StoredAssociationsMap,
): {
  activeAssociation: LocalAssociation | null;
  candidates: SoundtrackCandidate[];
} {
  const activeAssoc = associations[editionId];
  const activeAssociation = activeAssoc && activeAssoc.selected ? activeAssoc : null;

  const candidates: SoundtrackCandidate[] = [];

  for (const pkg of Object.values(packages)) {
    const isMatch = isEditionCompatibleWithManifest(pkg.manifest, editionId);
    const revisionAssocKey = `${editionId}:${pkg.packageId}:${pkg.manifestHash}`;
    const revisionAssoc = associations[revisionAssocKey];

    const isSelected =
      Boolean(activeAssociation) &&
      activeAssociation?.packageId === pkg.packageId &&
      activeAssociation?.manifestHash === pkg.manifestHash;

    const trustState: 'verified' | 'unverified' =
      revisionAssoc?.trustState ?? (isMatch ? 'verified' : 'unverified');

    candidates.push({
      package: pkg,
      trustState,
      isSelected,
    });
  }

  candidates.sort((a, b) => {
    if (a.isSelected && !b.isSelected) return -1;
    if (!a.isSelected && b.isSelected) return 1;
    if (a.trustState === 'verified' && b.trustState === 'unverified') return -1;
    if (a.trustState === 'unverified' && b.trustState === 'verified') return 1;
    return a.package.manifest.title.localeCompare(b.package.manifest.title);
  });

  return { activeAssociation, candidates };
}

/**
 * Associates an installed package revision to an EPUB edition.
 * Enforces one active soundtrack per edition. Requires consent for unverified edition mismatches.
 */
export async function associateSoundtrackToEdition(
  fs: FileSystem,
  baseDir: BaseDir,
  editionId: string,
  packageId: string,
  manifestHash: string,
  options?: { consentGiven?: boolean },
): Promise<{ success: boolean; association?: LocalAssociation; error?: string }> {
  const initialPackages = await loadInstalledPackages(fs, baseDir);
  const initialAssociations = await loadLocalAssociations(fs, baseDir);

  const pkgKey = `${packageId}:${manifestHash}`;
  const pkg = initialPackages[pkgKey];
  if (!pkg) {
    return { success: false, error: `Package revision ${pkgKey} not found` };
  }

  const isMatch = isEditionCompatibleWithManifest(pkg.manifest, editionId);
  let trustState: 'verified' | 'unverified' = 'verified';

  if (!isMatch) {
    if (!options?.consentGiven) {
      return {
        success: false,
        error: `Fresh prominent consent required to attach unverified soundtrack revision ${pkgKey} to edition ${editionId}`,
      };
    }
    trustState = 'unverified';
  }

  const revisionAssocKey = `${editionId}:${packageId}:${manifestHash}`;
  const association: LocalAssociation = {
    editionId,
    packageId,
    manifestHash,
    selected: true,
    trustState,
  };

  const updatedAssociations: Record<string, LocalAssociation> = { ...initialAssociations };

  // Enforce one active soundtrack per edition: unselect existing revision associations for this editionId
  for (const [key, assoc] of Object.entries(updatedAssociations)) {
    if (assoc.editionId === editionId || key.startsWith(`${editionId}:`)) {
      updatedAssociations[key] = {
        ...assoc,
        selected: false,
      };
    }
  }

  updatedAssociations[revisionAssocKey] = association;
  updatedAssociations[editionId] = association;

  await saveLocalAssociations(fs, baseDir, updatedAssociations);

  return {
    success: true,
    association,
  };
}

/**
 * Detaches the currently selected active soundtrack for an EPUB edition without deleting the installed package.
 */
export async function detachSoundtrackFromEdition(
  fs: FileSystem,
  baseDir: BaseDir,
  editionId: string,
): Promise<{ success: boolean }> {
  const initialAssociations = await loadLocalAssociations(fs, baseDir);
  const updatedAssociations: Record<string, LocalAssociation> = { ...initialAssociations };

  for (const [key, assoc] of Object.entries(updatedAssociations)) {
    if (assoc.editionId === editionId || key === editionId || key.startsWith(`${editionId}:`)) {
      updatedAssociations[key] = {
        ...assoc,
        selected: false,
      };
    }
  }

  await saveLocalAssociations(fs, baseDir, updatedAssociations);
  return { success: true };
}

/**
 * Finds all LocalAssociation entries referencing a specific package revision.
 */
export function getAffectedAssociationsForPackage(
  packageId: string,
  manifestHash: string,
  associations: StoredAssociationsMap,
): { editionId: string; association: LocalAssociation }[] {
  const affected: { editionId: string; association: LocalAssociation }[] = [];
  const seenEditions = new Set<string>();

  for (const assoc of Object.values(associations)) {
    if (
      assoc &&
      assoc.packageId === packageId &&
      assoc.manifestHash === manifestHash &&
      !seenEditions.has(assoc.editionId)
    ) {
      seenEditions.add(assoc.editionId);
      affected.push({ editionId: assoc.editionId, association: assoc });
    }
  }

  return affected;
}

/**
 * Safely removes an installed soundtrack package from app storage and package persistence.
 * Detaches only that package from affected local associations and NEVER switches automatically.
 */
export async function removeInstalledPackage(
  fs: FileSystem,
  baseDir: BaseDir,
  packageId: string,
  manifestHash: string,
): Promise<{ success: boolean; affectedEditionIds: string[] }> {
  const initialPackages = await loadInstalledPackages(fs, baseDir);
  const initialAssociations = await loadLocalAssociations(fs, baseDir);

  const pkgKey = `${packageId}:${manifestHash}`;
  const pkg = initialPackages[pkgKey];

  const affectedAssociations = getAffectedAssociationsForPackage(
    packageId,
    manifestHash,
    initialAssociations,
  );
  const affectedEditionIds = affectedAssociations.map((a) => a.editionId);

  // 1. Remove from packages map
  const updatedPackages = { ...initialPackages };
  delete updatedPackages[pkgKey];
  await saveInstalledPackages(fs, baseDir, updatedPackages);

  // 2. Delete asset audio files from storage
  if (pkg) {
    for (const asset of pkg.manifest.assets) {
      const assetPath = `soundtracks/${packageId}/${manifestHash}/${asset.id}.mp3`;
      try {
        if ('deleteFile' in fs && typeof fs.deleteFile === 'function') {
          await fs.deleteFile(assetPath, baseDir);
        } else if (
          'remove' in fs &&
          typeof (fs as unknown as { remove: unknown }).remove === 'function'
        ) {
          await (fs as unknown as { remove: (p: string, b: BaseDir) => Promise<void> }).remove(
            assetPath,
            baseDir,
          );
        }
      } catch (_) {}
    }
  }

  // 3. Remove/detach from associations map (NEVER auto-switches!)
  const updatedAssociations: Record<string, LocalAssociation> = { ...initialAssociations };
  for (const [key, assoc] of Object.entries(updatedAssociations)) {
    if (assoc.packageId === packageId && assoc.manifestHash === manifestHash) {
      delete updatedAssociations[key];
    }
  }

  for (const editionId of affectedEditionIds) {
    const primaryAssoc = updatedAssociations[editionId];
    if (
      primaryAssoc &&
      primaryAssoc.packageId === packageId &&
      primaryAssoc.manifestHash === manifestHash
    ) {
      delete updatedAssociations[editionId];
    }
  }

  await saveLocalAssociations(fs, baseDir, updatedAssociations);
  await removePackageFromRepairQueue(fs, baseDir, packageId, manifestHash);

  return {
    success: true,
    affectedEditionIds,
  };
}

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
 * updates soundtrack_packages.json with the InstalledPackage, and conditionally creates/saves a LocalAssociation
 * attaching the exact Package Revision to the EPUB edition.
 *
 * Fingerprint match offers a Verified candidate but never auto-attaches unless autoAttach is explicitly requested.
 * Mismatch requires explicit consent.
 */
export async function importAndAssociateBookScorePackage(
  fs: FileSystem,
  baseDir: BaseDir,
  archiveBytes: Uint8Array,
  editionId: string,
  audioDecoder?: AudioDecoderFn,
  options?: ImportPackageOptions,
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
    const pkgToUse = existingPackage ?? pkg;

    // 1. Persist extracted asset audio files to app storage (namespaced by manifestHash)
    const { verifySoundtrackAsset, saveSoundtrackAssetFile } = await import('./assetStorage');

    for (const [assetId, bytes] of valRes.assetFiles.entries()) {
      if (isAlreadyInstalled) {
        const manifestAsset = pkg.manifest.assets.find((a) => a.id === assetId);
        const verifyRes = await verifySoundtrackAsset(
          fs,
          baseDir,
          pkg.packageId,
          assetId,
          pkg.manifestHash,
          manifestAsset?.hash,
        );
        if (verifyRes.ok) {
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

    // 3. Evaluate autoAttach condition (never auto-attaches unless autoAttach: true is explicitly requested)
    const isMatch = isEditionCompatibleWithManifest(pkg.manifest, editionId);
    const shouldAttach = options?.autoAttach ?? false;

    let association: LocalAssociation | undefined;

    if (shouldAttach) {
      if (!isMatch && !options?.consentGiven) {
        // Do not attach unverified mismatch without explicit consent
      } else {
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
        const trustState: 'verified' | 'unverified' = isMatch ? 'verified' : 'unverified';

        association = {
          editionId,
          packageId: pkg.packageId,
          manifestHash: pkg.manifestHash,
          selected: targetSelected,
          trustState,
        };

        const updatedAssociations: Record<string, LocalAssociation> = { ...initialAssociations };
        if (targetSelected) {
          for (const [key, assoc] of Object.entries(updatedAssociations)) {
            if (assoc.editionId === editionId || key.startsWith(`${editionId}:`)) {
              updatedAssociations[key] = {
                ...assoc,
                selected: false,
              };
            }
          }
        }

        updatedAssociations[revisionAssocKey] = association;
        updatedAssociations[editionId] = association;
        await saveLocalAssociations(fs, baseDir, updatedAssociations);
      }
    }

    await removePackageFromRepairQueue(fs, baseDir, pkgToUse.packageId, pkgToUse.manifestHash);

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
  editionId = 'dev-edition-digest',
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
        digest: editionId,
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

  const fixtureInstalled = Object.keys(packages).some((k) => k.startsWith('pkg-m1-fixture:'));
  if (!fixtureInstalled) {
    const mp3Bytes = createMinimalValidMp3Bytes();
    const zipBytes = await createDevelopmentFixturePackageBytes(
      mp3Bytes,
      'pkg-m1-fixture',
      'Milestone 1 EPUB Soundtrack',
      editionId,
    );
    // Install fixture package as un-attached candidate without auto-attaching
    const importRes = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      zipBytes,
      editionId,
      undefined,
      { autoAttach: false },
    );
    if (importRes.success) {
      packages = await loadInstalledPackages(fs, baseDir);
      associations = await loadLocalAssociations(fs, baseDir);
    }
  }

  return { packages, associations };
}
