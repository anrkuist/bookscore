import { create } from 'zustand';
import {
  InstalledPackage,
  LocalAssociation,
  LocationReport,
  PlaybackStatus,
  SoundtrackCue,
} from '@/services/bookscore/types';
import { LocationReportSeam } from '@/services/bookscore/locationSeam';
import { SoundtrackPlayer } from '@/services/bookscore/soundtrackPlayer';
import { findCueForCfi } from '@/services/bookscore/cfiUtils';
import { loadSoundtrackAssetFile } from '@/services/bookscore/assetStorage';
import { FileSystem } from '@/types/system';
import { getInitializedAppService } from '@/services/environment';

import { ttsSessionManager } from '@/services/tts/TTSSessionManager';
import { eventDispatcher } from '@/utils/event';

export interface SoundtrackStoreState {
  capabilityEnabled: boolean;
  activeEditionId: string | null;
  activeBookKey: string | null;
  activePackage: InstalledPackage | null;
  activeAssociation: LocalAssociation | null;
  selectedCue: SoundtrackCue | null;
  playbackStatus: PlaybackStatus;
  isGestureUnlocked: boolean;
  isUserPlaying: boolean;
  volume: number;
  isPanelOpen: boolean;

  // Actions
  setCapabilityEnabled: (enabled: boolean) => void;
  registerSoundtrackPlayer: (player: SoundtrackPlayer | null) => void;
  loadSoundtrackForBook: (
    editionId: string,
    packages: Record<string, InstalledPackage>,
    associations: Record<string, LocalAssociation>,
    initialCfi?: string,
    bookKey?: string,
  ) => void;
  reportLocation: (report: LocationReport) => void;
  play: (fromGesture?: boolean, customFs?: FileSystem) => Promise<void>;
  pause: () => void;
  togglePlayPause: (customFs?: FileSystem) => Promise<void>;
  resetSoundtrack: () => void;
  setVolume: (volume: number) => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
}

const locationSeam = new LocationReportSeam();
let playerInstance: SoundtrackPlayer | null = null;

async function resolveAndPlayAudioCue(
  cue: SoundtrackCue,
  pkg: InstalledPackage,
  player: SoundtrackPlayer,
  customFs?: FileSystem,
  isResume = false,
): Promise<boolean> {
  if (cue.type !== 'audio') return false;

  const asset = pkg.manifest.assets.find((a) => a.id === cue.assetId);
  if (!asset) {
    player.transitionToSilence();
    return false;
  }

  const appSvc = getInitializedAppService();
  const fs = customFs ?? (appSvc as unknown as FileSystem | undefined);
  let audioData: ArrayBuffer | null = null;

  try {
    if (fs) {
      audioData = await loadSoundtrackAssetFile(
        fs,
        'Data',
        pkg.packageId,
        asset.id,
        pkg.manifestHash,
      );
      if (!audioData || audioData.byteLength === 0) {
        player.transitionToSilence();
        return false;
      }
    }

    await player.playCue(cue, audioData ?? undefined, isResume);
    return true;
  } catch (err) {
    console.warn('Failed to load or play soundtrack audio cue, falling back to safe silence:', err);
    player.transitionToSilence();
    return false;
  }
}

