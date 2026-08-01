import { describe, it, expect, beforeEach } from 'vitest';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import { InstalledPackage, LocalAssociation } from '@/services/bookscore/types';

describe('Reopen-Selected-But-Paused Semantics & Capability Gating', () => {
  const samplePackage: InstalledPackage = {
    packageId: 'pkg-lotr',
    manifestHash: 'hash-lotr-v1',
    installedAt: 1700000000000,
    manifest: {
      packageId: 'pkg-lotr',
      title: 'Lord of the Rings Soundtrack',
      version: 1,
      manifestHash: 'hash-lotr-v1',
      editionCompatibility: [
        {
          algorithm: 'readest-partial-md5-v1',
          digest: 'lotr-epub-digest',
          epubByteLength: 2048576,
        },
      ],
      assets: [
        {
          id: 'asset-shire',
          path: 'audio/shire.mp3',
          mimeType: 'audio/mpeg',
          hash: 'hash-shire',
          durationSec: 180,
        },
        {
          id: 'asset-moria',
          path: 'audio/moria.mp3',
          mimeType: 'audio/mpeg',
          hash: 'hash-moria',
          durationSec: 240,
        },
      ],
      cues: [
        {
          id: 'cue-shire',
          startCfi: 'epubcfi(/6/2!/4/2:0)',
          type: 'audio',
          assetId: 'asset-shire',
          startSec: 0,
          loopStartSec: 10,
          loopEndSec: 170,
          volume: 0.8,
          crossfadeSec: 1.0,
        },
        {
          id: 'cue-moria',
          startCfi: 'epubcfi(/6/20!/4/2:0)',
          type: 'audio',
          assetId: 'asset-moria',
          startSec: 0,
          loopStartSec: 0,
          loopEndSec: 220,
          volume: 1.0,
          crossfadeSec: 1.5,
        },
      ],
    },
  };

  const sampleAssociation: LocalAssociation = {
    editionId: 'lotr-edition-1',
    packageId: 'pkg-lotr',
    manifestHash: 'hash-lotr-v1',
    selected: true,
  };

  const packagesMap = { 'pkg-lotr:hash-lotr-v1': samplePackage };
  const associationsMap = { 'lotr-edition-1': sampleAssociation };

  beforeEach(() => {
    useSoundtrackStore.getState().resetSoundtrack();
  });

  it('restores containing cue as SELECTED but PAUSED when book is reopened at saved position', () => {
    const store = useSoundtrackStore.getState();
    store.setCapabilityEnabled(true);

    // Reader reopens book at saved location 'epubcfi(/6/20!/4/2:100)' (inside cue-moria)
    store.loadSoundtrackForBook(
      'lotr-edition-1',
      packagesMap,
      associationsMap,
      'epubcfi(/6/20!/4/2:100)',
    );

    const state = useSoundtrackStore.getState();
    expect(state.activePackage).toBeDefined();
    expect(state.selectedCue?.id).toBe('cue-moria');
    expect(state.playbackStatus).toBe('paused');
    expect(state.isUserPlaying).toBe(false);
  });

  it('allows crossing cue boundaries while reading', () => {
    const store = useSoundtrackStore.getState();
    store.setCapabilityEnabled(true);
    store.loadSoundtrackForBook(
      'lotr-edition-1',
      packagesMap,
      associationsMap,
      'epubcfi(/6/2!/4/2:0)',
    );

    // Initially inside cue-shire
    expect(useSoundtrackStore.getState().selectedCue?.id).toBe('cue-shire');

    // Reader moves to chapter 20 (crossing cue boundary into cue-moria)
    store.reportLocation({ seq: 1, kind: 'resolved', cfi: 'epubcfi(/6/20!/4/2:50)' });

    expect(useSoundtrackStore.getState().selectedCue?.id).toBe('cue-moria');
    // Because user hadn't hit play yet, remains paused at the new containing cue
    expect(useSoundtrackStore.getState().playbackStatus).toBe('paused');
  });

  it('when capability is disabled (web/iOS/Android), soundtrack selects silence and stays disabled', () => {
    const store = useSoundtrackStore.getState();
    store.setCapabilityEnabled(false); // Disabled for non-desktop platform

    store.loadSoundtrackForBook(
      'lotr-edition-1',
      packagesMap,
      associationsMap,
      'epubcfi(/6/2!/4/2:0)',
    );
    store.reportLocation({ seq: 1, kind: 'resolved', cfi: 'epubcfi(/6/2!/4/2:0)' });

    const state = useSoundtrackStore.getState();
    expect(state.capabilityEnabled).toBe(false);
    expect(state.playbackStatus).toBe('silence');
  });

  it('ignores stale or duplicate location reports without silencing valid ongoing playback state', () => {
    const store = useSoundtrackStore.getState();
    store.setCapabilityEnabled(true);
    store.loadSoundtrackForBook(
      'lotr-edition-1',
      packagesMap,
      associationsMap,
      'epubcfi(/6/2!/4/2:0)',
    );

    // Initial valid report seq=1
    store.reportLocation({ seq: 1, kind: 'resolved', cfi: 'epubcfi(/6/2!/4/2:0)' });
    expect(useSoundtrackStore.getState().selectedCue?.id).toBe('cue-shire');

    // Duplicate report seq=1 (e.g. repeated Foliate relocate event)
    store.reportLocation({ seq: 1, kind: 'resolved', cfi: 'epubcfi(/6/2!/4/2:0)' });

    // Verify current cue and playback state are preserved (NOT silenced)
    expect(useSoundtrackStore.getState().selectedCue?.id).toBe('cue-shire');
    expect(useSoundtrackStore.getState().playbackStatus).toBe('paused');
  });
});
