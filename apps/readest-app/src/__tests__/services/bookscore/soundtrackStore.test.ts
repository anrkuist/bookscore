import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import { SoundtrackPlayer } from '@/services/bookscore/soundtrackPlayer';
import {
  InstalledPackage,
  LocalAssociation,
  AudioCue,
  SilenceCue,
} from '@/services/bookscore/types';
import { eventDispatcher } from '@/utils/event';
import * as assetStorageModule from '@/services/bookscore/assetStorage';

class FakeSoundtrackPlayer implements SoundtrackPlayer {
  isUnlocked = vi.fn(() => true);
  unlockGesture = vi.fn(async () => true);
  playCue = vi.fn(async () => {});
  transitionToSilence = vi.fn(async () => {});
  pause = vi.fn();
  stop = vi.fn();
  dispose = vi.fn(async () => {});
  getCurrentCue = vi.fn(() => null);
  getSavedOffset = vi.fn(() => undefined);
  setVolume = vi.fn();
  getVolume = vi.fn(() => 1.0);
}

describe('soundtrackStore issue #15 enhancements', () => {
  beforeEach(() => {
    useSoundtrackStore.getState().resetSoundtrack();
    vi.restoreAllMocks();
  });

  it('manages volume state and updates player instance', () => {
    const fakePlayer = new FakeSoundtrackPlayer();
    useSoundtrackStore.getState().registerSoundtrackPlayer(fakePlayer);

    expect(useSoundtrackStore.getState().volume).toBe(1.0);

    useSoundtrackStore.getState().setVolume(0.5);
    expect(useSoundtrackStore.getState().volume).toBe(0.5);
    expect(fakePlayer.setVolume).toHaveBeenCalledWith(0.5);

    // Clamping checks
    useSoundtrackStore.getState().setVolume(1.5);
    expect(useSoundtrackStore.getState().volume).toBe(1.0);

    useSoundtrackStore.getState().setVolume(-0.2);
    expect(useSoundtrackStore.getState().volume).toBe(0.0);
  });

  it('manages right-side panel open/close state', () => {
    expect(useSoundtrackStore.getState().isPanelOpen).toBe(false);

    useSoundtrackStore.getState().togglePanel();
    expect(useSoundtrackStore.getState().isPanelOpen).toBe(true);

    useSoundtrackStore.getState().setPanelOpen(false);
    expect(useSoundtrackStore.getState().isPanelOpen).toBe(false);
  });

  it('dispatches tts-stop event with mounted bookKey only when audio cue will actually play', async () => {
    const fakePlayer = new FakeSoundtrackPlayer();
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore.getState().registerSoundtrackPlayer(fakePlayer);

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    vi.spyOn(assetStorageModule, 'loadSoundtrackAssetFile').mockResolvedValue(
      new ArrayBuffer(1024),
    );

    const sampleCue: AudioCue = {
      id: 'cue-1',
      startCfi: 'epubcfi(/6/2!/4/2)',
      type: 'audio',
      assetId: 'asset-1',
      startSec: 0,
      loopStartSec: 0,
      loopEndSec: 10,
      volume: 1,
      crossfadeSec: 0.5,
    };

    const pkg: InstalledPackage = {
      packageId: 'pkg-1',
      manifestHash: 'hash-1',
      installedAt: Date.now(),
      manifest: {
        packageId: 'pkg-1',
        title: 'Test Package',
        version: 1,
        manifestHash: 'hash-1',
        editionCompatibility: [],
        assets: [
          { id: 'asset-1', path: 'audio.mp3', mimeType: 'audio/mpeg', hash: 'h', durationSec: 10 },
        ],
        cues: [sampleCue],
      },
    };

    const assoc: LocalAssociation = {
      editionId: 'ed-1',
      packageId: 'pkg-1',
      manifestHash: 'hash-1',
      selected: true,
      trustState: 'verified',
    };

    // Load with full mounted bookKey (ed-1-unique123)
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'ed-1',
        { 'pkg-1:hash-1': pkg },
        { 'ed-1': assoc },
        undefined,
        'ed-1-unique123',
      );

    await useSoundtrackStore.getState().play();

    // Verify tts-stop was dispatched with full bookKey ed-1-unique123
    expect(dispatchSpy).toHaveBeenCalledWith(
      'tts-stop',
      expect.objectContaining({ bookKey: 'ed-1-unique123' }),
    );
  });

  it('does NOT stop TTS if selected scene is silence / no audio cue', async () => {
    const fakePlayer = new FakeSoundtrackPlayer();
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore.getState().registerSoundtrackPlayer(fakePlayer);

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const silenceCue: SilenceCue = {
      id: 'cue-silence',
      startCfi: 'epubcfi(/6/2!/4/2)',
      type: 'silence',
    };

    const silencePkg: InstalledPackage = {
      packageId: 'pkg-silence',
      manifestHash: 'hash-silence',
      installedAt: Date.now(),
      manifest: {
        packageId: 'pkg-silence',
        title: 'Silence Package',
        version: 1,
        manifestHash: 'hash-silence',
        editionCompatibility: [],
        assets: [],
        cues: [silenceCue],
      },
    };

    const assoc: LocalAssociation = {
      editionId: 'ed-silence',
      packageId: 'pkg-silence',
      manifestHash: 'hash-silence',
      selected: true,
      trustState: 'verified',
    };

    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'ed-silence',
        { 'pkg-silence:hash-silence': silencePkg },
        { 'ed-silence': assoc },
        undefined,
        'ed-silence-999',
      );

    await useSoundtrackStore.getState().play();

    // Verify tts-stop was NOT called because selected cue is silence
    expect(dispatchSpy).not.toHaveBeenCalledWith('tts-stop', expect.anything());
  });

  it('does NOT stop TTS and falls back to silence if audio asset resolution or playCue fails', async () => {
    const fakePlayer = new FakeSoundtrackPlayer();
    fakePlayer.playCue.mockRejectedValue(new Error('Audio decoding failed'));

    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore.getState().registerSoundtrackPlayer(fakePlayer);

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    vi.spyOn(assetStorageModule, 'loadSoundtrackAssetFile').mockResolvedValue(null);

    const brokenCue: AudioCue = {
      id: 'cue-broken',
      startCfi: 'epubcfi(/6/2!/4/2)',
      type: 'audio',
      assetId: 'asset-1',
      startSec: 0,
      loopStartSec: 0,
      loopEndSec: 10,
      volume: 1,
      crossfadeSec: 0.5,
    };

    const brokenPkg: InstalledPackage = {
      packageId: 'pkg-broken',
      manifestHash: 'hash-broken',
      installedAt: Date.now(),
      manifest: {
        packageId: 'pkg-broken',
        title: 'Broken Package',
        version: 1,
        manifestHash: 'hash-broken',
        editionCompatibility: [],
        assets: [
          { id: 'asset-1', path: 'audio.mp3', mimeType: 'audio/mpeg', hash: 'h', durationSec: 10 },
        ],
        cues: [brokenCue],
      },
    };

    const assoc: LocalAssociation = {
      editionId: 'ed-broken',
      packageId: 'pkg-broken',
      manifestHash: 'hash-broken',
      selected: true,
      trustState: 'verified',
    };

    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'ed-broken',
        { 'pkg-broken:hash-broken': brokenPkg },
        { 'ed-broken': assoc },
        undefined,
        'ed-broken-123',
      );

    await useSoundtrackStore.getState().play();

    // Verify tts-stop was NOT called when audio asset resolution returned null / failed
    expect(dispatchSpy).not.toHaveBeenCalledWith('tts-stop', expect.anything());
    expect(useSoundtrackStore.getState().playbackStatus).toBe('silence');
  });

  it('does NOT stop TTS and handles asset loader exception gracefully', async () => {
    const fakePlayer = new FakeSoundtrackPlayer();
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore.getState().registerSoundtrackPlayer(fakePlayer);

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    // Simulate loadSoundtrackAssetFile throwing a disk error
    vi.spyOn(assetStorageModule, 'loadSoundtrackAssetFile').mockRejectedValue(
      new Error('Disk read error'),
    );

    const sampleCue: AudioCue = {
      id: 'cue-1',
      startCfi: 'epubcfi(/6/2!/4/2)',
      type: 'audio',
      assetId: 'asset-1',
      startSec: 0,
      loopStartSec: 0,
      loopEndSec: 10,
      volume: 1,
      crossfadeSec: 0.5,
    };

    const pkg: InstalledPackage = {
      packageId: 'pkg-1',
      manifestHash: 'hash-1',
      installedAt: Date.now(),
      manifest: {
        packageId: 'pkg-1',
        title: 'Test Package',
        version: 1,
        manifestHash: 'hash-1',
        editionCompatibility: [],
        assets: [
          { id: 'asset-1', path: 'audio.mp3', mimeType: 'audio/mpeg', hash: 'h', durationSec: 10 },
        ],
        cues: [sampleCue],
      },
    };

    const assoc: LocalAssociation = {
      editionId: 'ed-1',
      packageId: 'pkg-1',
      manifestHash: 'hash-1',
      selected: true,
      trustState: 'verified',
    };

    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'ed-1',
        { 'pkg-1:hash-1': pkg },
        { 'ed-1': assoc },
        undefined,
        'ed-1-unique123',
      );

    // Call play with customFs so loadSoundtrackAssetFile is invoked and rejects
    await useSoundtrackStore.getState().play(true, {} as any);

    expect(dispatchSpy).not.toHaveBeenCalledWith('tts-stop', expect.anything());
    expect(useSoundtrackStore.getState().playbackStatus).toBe('silence');
    expect(fakePlayer.transitionToSilence).toHaveBeenCalled();
  });
});
