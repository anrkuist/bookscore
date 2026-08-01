import {
  InstalledPackage,
  SoundtrackAsset,
  SoundtrackCue,
  SoundtrackPackageManifest,
} from './types';

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  package?: InstalledPackage;
};

export type ArchiveValidationResult = ValidationResult & {
  assetFiles?: Map<string, Uint8Array>;
};

export type AudioDecoderFn = (audioBytes: Uint8Array) => Promise<{ durationSec: number }>;

export async function defaultAudioDecoder(
  audioBytes: Uint8Array,
): Promise<{ durationSec: number }> {
  if (typeof window === 'undefined') {
    return { durationSec: 60 };
  }
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return { durationSec: 60 };
  const ctx = new AudioCtx();
  try {
    const buffer = await ctx.decodeAudioData(
      audioBytes.buffer.slice(
        audioBytes.byteOffset,
        audioBytes.byteOffset + audioBytes.byteLength,
      ) as ArrayBuffer,
    );
    const durationSec = buffer.duration;
    await ctx.close();
    return { durationSec };
  } catch (err) {
    try {
      await ctx.close();
    } catch (_) {}
    throw new Error(`Audio decode failed: ${err}`);
  }
}

export async function sha256Hex(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const hashBuffer = await crypto.subtle.digest('SHA-256', view.buffer as ArrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validateAsset(asset: unknown): { valid: boolean; error?: string } {
  if (!asset || typeof asset !== 'object') {
    return { valid: false, error: 'Asset must be an object' };
  }
  const a = asset as Partial<SoundtrackAsset>;
  if (!a.id || typeof a.id !== 'string') return { valid: false, error: 'Asset missing id' };
  if (!a.path || typeof a.path !== 'string')
    return { valid: false, error: `Asset ${a.id} missing path` };
  if (a.mimeType !== 'audio/mpeg')
    return { valid: false, error: `Asset ${a.id} mimeType must be audio/mpeg` };
  if (!a.hash || typeof a.hash !== 'string')
    return { valid: false, error: `Asset ${a.id} missing hash` };
  if (typeof a.durationSec !== 'number' || !Number.isFinite(a.durationSec) || a.durationSec <= 0) {
    return { valid: false, error: `Asset ${a.id} durationSec must be a positive finite number` };
  }
  return { valid: true };
}

export function validateCue(
  cue: unknown,
  assetsMap: Map<string, SoundtrackAsset>,
): { valid: boolean; error?: string } {
  if (!cue || typeof cue !== 'object') {
    return { valid: false, error: 'Cue must be an object' };
  }
  const c = cue as Partial<SoundtrackCue>;
  if (!c.id || typeof c.id !== 'string') return { valid: false, error: 'Cue missing id' };
  if (!c.startCfi || typeof c.startCfi !== 'string')
    return { valid: false, error: `Cue ${c.id} missing startCfi` };
  if (c.type !== 'audio' && c.type !== 'silence') {
    return { valid: false, error: `Cue ${c.id} type must be 'audio' or 'silence'` };
  }

  if (c.type === 'audio') {
    if (!c.assetId || typeof c.assetId !== 'string') {
      return { valid: false, error: `Audio cue ${c.id} missing assetId` };
    }
    const asset = assetsMap.get(c.assetId);
    if (!asset) {
      return {
        valid: false,
        error: `Audio cue ${c.id} references non-existent assetId ${c.assetId}`,
      };
    }
    if (typeof c.startSec !== 'number' || c.startSec < 0) {
      return { valid: false, error: `Audio cue ${c.id} startSec must be >= 0` };
    }
    if (typeof c.loopStartSec !== 'number' || c.loopStartSec < c.startSec) {
      return { valid: false, error: `Audio cue ${c.id} loopStartSec must be >= startSec` };
    }
    if (typeof c.loopEndSec !== 'number' || c.loopEndSec <= c.loopStartSec) {
      return { valid: false, error: `Audio cue ${c.id} loopEndSec must be > loopStartSec` };
    }
    if (c.loopEndSec > asset.durationSec) {
      return {
        valid: false,
        error: `Audio cue ${c.id} loopEndSec (${c.loopEndSec}) exceeds asset duration (${asset.durationSec})`,
      };
    }
    if (typeof c.volume !== 'number' || c.volume < 0 || c.volume > 1) {
      return { valid: false, error: `Audio cue ${c.id} volume must be between 0 and 1` };
    }
    if (typeof c.crossfadeSec !== 'number' || c.crossfadeSec < 0) {
      return { valid: false, error: `Audio cue ${c.id} crossfadeSec must be >= 0` };
    }
  }

  return { valid: true };
}

export function validatePackageManifest(manifestRaw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!manifestRaw || typeof manifestRaw !== 'object') {
    return { valid: false, errors: ['Manifest must be a non-null object'] };
  }

  const manifest = manifestRaw as Partial<SoundtrackPackageManifest>;

  if (!manifest.packageId || typeof manifest.packageId !== 'string') {
    errors.push('Missing packageId');
  }
  if (!manifest.title || typeof manifest.title !== 'string') {
    errors.push('Missing title');
  }
  if (typeof manifest.version !== 'number' || manifest.version < 1) {
    errors.push('Invalid or missing version');
  }
  if (!manifest.manifestHash || typeof manifest.manifestHash !== 'string') {
    errors.push('Missing manifestHash');
  }

  if (!Array.isArray(manifest.editionCompatibility) || manifest.editionCompatibility.length === 0) {
    errors.push('editionCompatibility must be a non-empty array');
  } else {
    for (const [idx, comp] of manifest.editionCompatibility.entries()) {
      if (
        !comp.algorithm ||
        (comp.algorithm !== 'readest-partial-md5-v1' && comp.algorithm !== 'sha256-v1')
      ) {
        errors.push(`editionCompatibility[${idx}] unsupported algorithm ${comp.algorithm}`);
      }
      if (!comp.digest || typeof comp.digest !== 'string') {
        errors.push(`editionCompatibility[${idx}] missing digest`);
      }
      if (typeof comp.epubByteLength !== 'number' || comp.epubByteLength <= 0) {
        errors.push(`editionCompatibility[${idx}] epubByteLength must be > 0`);
      }
    }
  }

  const assetsMap = new Map<string, SoundtrackAsset>();
  if (!Array.isArray(manifest.assets)) {
    errors.push('assets must be an array');
  } else {
    for (const assetRaw of manifest.assets) {
      const res = validateAsset(assetRaw);
      if (!res.valid && res.error) {
        errors.push(res.error);
      } else {
        const asset = assetRaw as SoundtrackAsset;
        assetsMap.set(asset.id, asset);
      }
    }
  }

  if (!Array.isArray(manifest.cues) || manifest.cues.length === 0) {
    errors.push('cues must be a non-empty array');
  } else {
    for (const cueRaw of manifest.cues) {
      const res = validateCue(cueRaw, assetsMap);
      if (!res.valid && res.error) {
        errors.push(res.error);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const validManifest = manifest as SoundtrackPackageManifest;

  const installedPkg: InstalledPackage = {
    packageId: validManifest.packageId,
    manifestHash: validManifest.manifestHash,
    manifest: validManifest,
    installedAt: Date.now(),
  };

  return {
    valid: true,
    errors: [],
    package: installedPkg,
  };
}

type EntryWithGetData = {
  filename: string;
  directory?: boolean;
  getData: (writer: unknown) => Promise<unknown>;
};

/**
 * Validates a .bookscore ZIP archive by inspecting archive entries,
 * enforcing path safety, verifying manifest syntax/semantics, asset file presence,
 * checking SHA-256 checksums, and runtime-decoding asset audio files.
 */
export async function validateBookScorePackageArchive(
  archiveBytes: Uint8Array,
  audioDecoder: AudioDecoderFn = defaultAudioDecoder,
): Promise<ArchiveValidationResult> {
  const errors: string[] = [];
  try {
    const { ZipReader, Uint8ArrayReader, TextWriter, Uint8ArrayWriter } = await import(
      '@zip.js/zip.js'
    );
    const reader = new ZipReader(new Uint8ArrayReader(archiveBytes));
    const entries = (await reader.getEntries()) as unknown as EntryWithGetData[];

    // Check path safety across all entries
    for (const entry of entries) {
      const path = entry.filename;
      if (path.includes('..') || path.startsWith('/') || path.includes('\\')) {
        await reader.close();
        return { valid: false, errors: [`Unsafe ZIP entry path: ${path}`] };
      }
    }

    const manifestEntry = entries.find(
      (e) =>
        (e.filename === 'manifest.json' || e.filename.endsWith('/manifest.json')) &&
        typeof e.getData === 'function',
    );
    if (!manifestEntry) {
      await reader.close();
      return { valid: false, errors: ['manifest.json missing from package archive'] };
    }

    const manifestWriter = new TextWriter();
    const manifestText = (await manifestEntry.getData(manifestWriter)) as string;

    let manifestRaw: Partial<SoundtrackPackageManifest>;
    try {
      manifestRaw = JSON.parse(manifestText);
    } catch (parseError) {
      await reader.close();
      return { valid: false, errors: [`Invalid manifest JSON: ${parseError}`] };
    }

    // Canonical manifest hash calculation by stripping manifestHash key
    const manifestCopy = { ...manifestRaw };
    delete manifestCopy.manifestHash;
    const encoder = new TextEncoder();
    const computedManifestHash = await sha256Hex(encoder.encode(JSON.stringify(manifestCopy)));

    if (
      manifestRaw.manifestHash &&
      manifestRaw.manifestHash !== '' &&
      manifestRaw.manifestHash.toLowerCase() !== computedManifestHash.toLowerCase()
    ) {
      await reader.close();
      return {
        valid: false,
        errors: [
          `Manifest hash mismatch (declared ${manifestRaw.manifestHash}, computed ${computedManifestHash})`,
        ],
      };
    }

    manifestRaw.manifestHash = computedManifestHash;

    const manifestValidation = validatePackageManifest(manifestRaw);
    if (!manifestValidation.valid || !manifestValidation.package) {
      await reader.close();
      return manifestValidation;
    }

    const validManifest = manifestValidation.package.manifest;
    const extractedAssetFiles = new Map<string, Uint8Array>();

    for (const asset of validManifest.assets) {
      const assetEntry = entries.find(
        (e) =>
          (e.filename === asset.path ||
            e.filename.endsWith(`/${asset.path}`) ||
            e.filename === `audio/${asset.id}.mp3`) &&
          typeof e.getData === 'function',
      );
      if (!assetEntry) {
        errors.push(`Asset ${asset.id} file ${asset.path} missing from package archive`);
        continue;
      }

      const assetWriter = new Uint8ArrayWriter();
      const assetBytes = (await assetEntry.getData(assetWriter)) as Uint8Array;
      const computedAssetHash = await sha256Hex(assetBytes);

      if (computedAssetHash.toLowerCase() !== asset.hash.toLowerCase()) {
        errors.push(
          `Asset ${asset.id} SHA-256 hash mismatch (expected ${asset.hash}, got ${computedAssetHash})`,
        );
        continue;
      }

      // Runtime audio decoding & duration bounds verification
      try {
        const decoded = await audioDecoder(assetBytes);
        if (!decoded || typeof decoded.durationSec !== 'number' || decoded.durationSec <= 0) {
          errors.push(`Asset ${asset.id} decoded duration is invalid`);
          continue;
        }

        if (Math.abs(decoded.durationSec - asset.durationSec) > 1.0) {
          errors.push(
            `Asset ${asset.id} decoded duration (${decoded.durationSec.toFixed(1)}s) does not match declared asset duration (${asset.durationSec}s)`,
          );
          continue;
        }

        for (const cue of validManifest.cues) {
          if (cue.type === 'audio' && cue.assetId === asset.id) {
            if (cue.loopEndSec > decoded.durationSec) {
              errors.push(
                `Audio cue ${cue.id} loopEndSec (${cue.loopEndSec}s) exceeds decoded asset duration (${decoded.durationSec.toFixed(1)}s)`,
              );
            }
          }
        }
      } catch (decodeErr) {
        errors.push(`Asset ${asset.id} runtime audio decoding failed: ${decodeErr}`);
        continue;
      }

      extractedAssetFiles.set(asset.id, assetBytes);
    }

    await reader.close();

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return {
      valid: true,
      errors: [],
      package: manifestValidation.package,
      assetFiles: extractedAssetFiles,
    };
  } catch (err) {
    return { valid: false, errors: [`Failed to read package archive: ${err}`] };
  }
}
