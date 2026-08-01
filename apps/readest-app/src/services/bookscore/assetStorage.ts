import { BaseDir, FileSystem } from '@/types/system';

export function getAssetFilePath(packageId: string, assetId: string): string {
  return `soundtracks/${packageId}/${assetId}.mp3`;
}

/**
 * Persists an asset audio file to app storage as binary data without string/UTF-8 corruption.
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
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    await fs.writeFile(path, baseDir, arrayBuffer);
    return path;
  } catch (err) {
    console.error(`Failed to save soundtrack asset file ${path}:`, err);
    throw err;
  }
}

/**
 * Loads an asset audio file from app storage as an ArrayBuffer in binary mode.
 */
export async function loadSoundtrackAssetFile(
  fs: FileSystem,
  baseDir: BaseDir,
  packageId: string,
  assetId: string,
): Promise<ArrayBuffer | null> {
  const path = getAssetFilePath(packageId, assetId);
  try {
    const data = await fs.readFile(path, baseDir, 'binary');
    if (!data) return null;

    if (data instanceof ArrayBuffer || data?.constructor?.name === 'ArrayBuffer') {
      return data as ArrayBuffer;
    }

    if (
      ArrayBuffer.isView(data) ||
      (typeof data === 'object' && data !== null && 'buffer' in data)
    ) {
      const view = data as unknown as {
        buffer: ArrayBuffer;
        byteOffset?: number;
        byteLength?: number;
      };
      const offset = view.byteOffset ?? 0;
      const length = view.byteLength ?? view.buffer.byteLength;
      return view.buffer.slice(offset, offset + length);
    }

    if (typeof data === 'string') {
      const len = data.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = data.charCodeAt(i) & 0xff;
      }
      return bytes.buffer;
    }

    return null;
  } catch (err) {
    console.info(`Soundtrack asset file ${path} not found or unreadable:`, err);
    return null;
  }
}
