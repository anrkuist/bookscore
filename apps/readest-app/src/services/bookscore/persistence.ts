import { safeLoadJSON, safeSaveJSON } from '@/services/persistence';
import { BaseDir, FileSystem } from '@/types/system';
import { InstalledPackage, LocalAssociation, RepairQueueItem, StoredRepairQueueMap } from './types';
import { validatePackageManifest } from './packageValidation';

export const PACKAGES_FILENAME = 'soundtrack_packages.json';
export const ASSOCIATIONS_FILENAME = 'soundtrack_associations.json';
export const REPAIR_QUEUE_FILENAME = 'soundtrack_repair_queue.json';

export type StoredPackagesMap = Record<string, InstalledPackage>;
export type StoredAssociationsMap = Record<string, LocalAssociation>;

/**
 * Loads all installed soundtrack packages from persistent JSON storage using safeLoadJSON.
 * Performs package validation on loaded packages to ensure integrity.
 */
export async function loadInstalledPackages(
  fs: FileSystem,
  baseDir: BaseDir,
): Promise<StoredPackagesMap> {
  const rawData = await safeLoadJSON<Record<string, unknown>>(fs, PACKAGES_FILENAME, baseDir, {});

  const validatedMap: StoredPackagesMap = {};
  for (const [key, pkgRaw] of Object.entries(rawData)) {
    if (pkgRaw && typeof pkgRaw === 'object' && 'manifest' in pkgRaw) {
      const manifest = (pkgRaw as { manifest: unknown }).manifest;
      const res = validatePackageManifest(manifest);
      if (res.valid && res.package) {
        validatedMap[key] = {
          ...res.package,
          installedAt: (pkgRaw as { installedAt?: number }).installedAt ?? res.package.installedAt,
        };
      }
    }
  }

  return validatedMap;
}

/**
 * Saves all installed packages to persistent JSON storage using safeSaveJSON.
 */
export async function saveInstalledPackages(
  fs: FileSystem,
  baseDir: BaseDir,
  packages: StoredPackagesMap,
): Promise<void> {
  await safeSaveJSON(fs, PACKAGES_FILENAME, baseDir, packages);
}

/**
 * Loads local soundtrack associations from persistent JSON storage using safeLoadJSON.
 */
export async function loadLocalAssociations(
  fs: FileSystem,
  baseDir: BaseDir,
): Promise<StoredAssociationsMap> {
  return safeLoadJSON<StoredAssociationsMap>(fs, ASSOCIATIONS_FILENAME, baseDir, {});
}

/**
 * Saves local soundtrack associations to persistent JSON storage using safeSaveJSON.
 */
export async function saveLocalAssociations(
  fs: FileSystem,
  baseDir: BaseDir,
  associations: StoredAssociationsMap,
): Promise<void> {
  await safeSaveJSON(fs, ASSOCIATIONS_FILENAME, baseDir, associations);
}

/**
 * Loads the Soundtrack Repair Queue from persistent JSON storage.
 */
export async function loadRepairQueue(
  fs: FileSystem,
  baseDir: BaseDir,
): Promise<StoredRepairQueueMap> {
  return safeLoadJSON<StoredRepairQueueMap>(fs, REPAIR_QUEUE_FILENAME, baseDir, {});
}

/**
 * Saves the Soundtrack Repair Queue to persistent JSON storage.
 */
export async function saveRepairQueue(
  fs: FileSystem,
  baseDir: BaseDir,
  queue: StoredRepairQueueMap,
): Promise<void> {
  await safeSaveJSON(fs, REPAIR_QUEUE_FILENAME, baseDir, queue);
}

/**
 * Records or updates a package failure entry in the Soundtrack Repair Queue.
 */
export async function recordPackageRepairFailure(
  fs: FileSystem,
  baseDir: BaseDir,
  item: RepairQueueItem,
): Promise<StoredRepairQueueMap> {
  try {
    if (!fs || typeof fs.writeFile !== 'function') {
      return {};
    }
    const currentQueue = await loadRepairQueue(fs, baseDir);
    const key = `${item.packageId}:${item.manifestHash}`;
    const updated = {
      ...currentQueue,
      [key]: item,
    };
    await saveRepairQueue(fs, baseDir, updated);
    return updated;
  } catch (err) {
    console.warn('Failed to record package repair failure:', err);
    return {};
  }
}

/**
 * Removes a package entry from the Soundtrack Repair Queue upon repair or package removal.
 */
export async function removePackageFromRepairQueue(
  fs: FileSystem,
  baseDir: BaseDir,
  packageId: string,
  manifestHash: string,
): Promise<StoredRepairQueueMap> {
  try {
    if (!fs || typeof fs.writeFile !== 'function') {
      return {};
    }
    const currentQueue = await loadRepairQueue(fs, baseDir);
    const key = `${packageId}:${manifestHash}`;
    if (!currentQueue[key] && !currentQueue[packageId]) {
      return currentQueue;
    }
    const updated = { ...currentQueue };
    delete updated[key];
    delete updated[packageId];
    await saveRepairQueue(fs, baseDir, updated);
    return updated;
  } catch (err) {
    console.warn('Failed to remove package from repair queue:', err);
    return {};
  }
}
