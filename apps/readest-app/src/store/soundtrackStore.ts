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

export interface SoundtrackStoreState {
  capabilityEnabled: boolean;
  activePackage: InstalledPackage | null;
  activeAssociation: LocalAssociation | null;
  selectedCue: SoundtrackCue | null;
  playbackStatus: PlaybackStatus;
  isGestureUnlocked: boolean;
  isUserPlaying: boolean;

  // Actions
  setCapabilityEnabled: (enabled: boolean) => void;
  registerSoundtrackPlayer: (player: SoundtrackPlayer | null) => void;
  loadSoundtrackForBook: (
    editionId: string,
    packages: Record<string, InstalledPackage>,
    associations: Record<string, LocalAssociation>,
    initialCfi?: string,
  ) => void;
  reportLocation: (report: LocationReport) => void;
  play: (fromGesture?: boolean) => Promise<void>;
  pause: () => void;
  togglePlayPause: () => Promise<void>;
  resetSoundtrack: () => void;
}

const locationSeam = new LocationReportSeam();
let playerInstance: SoundtrackPlayer | null = null;

export const useSoundtrackStore = create<SoundtrackStoreState>((set, get) => ({
  capabilityEnabled: false,
  activePackage: null,
  activeAssociation: null,
  selectedCue: null,
  playbackStatus: 'silence',
  isGestureUnlocked: false,
  isUserPlaying: false,

  setCapabilityEnabled: (enabled: boolean) => {
    set({ capabilityEnabled: enabled });
  },

  registerSoundtrackPlayer: (player: SoundtrackPlayer | null) => {
    playerInstance = player;
  },

  loadSoundtrackForBook: (
    editionId: string,
    packages: Record<string, InstalledPackage>,
    associations: Record<string, LocalAssociation>,
    initialCfi?: string,
  ) => {
    const association = associations[editionId];
    if (!association || !association.selected) {
      set({
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
    // When book opens, if initialCfi is given, resolve containing cue.
    // The containing cue is set as selectedCue, but status is 'paused' and isUserPlaying is false.
    let containingCue: SoundtrackCue | null = null;
    if (initialCfi) {
      containingCue = findCueForCfi(initialCfi, pkg.manifest.cues);
    } else if (pkg.manifest.cues.length > 0) {
      containingCue = pkg.manifest.cues[0] ?? null;
    }

    set({
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
      // Stale or duplicate reports select safe silence
      if (playerInstance) {
        playerInstance.transitionToSilence();
      }
      set({ selectedCue: null, playbackStatus: 'silence' });
      return;
    }

    if (res.status === 'silence') {
      if (playerInstance) {
        playerInstance.transitionToSilence();
      }
      set({ selectedCue: res.selectedCue, playbackStatus: 'silence' });
      return;
    }

    // Audio cue resolved
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
          playerInstance.playCue(newCue);
        }
      }
    } else {
      // Cue is selected, but reader has not initiated play -> remain paused
      set({ playbackStatus: 'paused' });
    }
  },

  play: async (fromGesture = true) => {
    const { capabilityEnabled, selectedCue, isGestureUnlocked } = get();
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

    set({ isUserPlaying: true });

    if (selectedCue && selectedCue.type === 'audio') {
      set({ playbackStatus: 'playing' });
      if (playerInstance) {
        await playerInstance.playCue(selectedCue);
      }
    } else {
      set({ playbackStatus: 'silence' });
    }
  },

  pause: () => {
    set({ isUserPlaying: false, playbackStatus: 'paused' });
    if (playerInstance) {
      playerInstance.pause();
    }
  },

  togglePlayPause: async () => {
    const { isUserPlaying } = get();
    if (isUserPlaying) {
      get().pause();
    } else {
      await get().play(true);
    }
  },

  resetSoundtrack: () => {
    locationSeam.reset();
    if (playerInstance) {
      playerInstance.stop();
    }
    set({
      activePackage: null,
      activeAssociation: null,
      selectedCue: null,
      playbackStatus: 'silence',
      isUserPlaying: false,
    });
  },
}));
