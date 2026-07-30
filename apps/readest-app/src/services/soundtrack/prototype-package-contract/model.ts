/**
 * PROTOTYPE — validates whether one portable manifest can express import,
 * immutable originals, editable descendants, silence, and cue playback.
 * It deliberately has no archive I/O or persistence.
 */

export type Asset = {
  id: string;
  path: `assets/${string}.mp3`;
  mediaType: 'audio/mpeg';
  sha256: string;
  durationSec: number;
};

export type Cue = {
  id: string;
  start: { kind: 'epub-cfi'; value: string };
} & (
  | { kind: 'silence' }
  | {
      kind: 'audio';
      assetId: string;
      startSec: number;
      loopStartSec: number;
      loopEndSec: number;
      volume: number;
      crossfadeMs: number;
    }
);

export type SoundtrackManifest = {
  format: 'bookscore-soundtrack';
  formatVersion: '1.0';
  id: string;
  title: string;
  authors: Array<{ name: string; url?: string }>;
  license: { spdx?: string; text?: string; url?: string };
  compatibleEditions: Array<{
    algorithm: 'readest-partial-md5-v1' | 'sha256-v1';
    digest: string;
    byteLength: number;
  }>;
  derivedFrom?: { packageId: string; manifestSha256: string };
  assets: Asset[];
  cues: Cue[];
  extensions?: Record<`${string}.${string}`, unknown>;
};

export type PrototypeState = {
  imported: SoundtrackManifest;
  active: SoundtrackManifest;
  mode: 'imported (immutable)' | 'authoring copy (editable)';
  lastAction: string;
};

const original: SoundtrackManifest = {
  format: 'bookscore-soundtrack',
  formatVersion: '1.0',
  id: 'b4c0f061-6ad7-4bde-b8c4-582e4d44fd8a',
  title: 'The Lighthouse',
  authors: [{ name: 'A. Composer' }],
  license: { spdx: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  compatibleEditions: [
    { algorithm: 'readest-partial-md5-v1', digest: 'b3c4d5e6f7080910', byteLength: 481_516 },
  ],
  assets: [
    {
      id: 'shoreline',
      path: 'assets/shoreline.mp3',
      mediaType: 'audio/mpeg',
      sha256: 'a'.repeat(64),
      durationSec: 128,
    },
  ],
  cues: [
    {
      id: 'opening',
      start: { kind: 'epub-cfi', value: 'epubcfi(/6/2[chapter1]!/4/2/2)' },
      kind: 'audio',
      assetId: 'shoreline',
      startSec: 4,
      loopStartSec: 12,
      loopEndSec: 120,
      volume: 0.8,
      crossfadeMs: 800,
    },
    {
      id: 'interlude',
      start: { kind: 'epub-cfi', value: 'epubcfi(/6/4[chapter2]!/4/2/2)' },
      kind: 'silence',
    },
  ],
  extensions: { 'org.bookscore.example': { mood: 'coastal' } },
};

export const initialState = (): PrototypeState => ({
  imported: structuredClone(original),
  active: structuredClone(original),
  mode: 'imported (immutable)',
  lastAction: 'Imported package: originals cannot be edited.',
});

export function validate(manifest: SoundtrackManifest): string[] {
  const errors: string[] = [];
  if (manifest.format !== 'bookscore-soundtrack' || manifest.formatVersion !== '1.0') {
    errors.push('Unsupported format or major version.');
  }
  if (!manifest.authors.length || (!manifest.license.spdx && !manifest.license.text)) {
    errors.push('Authorship and a license are both required.');
  }
  if (!manifest.compatibleEditions.length)
    errors.push('At least one edition fingerprint is required.');
  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  if (assets.size !== manifest.assets.length) errors.push('Audio asset IDs must be unique.');
  for (const asset of manifest.assets) {
    if (!/^assets\/[a-z0-9-]+\.mp3$/.test(asset.path))
      errors.push(`${asset.id}: unsafe asset path.`);
    if (!/^[a-f0-9]{64}$/.test(asset.sha256))
      errors.push(`${asset.id}: SHA-256 must be 64 lowercase hex characters.`);
    if (!Number.isFinite(asset.durationSec) || asset.durationSec <= 0)
      errors.push(`${asset.id}: invalid duration.`);
  }
  const cueIds = new Set<string>();
  for (const cue of manifest.cues) {
    if (cueIds.has(cue.id)) errors.push('Scene cue IDs must be unique.');
    cueIds.add(cue.id);
    if (!cue.start.value.startsWith('epubcfi('))
      errors.push(`${cue.id}: only EPUB CFI boundaries are valid.`);
    if (cue.kind === 'audio') {
      const asset = assets.get(cue.assetId);
      if (!asset) errors.push(`${cue.id}: missing audio asset.`);
      if (
        !asset ||
        !(
          0 <= cue.startSec &&
          cue.startSec <= cue.loopStartSec &&
          cue.loopStartSec < cue.loopEndSec &&
          cue.loopEndSec <= asset.durationSec
        )
      ) {
        errors.push(`${cue.id}: invalid start or loop range.`);
      }
      if (!(0 <= cue.volume && cue.volume <= 1) || cue.crossfadeMs < 0)
        errors.push(`${cue.id}: invalid volume or crossfade.`);
    }
  }
  return errors;
}

export function makeEditableCopy(state: PrototypeState): PrototypeState {
  if (state.mode === 'authoring copy (editable)')
    return { ...state, lastAction: 'Already editing a descendant.' };
  const copy = structuredClone(state.imported);
  copy.id = '6d178f71-0c09-4310-9a89-61d18b74510b';
  copy.derivedFrom = { packageId: state.imported.id, manifestSha256: 'b'.repeat(64) };
  return {
    ...state,
    active: copy,
    mode: 'authoring copy (editable)',
    lastAction: 'Created editable descendant; import remains unchanged.',
  };
}

export function addCue(state: PrototypeState): PrototypeState {
  if (state.mode !== 'authoring copy (editable)')
    return { ...state, lastAction: 'Create an editable copy before changing cues.' };
  return {
    ...state,
    active: {
      ...state.active,
      cues: [
        ...state.active.cues,
        {
          id: 'harbor',
          start: { kind: 'epub-cfi', value: 'epubcfi(/6/6[chapter3]!/4/2/2)' },
          kind: 'silence',
        },
      ],
    },
    lastAction: 'Added an explicit-silence scene cue to the editable copy.',
  };
}

export function corruptAsset(state: PrototypeState): PrototypeState {
  const assets = structuredClone(state.active.assets);
  assets[0]!.sha256 = 'not-a-checksum';
  return {
    ...state,
    active: { ...state.active, assets },
    lastAction: 'Corrupted the active asset checksum to test validation.',
  };
}
