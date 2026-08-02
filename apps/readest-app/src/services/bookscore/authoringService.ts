import { BaseDir, FileSystem } from '@/types/system';
import { sha256Hex } from './packageValidation';
import { loadSoundtrackAssetFile } from './assetStorage';
import { loadInstalledPackages } from './persistence';
import {
  AudioCue,
  EditableCopy,
  EditableCopyValidationResult,
  CueValidationIssue,
  SoundtrackCue,
  SoundtrackPackageManifest,
  SoundtrackAsset,
} from './types';

// ---------------------------------------------------------------------------
// makeEditableCopy
// ---------------------------------------------------------------------------

export type MakeEditableCopyResult =
  | { success: true; copy: EditableCopy }
  | { success: false; error: string };

/**
 * Creates a self-contained EditableCopy from an installed package revision.
 * All required MP3 bytes are read from app storage and embedded in the copy
 * so the copy remains usable even after the source package is removed.
 */
export async function makeEditableCopy(
  fs: FileSystem,
  baseDir: BaseDir,
  packageId: string,
  manifestHash: string,
  editionId: string,
): Promise<MakeEditableCopyResult> {
  const packages = await loadInstalledPackages(fs, baseDir);
  const pkgKey = `${packageId}:${manifestHash}`;
  const pkg = packages[pkgKey];

  if (!pkg) {
    return { success: false, error: `Package revision ${pkgKey} not installed` };
  }

  // Deep-copy manifest so mutations don't affect the installed record
  const manifestCopy: SoundtrackPackageManifest = JSON.parse(
    JSON.stringify(pkg.manifest),
  ) as SoundtrackPackageManifest;

  // Assign a new unique packageId for the copy so it can be exported independently
  const copyId = `editable-${packageId}-${Date.now()}`;
  manifestCopy.packageId = copyId;
  // version and editionCompatibility intentionally retained from source

  // Read all asset bytes from storage into the copy
  const assetBytes: Record<string, Uint8Array> = {};
  for (const asset of manifestCopy.assets) {
    const buf = await loadSoundtrackAssetFile(fs, baseDir, packageId, asset.id, manifestHash);
    if (!buf || buf.byteLength === 0) {
      return {
        success: false,
        error: `Asset ${asset.id} could not be read from storage for package ${pkgKey}`,
      };
    }
    assetBytes[asset.id] = new Uint8Array(buf);
  }

  const now = Date.now();
  const copy: EditableCopy = {
    copyId,
    sourcePackageId: packageId,
    sourceManifestHash: manifestHash,
    editionId,
    manifest: manifestCopy,
    assetBytes,
    createdAt: now,
    modifiedAt: now,
  };

  return { success: true, copy };
}

// ---------------------------------------------------------------------------
// Cue CRUD – add / edit / remove / reorder
// All mutations return a new EditableCopy (immutable update pattern)
// ---------------------------------------------------------------------------

/** Adds a new cue anchored to the given CFI.  The cue is inserted in startCfi order. */
export function addCueAtCfi(copy: EditableCopy, cue: SoundtrackCue): EditableCopy {
  const cues = [...copy.manifest.cues, cue].sort((a, b) =>
    compareCfiSimple(a.startCfi, b.startCfi),
  );
  return {
    ...copy,
    manifest: { ...copy.manifest, cues },
    modifiedAt: Date.now(),
  };
}

/** Replaces an existing cue by id. */
export function editCue(copy: EditableCopy, updatedCue: SoundtrackCue): EditableCopy {
  const cues = copy.manifest.cues
    .map((c) => (c.id === updatedCue.id ? updatedCue : c))
    .sort((a, b) => compareCfiSimple(a.startCfi, b.startCfi));
  return {
    ...copy,
    manifest: { ...copy.manifest, cues },
    modifiedAt: Date.now(),
  };
}

/** Removes a cue by id. */
export function removeCue(copy: EditableCopy, cueId: string): EditableCopy {
  const cues = copy.manifest.cues.filter((c) => c.id !== cueId);
  return {
    ...copy,
    manifest: { ...copy.manifest, cues },
    modifiedAt: Date.now(),
  };
}

/**
 * Reorders a cue: moves it to the position of `targetCueId` (shifting others down).
 * The resulting list is then re-sorted by startCfi so CFI order is always canonical.
 */
export function reorderCue(copy: EditableCopy, cueId: string, targetIndex: number): EditableCopy {
  const cues = [...copy.manifest.cues];
  const fromIdx = cues.findIndex((c) => c.id === cueId);
  if (fromIdx === -1) return copy;
  const [moved] = cues.splice(fromIdx, 1);
  if (!moved) return copy;
  const clampedTarget = Math.max(0, Math.min(targetIndex, cues.length));
  cues.splice(clampedTarget, 0, moved);
  // Re-sort by startCfi to maintain canonical order
  const sorted = cues.sort((a, b) => compareCfiSimple(a.startCfi, b.startCfi));
  return {
    ...copy,
    manifest: { ...copy.manifest, cues: sorted },
    modifiedAt: Date.now(),
  };
}

