import { create } from 'zustand';
import {
  EditableCopy,
  InstalledPackage,
  LocalAssociation,
  LocationReport,
  PlaybackStatus,
  SoundtrackCue,
  StoredRepairQueueMap,
} from '@/services/bookscore/types';
import { LocationReportSeam } from '@/services/bookscore/locationSeam';
import { SoundtrackPlayer } from '@/services/bookscore/soundtrackPlayer';
import { findCueForCfi } from '@/services/bookscore/cfiUtils';
import { verifySoundtrackAsset } from '@/services/bookscore/assetStorage';
import { loadRepairQueue, recordPackageRepairFailure } from '@/services/bookscore/persistence';
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
  repairQueue: StoredRepairQueueMap;

  /** Authoring mode: an in-progress editable copy being authored. */
  editableCopy: EditableCopy | null;
  /** True while the user is in Authoring Mode (editing the copy). */
  isAuthoringMode: boolean;
  /** True while a selected-cue preview is playing. */
  isPreviewingCue: boolean;

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
  setRepairQueue: (queue: StoredRepairQueueMap) => void;
  loadRepairQueueAction: (customFs?: FileSystem) => Promise<StoredRepairQueueMap>;

  /**
   * Enter Authoring Mode with the given editable copy.
   * Stops any ongoing playback so the user is in a clean editing state.
   */
  enterAuthoringMode: (copy: EditableCopy) => void;
  /** Exit Authoring Mode.  Does NOT discard the copy. */
  exitAuthoringMode: () => void;
  /** Replace the working EditableCopy in-store (e.g. after a cue CRUD mutation). */
  updateEditableCopy: (copy: EditableCopy) => void;
  /**
   * Start a preview of the given cue using the copy's embedded asset bytes.
   * Begins playback at the cue's configured startSec.
   * On stop (stopCuePreview) the player is paused and status returns to 'paused'.
   */
  startCuePreview: (cue: SoundtrackCue) => Promise<void>;
  /** Stop any active cue preview and return to paused state. */
  stopCuePreview: () => void;
}

const locationSeam = new LocationReportSeam();
let playerInstance: SoundtrackPlayer | null = null;

