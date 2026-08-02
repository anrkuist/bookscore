import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import { SoundtrackPlayer } from '@/services/bookscore/soundtrackPlayer';
import { InstalledPackage, LocalAssociation, AudioCue } from '@/services/bookscore/types';
import { eventDispatcher } from '@/utils/event';

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

  it('dispatches tts-stop event when play is invoked', async () => {
    const fakePlayer = new FakeSoundtrackPlayer();
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore.getState().registerSoundtrackPlayer(fakePlayer);

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

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
      .loadSoundtrackForBook('ed-1', { 'pkg-1:hash-1': pkg }, { 'ed-1': assoc });

    await useSoundtrackStore.getState().play();

    expect(dispatchSpy).toHaveBeenCalledWith(
      'tts-stop',
      expect.objectContaining({ bookKey: 'ed-1' }),
    );
  });
});