/** Updates the title / metadata of the copy's manifest. */
export function updateCopyTitle(copy: EditableCopy, title: string): EditableCopy {
  return {
    ...copy,
    manifest: { ...copy.manifest, title },
    modifiedAt: Date.now(),
  };
}

/** Adds or replaces an audio asset in the copy along with its raw MP3 bytes. */
export function addAssetToCopy(
  copy: EditableCopy,
  asset: SoundtrackAsset,
  bytes: Uint8Array,
): EditableCopy {
  const existingAssets = copy.manifest.assets.filter((a) => a.id !== asset.id);
  const updatedAssets = [...existingAssets, asset];
  return {
    ...copy,
    manifest: {
      ...copy.manifest,
      assets: updatedAssets,
    },
    assetBytes: {
      ...copy.assetBytes,
      [asset.id]: bytes,
    },
    modifiedAt: Date.now(),
  };
}

/** Removes an asset and its binary bytes from the copy. */
export function removeAssetFromCopy(copy: EditableCopy, assetId: string): EditableCopy {
  const updatedAssets = copy.manifest.assets.filter((a) => a.id !== assetId);
  const nextAssetBytes = { ...copy.assetBytes };
  delete nextAssetBytes[assetId];
  return {
    ...copy,
    manifest: {
      ...copy.manifest,
      assets: updatedAssets,
    },
    assetBytes: nextAssetBytes,
    modifiedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Preview helper
// ---------------------------------------------------------------------------

export type PreviewCueResult = { audioData: ArrayBuffer; cue: AudioCue } | null;

/**
 * Resolves the MP3 bytes for a cue from the embedded copy assets, ready for
 * the player's playCue().  Returns null when the cue is silence or the asset
 * is missing (non-fatal – caller decides how to surface this).
 */
export function resolvePreviewAsset(copy: EditableCopy, cue: SoundtrackCue): PreviewCueResult {
  if (cue.type !== 'audio') return null;
  const bytes = copy.assetBytes[cue.assetId];
  if (!bytes || bytes.byteLength === 0) return null;

  // Slice to detached ArrayBuffer so the player can decode without sharing
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { audioData: buf as ArrayBuffer, cue };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates an EditableCopy for export readiness.
 * Issues are categorised as 'error' (blocks export) or 'warning' (informational).
 * This function NEVER blocks reading — only export should check `result.valid`.
 */
export function validateEditableCopy(copy: EditableCopy): EditableCopyValidationResult {
  const issues: CueValidationIssue[] = [];

  // 1. Must have at least one cue
  if (copy.manifest.cues.length === 0) {
    issues.push({ severity: 'error', message: 'Soundtrack must have at least one cue.' });
  }

  // 2. Every asset referenced by an audio cue must have bytes
  const assetIds = new Set(copy.manifest.assets.map((a) => a.id));
  for (const cue of copy.manifest.cues) {
    if (cue.type !== 'audio') continue;

    if (!assetIds.has(cue.assetId)) {
      issues.push({
        severity: 'error',
        cueId: cue.id,
        assetId: cue.assetId,
        message: `Cue "${cue.id}" references asset "${cue.assetId}" which is not declared in the manifest.`,
      });
      continue;
    }

    const bytes = copy.assetBytes[cue.assetId];
    if (!bytes || bytes.byteLength === 0) {
      issues.push({
        severity: 'error',
        cueId: cue.id,
        assetId: cue.assetId,
        message: `Asset "${cue.assetId}" used by cue "${cue.id}" has no audio data.`,
      });
    }
  }

  // 3. Every declared asset must have bytes AND be referenced by at least one cue
  //    (warn; orphaned assets and assets without bytes don't block export)
  const referencedAssetIds = new Set(
    copy.manifest.cues.filter((c): c is AudioCue => c.type === 'audio').map((c) => c.assetId),
  );
  for (const asset of copy.manifest.assets) {
    const bytes = copy.assetBytes[asset.id];
    if (!bytes || bytes.byteLength === 0) {
      issues.push({
        severity: 'warning',
        assetId: asset.id,
        message: `Asset "${asset.id}" ("${asset.path}") is declared but has no audio data.`,
      });
    } else if (!referencedAssetIds.has(asset.id)) {
      issues.push({
        severity: 'warning',
        assetId: asset.id,
        message: `Asset "${asset.id}" is declared but not referenced by any cue (orphaned).`,
      });
    }
  }

  // 4. Audio cue start/loop/crossfade/volume sanity & asset duration alignment
  const assetsMap = new Map<string, SoundtrackAsset>(copy.manifest.assets.map((a) => [a.id, a]));

  for (const cue of copy.manifest.cues) {
    if (cue.type !== 'audio') continue;

    if (typeof cue.startSec !== 'number' || !Number.isFinite(cue.startSec) || cue.startSec < 0) {
      issues.push({
        severity: 'error',
        cueId: cue.id,
        message: `Cue "${cue.id}" startSec must be a finite number >= 0.`,
      });
    }
    if (
      typeof cue.loopStartSec !== 'number' ||
      !Number.isFinite(cue.loopStartSec) ||
      (typeof cue.startSec === 'number' && cue.loopStartSec < cue.startSec)
    ) {
      issues.push({
        severity: 'error',
        cueId: cue.id,
        message: `Cue "${cue.id}" loopStartSec must be a finite number >= startSec.`,
      });
    }
    if (
      typeof cue.loopEndSec !== 'number' ||
      !Number.isFinite(cue.loopEndSec) ||
      (typeof cue.loopStartSec === 'number' && cue.loopEndSec <= cue.loopStartSec)
    ) {
      issues.push({
        severity: 'error',
        cueId: cue.id,
        message: `Cue "${cue.id}" loopEndSec must be a finite number > loopStartSec.`,
      });
    }

    const asset = assetsMap.get(cue.assetId);
    if (
      asset &&
      typeof asset.durationSec === 'number' &&
      typeof cue.loopEndSec === 'number' &&
      cue.loopEndSec > asset.durationSec
    ) {
      issues.push({
        severity: 'error',
        cueId: cue.id,
        assetId: cue.assetId,
        message: `Cue "${cue.id}" loopEndSec (${cue.loopEndSec}s) exceeds asset duration (${asset.durationSec}s).`,
      });
    }

    if (
      typeof cue.volume !== 'number' ||
      !Number.isFinite(cue.volume) ||
      cue.volume < 0 ||
      cue.volume > 1
    ) {
      issues.push({
        severity: 'error',
        cueId: cue.id,
        message: `Cue "${cue.id}" volume must be a finite number between 0 and 1 (got ${cue.volume}).`,
      });
    }

    if (
      typeof cue.crossfadeSec !== 'number' ||
      !Number.isFinite(cue.crossfadeSec) ||
      cue.crossfadeSec < 0
    ) {
      issues.push({
        severity: 'error',
        cueId: cue.id,
        message: `Cue "${cue.id}" crossfadeSec must be a finite number >= 0.`,
      });
    }
  }

  // 5. Warn on duplicate startCfi values
  const cfiSeen = new Set<string>();
  for (const cue of copy.manifest.cues) {
    if (cfiSeen.has(cue.startCfi)) {
      issues.push({
        severity: 'warning',
        cueId: cue.id,
        message: `Cue "${cue.id}" shares startCfi "${cue.startCfi}" with another cue.`,
      });
    }
    cfiSeen.add(cue.startCfi);
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return { valid: !hasErrors, issues };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportEditableCopyResult =
  | { success: true; archiveBytes: Uint8Array }
  | { success: false; error: string; issues?: CueValidationIssue[] };

/**
 * Validates and exports an EditableCopy as a self-contained portable .bookscore ZIP.
 * The archive format matches the #17 portable export/import contract exactly:
 *   - manifest.json   (SoundtrackPackageManifest with a freshly-computed manifestHash)
 *   - audio/<assetId>.mp3  (binary-exact, one per asset)
 *
 * Returns an error without writing if validation finds blocking issues.
 * Local-only fields (editionId, copyId, source references) do NOT travel.
 */
export async function exportEditableCopy(copy: EditableCopy): Promise<ExportEditableCopyResult> {
  const validation = validateEditableCopy(copy);
  if (!validation.valid) {
    return {
      success: false,
      error: 'Validation failed. Fix all errors before exporting.',
      issues: validation.issues.filter((i) => i.severity === 'error'),
    };
  }

  // Re-hash each asset and rebuild the asset list with correct hashes/durations
  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } = await import(
    '@zip.js/zip.js'
  );

  const zipWriter = new ZipWriter(new Uint8ArrayWriter());

  const updatedAssets: SoundtrackAsset[] = [];
  for (const asset of copy.manifest.assets) {
    const bytes = copy.assetBytes[asset.id];
    if (!bytes || bytes.byteLength === 0) continue; // warnings-only assets skipped

    const computedHash = await sha256Hex(bytes);
    const exportPath = `audio/${asset.id}.mp3`;

    updatedAssets.push({
      ...asset,
      path: exportPath,
      hash: computedHash,
    });

    await zipWriter.add(exportPath, new Uint8ArrayReader(bytes));
  }

  // Build the exportable manifest (no local-only fields, fresh manifestHash)
  const exportManifest: Omit<SoundtrackPackageManifest, 'manifestHash'> & {
    manifestHash: string;
  } = {
    packageId: copy.manifest.packageId,
    title: copy.manifest.title,
    version: copy.manifest.version,
    manifestHash: '',
    editionCompatibility: copy.manifest.editionCompatibility,
    assets: updatedAssets,
    cues: copy.manifest.cues,
  };

  const encoder = new TextEncoder();
  const manifestForHash = { ...exportManifest } as Record<string, unknown>;
  delete manifestForHash['manifestHash'];
  exportManifest.manifestHash = await sha256Hex(encoder.encode(JSON.stringify(manifestForHash)));

  await zipWriter.add('manifest.json', new TextReader(JSON.stringify(exportManifest)));

  const archiveBytes = await zipWriter.close();
  return { success: true, archiveBytes };
}

// ---------------------------------------------------------------------------
// Persistence helpers – EditableCopy is large (contains audio bytes)
// so we only store the manifest + metadata on disk; bytes are stored as
// separate files under soundtracks/<copyId>/<assetId>.mp3
// ---------------------------------------------------------------------------

export const EDITABLE_COPIES_FILENAME = 'soundtrack_editable_copies.json';

type PersistedCopyMeta = Omit<EditableCopy, 'assetBytes'>;
type PersistedCopiesMap = Record<string, PersistedCopyMeta>;

import { safeLoadJSON, safeSaveJSON } from '@/services/persistence';
import { saveSoundtrackAssetFile } from './assetStorage';

/**
 * Persists an EditableCopy to disk: writes the manifest metadata to JSON and
 * writes each asset's bytes to `soundtracks/<copyId>/<assetId>.mp3`.
 */
export async function saveEditableCopy(
  fs: FileSystem,
  baseDir: BaseDir,
  copy: EditableCopy,
): Promise<void> {
  // Save asset bytes
  for (const [assetId, bytes] of Object.entries(copy.assetBytes)) {
    await saveSoundtrackAssetFile(fs, baseDir, copy.copyId, assetId, bytes);
  }

  // Save manifest metadata
  const existing = await safeLoadJSON<PersistedCopiesMap>(
    fs,
    EDITABLE_COPIES_FILENAME,
    baseDir,
    {},
  );
  const { assetBytes: _bytes, ...meta } = copy;
  existing[copy.copyId] = meta as PersistedCopyMeta;
  await safeSaveJSON(fs, EDITABLE_COPIES_FILENAME, baseDir, existing);
}

/**
 * Loads an EditableCopy from disk by copyId, re-reading asset bytes from storage.
 * Returns null when the copy is not found.
 */
export async function loadEditableCopy(
  fs: FileSystem,
  baseDir: BaseDir,
  copyId: string,
): Promise<EditableCopy | null> {
  const map = await safeLoadJSON<PersistedCopiesMap>(fs, EDITABLE_COPIES_FILENAME, baseDir, {});
  const meta = map[copyId];
  if (!meta) return null;

  const assetBytes: Record<string, Uint8Array> = {};
  for (const asset of meta.manifest.assets) {
    const buf = await loadSoundtrackAssetFile(fs, baseDir, copyId, asset.id);
    if (buf && buf.byteLength > 0) {
      assetBytes[asset.id] = new Uint8Array(buf);
    }
  }

  return { ...meta, assetBytes } as EditableCopy;
}

// ---------------------------------------------------------------------------
// Internal: minimal CFI comparator (mirrors cfiUtils.ts but kept local to
// avoid a circular dependency — authoringService has no dep on locationSeam)
// ---------------------------------------------------------------------------

function compareCfiSimple(cfiA: string, cfiB: string): number {
  if (cfiA === cfiB) return 0;
  const parse = (cfi: string) => {
    const raw = cfi.replace(/^epubcfi\((.*)\)$/, '$1');
    const parts = raw.split(':');
    const path = (parts[0] ?? '').replace(/\[[^\]]*\]/g, '');
    const steps = path
      .split(/[/!]/)
      .filter(Boolean)
      .map((s) => {
        const n = parseInt(s, 10);
        return isNaN(n) ? 0 : n;
      });
    const offset = parts[1] ? parseInt(parts[1], 10) : 0;
    return { steps, offset: isNaN(offset) ? 0 : offset };
  };

  const a = parse(cfiA);
  const b = parse(cfiB);
  const len = Math.max(a.steps.length, b.steps.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.steps[i] ?? 0) - (b.steps[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.offset - b.offset;
}
