import { BaseDir, FileSystem } from '@/types/system';
import { loadSoundtrackAssetFile } from './assetStorage';
import { loadInstalledPackages } from './persistence';
import { SoundtrackPackageManifest } from './types';

export type ExportBookScorePackageResult =
  | { success: true; archiveBytes: Uint8Array }
  | { success: false; error: string };

/**
 * Exports an installed BookScore package revision as a portable self-contained .bookscore ZIP.
 *
 * The archive contains:
 *   - manifest.json  (all declared fields: packageId, title, version, manifestHash,
 *                     editionCompatibility, assets, cues — ordered as stored)
 *   - audio/<assetId>.mp3  (one file per asset, binary-exact)
 *
 * Local-only fields that do NOT travel:
 *   - LocalAssociation (selected, trustState, editionId)
 *   - active selection / mismatch consent
 *   - InstalledPackage.installedAt
 */
export async function exportBookScorePackage(
  fs: FileSystem,
  baseDir: BaseDir,
  packageId: string,
  manifestHash: string,
): Promise<ExportBookScorePackageResult> {
  const packages = await loadInstalledPackages(fs, baseDir);
  const pkgKey = `${packageId}:${manifestHash}`;
  const pkg = packages[pkgKey];

  if (!pkg) {
    return { success: false, error: `Package revision ${pkgKey} not installed` };
  }

  const manifest: SoundtrackPackageManifest = pkg.manifest;

  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } = await import(
    '@zip.js/zip.js'
  );

  const zipWriter = new ZipWriter(new Uint8ArrayWriter());

  // Write manifest — all declared fields, no local-only fields
  const manifestJson = JSON.stringify(manifest);
  await zipWriter.add('manifest.json', new TextReader(manifestJson));

  // Write each asset binary, namespaced by assetId so the import path finder matches
  for (const asset of manifest.assets) {
    const audioData = await loadSoundtrackAssetFile(fs, baseDir, packageId, asset.id, manifestHash);

    if (!audioData || audioData.byteLength === 0) {
      await zipWriter.close();
      return {
        success: false,
        error: `Asset ${asset.id} not found in storage for package ${pkgKey}`,
      };
    }

    const assetBytes = new Uint8Array(audioData);
    // Use the path declared in the manifest so validateBookScorePackageArchive can locate it
    await zipWriter.add(asset.path, new Uint8ArrayReader(assetBytes));
  }

  const archiveBytes = await zipWriter.close();
  return { success: true, archiveBytes };
}
