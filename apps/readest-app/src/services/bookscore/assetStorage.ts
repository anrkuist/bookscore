import { BaseDir, FileSystem } from '@/types/system';

export function getAssetFilePath(
  packageId: string,
  assetId: string,
  manifestHash?: string,
): string {
  if (manifestHash && manifestHash.trim() !== '') {
    return `soundtracks/${packageId}/${manifestHash}/${assetId}.mp3`;
  }
  return `soundtracks/${packageId}/${assetId}.mp3`;
}

/**
 * Persists an asset audio file to app storage as binary data without string/UTF-8 corruption.
 * Namespaces asset files by revision manifestHash when supplied.
 */
export async function saveSoundtrackAssetFile(
  fs: FileSystem,
  baseDir: BaseDir,
  packageId: string,
  assetId: string,
  bytes: Uint8Array,
  manifestHash?: string,
): Promise<string> {
  const path = getAssetFilePath(packageId, assetId, manifestHash);
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
 * Tries revision-namespaced path first, then falls back to legacy package path.
 */
export async function loadSoundtrackAssetFile(
  fs: FileSystem,
  baseDir: BaseDir,
  packageId: string,
  assetId: string,
  manifestHash?: string,
): Promise<ArrayBuffer | null> {
  const pathsToTry: string[] = [];
  if (manifestHash && manifestHash.trim() !== '') {
    pathsToTry.push(getAssetFilePath(packageId, assetId, manifestHash));
  }
  pathsToTry.push(getAssetFilePath(packageId, assetId));

  for (const path of pathsToTry) {
    try {
      const data = await fs.readFile(path, baseDir, 'binary');
      if (!data) continue;

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
    } catch (_) {
      // Try next path
    }
  }

  return null;
}

export type AssetVerificationResult = {
  ok: boolean;
  reason?: import('./types').RepairFailureReason;
  buffer?: ArrayBuffer;
};

/**
 * Loads and verifies a soundtrack asset file from storage against expected hash and readability.
 */
export async function verifySoundtrackAsset(
  fs: FileSystem,
  baseDir: BaseDir,
  packageId: string,
  assetId: string,
  manifestHash?: string,
  expectedHash?: string,
): Promise<AssetVerificationResult> {
  const buffer = await loadSoundtrackAssetFile(fs, baseDir, packageId, assetId, manifestHash);
  if (!buffer) {
    return { ok: false, reason: 'missing' };
  }
  if (buffer.byteLength === 0) {
    return { ok: false, reason: 'unreadable' };
  }

  if (expectedHash && expectedHash.trim() !== '') {
    const { sha256Hex } = await import('./packageValidation');
    const bytes = new Uint8Array(buffer);
    const computedHash = await sha256Hex(bytes);
    if (computedHash.toLowerCase() !== expectedHash.toLowerCase()) {
      return { ok: false, reason: 'corrupt', buffer };
    }
  }

  return { ok: true, buffer };
}
