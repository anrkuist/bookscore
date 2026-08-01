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
