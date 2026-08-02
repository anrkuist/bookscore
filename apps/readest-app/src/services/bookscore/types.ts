export type EditionCompatibility = {
  algorithm: 'readest-partial-md5-v1' | 'sha256-v1';
  digest: string;
  epubByteLength: number;
};

export type SoundtrackAsset = {
  id: string;
  path: string;
  mimeType: 'audio/mpeg';
  hash: string;
  durationSec: number;
};

export type AudioCue = {
  id: string;
  startCfi: string;
  type: 'audio';
  assetId: string;
  startSec: number;
  loopStartSec: number;
  loopEndSec: number;
  volume: number;
  crossfadeSec: number;
};

export type SilenceCue = {
  id: string;
  startCfi: string;
  type: 'silence';
};

export type SoundtrackCue = AudioCue | SilenceCue;

export type SoundtrackPackageManifest = {
  packageId: string;
  title: string;
  version: number;
  manifestHash: string;
  editionCompatibility: EditionCompatibility[];
  assets: SoundtrackAsset[];
  cues: SoundtrackCue[];
};

export type InstalledPackage = {
  packageId: string;
  manifestHash: string;
  manifest: SoundtrackPackageManifest;
  installedAt: number;
};

export type LocalAssociation = {
  editionId: string;
  packageId: string;
  manifestHash: string;
  selected: boolean;
  trustState?: 'verified' | 'unverified';
};

export type SoundtrackCandidate = {
  package: InstalledPackage;
  trustState: 'verified' | 'unverified';
  isSelected: boolean;
};

export type LocationReportKind = 'started' | 'resolved' | 'unavailable';

export type LocationReport = {
  seq: number;
  kind: LocationReportKind;
  cfi?: string;
  timestamp?: number;
};

export type PlaybackStatus = 'paused' | 'playing' | 'silence' | 'gesture_required';

export type PlaybackIntent = {
  status: PlaybackStatus;
  selectedCue: SoundtrackCue | null;
  activeCueId: string | null;
  volume: number;
  isGestureUnlocked: boolean;
};

export type RepairFailureReason = 'missing' | 'unreadable' | 'corrupt';

export type RepairQueueItem = {
  packageId: string;
  manifestHash: string;
  title: string;
  reason: RepairFailureReason;
  assetId?: string;
  detectedAt: number;
  affectedEditionIds: string[];
};

export type StoredRepairQueueMap = Record<string, RepairQueueItem>;

/**
 * An in-progress authoring copy derived from an installed package.
 * The manifest is fully mutable.  Assets are keyed by assetId and always
 * retain the binary bytes that were copied from the source package so the
 * copy is self-contained even after the source is removed.
 */
export type EditableCopy = {
  /** Stable id for this copy; independent of the source package. */
  copyId: string;
  /** Source package reference (informational; copy is independent). */
  sourcePackageId: string;
  sourceManifestHash: string;
  /** EPUB edition this copy is authored for. */
  editionId: string;
  /** The mutable working manifest for this copy. */
  manifest: SoundtrackPackageManifest;
  /** Binary MP3 bytes for each asset – keyed by assetId. */
  assetBytes: Record<string, Uint8Array>;
  createdAt: number;
  modifiedAt: number;
};

export type CueValidationIssue = {
  severity: 'error' | 'warning';
  cueId?: string;
  assetId?: string;
  message: string;
};

export type EditableCopyValidationResult = {
  valid: boolean;
  issues: CueValidationIssue[];
};