async function resolveAndPlayAudioCue(
  cue: SoundtrackCue,
  pkg: InstalledPackage,
  player: SoundtrackPlayer,
  customFs?: FileSystem,
  isResume = false,
  activeEditionId?: string | null,
  updateRepairQueueState?: (queue: StoredRepairQueueMap) => void,
): Promise<boolean> {
  if (cue.type !== 'audio') return false;

  const asset = pkg.manifest.assets.find((a) => a.id === cue.assetId);
  const appSvc = getInitializedAppService();
  const fs = customFs ?? (appSvc as unknown as FileSystem | undefined);

  if (!asset) {
    player.transitionToSilence();
    if (fs) {
      const updated = await recordPackageRepairFailure(fs, 'Data', {
        packageId: pkg.packageId,
        manifestHash: pkg.manifestHash,
        title: pkg.manifest.title,
        reason: 'missing',
        detectedAt: Date.now(),
        affectedEditionIds: activeEditionId ? [activeEditionId] : [],
      });
      updateRepairQueueState?.(updated);
    }
    return false;
  }

  let audioData: ArrayBuffer | undefined;

  try {
    if (fs) {
      const verifyRes = await verifySoundtrackAsset(
        fs,
        'Data',
        pkg.packageId,
        asset.id,
        pkg.manifestHash,
        asset.hash,
      );

      if (!verifyRes.ok || !verifyRes.buffer) {
        player.transitionToSilence();
        const reason = verifyRes.reason || 'missing';
        const updated = await recordPackageRepairFailure(fs, 'Data', {
          packageId: pkg.packageId,
          manifestHash: pkg.manifestHash,
          title: pkg.manifest.title,
          reason,
          assetId: asset.id,
          detectedAt: Date.now(),
          affectedEditionIds: activeEditionId ? [activeEditionId] : [],
        });
        updateRepairQueueState?.(updated);
        return false;
      }
      audioData = verifyRes.buffer;
    }

    await player.playCue(cue, audioData, isResume);
    return true;
  } catch (err) {
    console.warn('Failed to load or play soundtrack audio cue, falling back to safe silence:', err);
    player.transitionToSilence();
    if (fs) {
      const updated = await recordPackageRepairFailure(fs, 'Data', {
        packageId: pkg.packageId,
        manifestHash: pkg.manifestHash,
        title: pkg.manifest.title,
        reason: 'corrupt',
        assetId: asset.id,
        detectedAt: Date.now(),
        affectedEditionIds: activeEditionId ? [activeEditionId] : [],
      });
      updateRepairQueueState?.(updated);
    }
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
  repairQueue: {},
  editableCopy: null,
  isAuthoringMode: false,
  isPreviewingCue: false,

  setRepairQueue: (queue: StoredRepairQueueMap) => {
    set({ repairQueue: queue });
  },

  loadRepairQueueAction: async (customFs?: FileSystem) => {
    const appSvc = getInitializedAppService();
    const fs = customFs ?? (appSvc as unknown as FileSystem | undefined);
    if (!fs) return {};
    try {
      const queue = await loadRepairQueue(fs, 'Data');
      set({ repairQueue: queue });
      return queue;
    } catch (_) {
      return {};
    }
  },

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
    if (playerInstance) {
      playerInstance.transitionToSilence();
    }
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
          void resolveAndPlayAudioCue(
            newCue,
            activePackage,
            playerInstance,
            undefined,
            false,
            get().activeEditionId,
            (queue) => set({ repairQueue: queue }),
          ).then((success) => {
            if (!success) {
              set({ playbackStatus: 'silence' });
            }
          });
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
        activeEditionId,
        (queue) => set({ repairQueue: queue }),
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
      editableCopy: null,
      isAuthoringMode: false,
      isPreviewingCue: false,
    });
  },

  enterAuthoringMode: (copy: EditableCopy) => {
    // Pause any active reading playback when entering authoring mode
    if (playerInstance) {
      playerInstance.pause();
    }
    set({
      editableCopy: copy,
      isAuthoringMode: true,
      isPreviewingCue: false,
      isUserPlaying: false,
      playbackStatus: 'paused',
    });
  },

  exitAuthoringMode: () => {
    // Stop any preview playback on exit
    if (playerInstance) {
      playerInstance.pause();
    }
    set({
      isAuthoringMode: false,
      isPreviewingCue: false,
      isUserPlaying: false,
      playbackStatus: 'silence',
    });
  },

  updateEditableCopy: (copy: EditableCopy) => {
    set({ editableCopy: copy });
  },

  startCuePreview: async (cue: SoundtrackCue) => {
    const { editableCopy, isGestureUnlocked } = get();
    if (!editableCopy || !playerInstance) return;
    if (cue.type !== 'audio') return;

    // Unlock gesture if needed
    let unlocked = isGestureUnlocked;
    if (!unlocked) {
      unlocked = await playerInstance.unlockGesture();
      set({ isGestureUnlocked: unlocked });
    }
    if (!unlocked) return;

    const { resolvePreviewAsset } = await import('@/services/bookscore/authoringService');
    const previewResult = resolvePreviewAsset(editableCopy, cue);
    if (!previewResult) return;

    try {
      // Preview always starts from configured startSec (not saved offset)
      await playerInstance.playCue(previewResult.cue, previewResult.audioData, false);
      set({ isPreviewingCue: true, playbackStatus: 'playing' });
    } catch (_) {
      set({ isPreviewingCue: false });
    }
  },

  stopCuePreview: () => {
    if (playerInstance) {
      playerInstance.pause();
    }
    set({ isPreviewingCue: false, playbackStatus: 'paused' });
  },
}));