export const useSoundtrackStore = create<SoundtrackStoreState>((set, get) => ({
  capabilityEnabled: false,
  activeEditionId: null,
  activeBookKey: null,
  activePackage: null,
  activeAssociation: null,
  selectedCue: null,
  playbackStatus: 'silence',
  isGestureUnlocked: false,
  isUserPlaying: false,
  volume: 1.0,
  isPanelOpen: false,

  setCapabilityEnabled: (enabled: boolean) => {
    set({ capabilityEnabled: enabled });
  },

  registerSoundtrackPlayer: (player: SoundtrackPlayer | null) => {
    playerInstance = player;
    if (playerInstance) {
      playerInstance.setVolume?.(get().volume);
    }
  },

  setVolume: (volume: number) => {
    const clamped = Math.min(1, Math.max(0, volume));
    set({ volume: clamped });
    if (playerInstance) {
      playerInstance.setVolume?.(clamped);
    }
  },

  setPanelOpen: (open: boolean) => {
    set({ isPanelOpen: open });
  },

  togglePanel: () => {
    set((state) => ({ isPanelOpen: !state.isPanelOpen }));
  },

  loadSoundtrackForBook: (
    editionId: string,
    packages: Record<string, InstalledPackage>,
    associations: Record<string, LocalAssociation>,
    initialCfi?: string,
    bookKey?: string,
  ) => {
    const association = associations[editionId];
    if (!association || !association.selected) {
      set({
        activeEditionId: editionId,
        activeBookKey: bookKey || editionId,
        activePackage: null,
        activeAssociation: null,
        selectedCue: null,
        playbackStatus: 'silence',
        isUserPlaying: false,
      });
      return;
    }

    const pkgKey = `${association.packageId}:${association.manifestHash}`;
    const pkg = packages[pkgKey] ?? packages[association.packageId];

    if (!pkg) {
      set({
        activeEditionId: editionId,
        activeBookKey: bookKey || editionId,
        activePackage: null,
        activeAssociation: association,
        selectedCue: null,
        playbackStatus: 'silence',
        isUserPlaying: false,
      });
      return;
    }

    locationSeam.reset();

    // Reopen-selected-but-paused semantics:
    // When book opens, resolve containing cue.
    // Containing cue is set as selectedCue, but status is 'paused' and isUserPlaying is false.
    let containingCue: SoundtrackCue | null = null;
    if (initialCfi) {
      containingCue = findCueForCfi(initialCfi, pkg.manifest.cues);
    } else if (pkg.manifest.cues.length > 0) {
      containingCue = pkg.manifest.cues[0] ?? null;
    }

    set({
      activeEditionId: editionId,
      activeBookKey: bookKey || editionId,
      activePackage: pkg,
      activeAssociation: association,
      selectedCue: containingCue,
      playbackStatus: containingCue && containingCue.type === 'audio' ? 'paused' : 'silence',
      isUserPlaying: false,
    });
  },

  reportLocation: (report: LocationReport) => {
    const { capabilityEnabled, activePackage, isUserPlaying, isGestureUnlocked } = get();

    if (!capabilityEnabled || !activePackage) {
      set({ selectedCue: null, playbackStatus: 'silence' });
      return;
    }

    const res = locationSeam.processReport(report, activePackage.manifest.cues);

    if (res.isStaleOrDuplicate) {
      // Stale or duplicate reports are ignored so duplicate relocate events
      // do not interrupt ongoing valid playback.
      return;
    }

    if (res.status === 'silence') {
      if (playerInstance) {
        playerInstance.transitionToSilence();
      }
      set({ selectedCue: res.selectedCue, playbackStatus: 'silence' });
      return;
    }

    const newCue = res.selectedCue;
    if (!newCue || newCue.type !== 'audio') {
      set({ selectedCue: null, playbackStatus: 'silence' });
      return;
    }

    set({ selectedCue: newCue });

    if (isUserPlaying) {
      if (!isGestureUnlocked) {
        set({ playbackStatus: 'gesture_required' });
      } else {
        set({ playbackStatus: 'playing' });
        if (playerInstance) {
          void resolveAndPlayAudioCue(newCue, activePackage, playerInstance, undefined, false).then(
            (success) => {
              if (!success) {
                set({ playbackStatus: 'silence' });
              }
            },
          );
        }
      }
    } else {
      set({ playbackStatus: 'paused' });
    }
  },

  play: async (fromGesture = true, customFs?: FileSystem) => {
    const {
      capabilityEnabled,
      activePackage,
      selectedCue,
      isGestureUnlocked,
      playbackStatus,
      activeBookKey,
      activeEditionId,
    } = get();
    if (!capabilityEnabled) return;

    let unlocked = isGestureUnlocked;
    if (fromGesture && playerInstance) {
      unlocked = await playerInstance.unlockGesture();
      set({ isGestureUnlocked: unlocked });
    }

    if (!unlocked) {
      set({ isUserPlaying: true, playbackStatus: 'gesture_required' });
      return;
    }

    const isResume = playbackStatus === 'paused';
    set({ isUserPlaying: true });

    if (selectedCue && selectedCue.type === 'audio' && activePackage && playerInstance) {
      playerInstance.setVolume?.(get().volume);
      const success = await resolveAndPlayAudioCue(
        selectedCue,
        activePackage,
        playerInstance,
        customFs,
        isResume,
      );
      if (success) {
        set({ playbackStatus: 'playing' });
        // Requirement: Play stops active TTS ONLY when audio playback successfully starts
        if (typeof window !== 'undefined') {
          const activeSession = ttsSessionManager.getActiveSession();
          const targetBookKey = activeSession?.bookKey || activeBookKey || activeEditionId || '';
          eventDispatcher.dispatch('tts-stop', { bookKey: targetBookKey });
        }
      } else {
        set({ playbackStatus: 'silence' });
      }
    } else {
      set({ playbackStatus: 'silence' });
    }
  },

  pause: () => {
    const { selectedCue, playbackStatus } = get();
    const isAudioCue = selectedCue && selectedCue.type === 'audio';
    const nextStatus = isAudioCue && playbackStatus !== 'silence' ? 'paused' : 'silence';
    set({ isUserPlaying: false, playbackStatus: nextStatus });
    if (playerInstance) {
      playerInstance.pause();
    }
  },

  togglePlayPause: async (customFs?: FileSystem) => {
    const { isUserPlaying } = get();
    if (isUserPlaying) {
      get().pause();
    } else {
      await get().play(true, customFs);
    }
  },

  resetSoundtrack: () => {
    locationSeam.reset();
    if (playerInstance) {
      void playerInstance.dispose();
      playerInstance = null;
    }
    set({
      activeEditionId: null,
      activeBookKey: null,
      activePackage: null,
      activeAssociation: null,
      selectedCue: null,
      playbackStatus: 'silence',
      isUserPlaying: false,
      isPanelOpen: false,
    });
  },
}));
