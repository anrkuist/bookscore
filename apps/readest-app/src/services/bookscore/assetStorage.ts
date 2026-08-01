import { BaseDir, FileSystem } from '@/types/system';

export function getAssetFilePath(packageId: string, assetId: string): string {
  return `soundtracks/${packageId}/${assetId}.mp3`;
}

/**
 * Persists an asset audio file to app storage.
 */
export async function saveSoundtrackAssetFile(
  fs: FileSystem,
  baseDir: BaseDir,
  packageId: string,
  assetId: string,
  bytes: Uint8Array,
): Promise<string> {
  const path = getAssetFilePath(packageId, assetId);
  try {
    // Write array buffer / bytes to storage file
    const binaryString = String.fromCharCode(...bytes);
    await fs.writeFile(path, baseDir, binaryString);
    return path;
  } catch (err) {
    console.error(`Failed to save soundtrack asset file ${path}:`, err);
    throw err;
  }
}

/**
 * Loads an asset audio file from app storage as an ArrayBuffer.
 */
export async function loadSoundtrackAssetFile(
  fs: FileSystem,
  baseDir: BaseDir,
  packageId: string,
  assetId: string,
): Promise<ArrayBuffer | null> {
  const path = getAssetFilePath(packageId, assetId);
  try {
    const data = await fs.readFile(path, baseDir, 'text');
    if (!data || typeof data !== 'string') return null;
    const len = data.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = data.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (err) {
    console.info(`Soundtrack asset file ${path} not found or unreadable:`, err);
    return null;
  }
}
