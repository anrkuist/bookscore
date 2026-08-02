'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MdCheckCircle,
  MdClose,
  MdDelete,
  MdEdit,
  MdMusicNote,
  MdOutlineFileDownload,
  MdOutlineFileUpload,
  MdPause,
  MdPlayArrow,
  MdVolumeOff,
  MdVolumeUp,
  MdWarning,
} from 'react-icons/md';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isBookScoreCapabilityEnabled } from '@/services/bookscore/capability';
import {
  associateSoundtrackToEdition,
  computeSoundtrackCandidates,
  detachSoundtrackFromEdition,
  importAndAssociateBookScorePackage,
} from '@/services/bookscore/importService';
import {
  loadInstalledPackages,
  loadLocalAssociations,
  StoredAssociationsMap,
  StoredPackagesMap,
} from '@/services/bookscore/persistence';
import {
  addAssetToCopy,
  addCueAtCfi,
  editCue,
  exportEditableCopy,
  makeEditableCopy,
  removeAssetFromCopy,
  removeCue,
  updateCopyTitle,
  validateEditableCopy,
} from '@/services/bookscore/authoringService';
import {
  AudioCue,
  CueValidationIssue,
  InstalledPackage,
  SilenceCue,
  SoundtrackAsset,
  SoundtrackCandidate,
  SoundtrackCue,
} from '@/services/bookscore/types';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import { FileSystem } from '@/types/system';
import Dialog from '../Dialog';

export interface SoundtrackPanelProps {
  editionId?: string;
  isMobile?: boolean;
  /** Current reader CFI – used to anchor new cues in authoring mode. */
  currentCfi?: string;
}

export const SoundtrackPanel: React.FC<SoundtrackPanelProps> = ({
  editionId,
  isMobile,
  currentCfi,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const capabilityEnabled = useSoundtrackStore((s) => s.capabilityEnabled);
  const activePackage = useSoundtrackStore((s) => s.activePackage);
  const activeAssociation = useSoundtrackStore((s) => s.activeAssociation);
  const selectedCue = useSoundtrackStore((s) => s.selectedCue);
  const playbackStatus = useSoundtrackStore((s) => s.playbackStatus);
  const volume = useSoundtrackStore((s) => s.volume);
  const isPanelOpen = useSoundtrackStore((s) => s.isPanelOpen);
  const repairQueue = useSoundtrackStore((s) => s.repairQueue);
  const loadRepairQueueAction = useSoundtrackStore((s) => s.loadRepairQueueAction);
  const activeEditionIdFromStore = useSoundtrackStore((s) => s.activeEditionId);
  const activeBookKeyFromStore = useSoundtrackStore((s) => s.activeBookKey);

  const editableCopy = useSoundtrackStore((s) => s.editableCopy);
  const isAuthoringMode = useSoundtrackStore((s) => s.isAuthoringMode);
  const isPreviewingCue = useSoundtrackStore((s) => s.isPreviewingCue);
  const enterAuthoringMode = useSoundtrackStore((s) => s.enterAuthoringMode);
  const exitAuthoringMode = useSoundtrackStore((s) => s.exitAuthoringMode);
  const updateEditableCopy = useSoundtrackStore((s) => s.updateEditableCopy);
  const startCuePreview = useSoundtrackStore((s) => s.startCuePreview);
  const stopCuePreview = useSoundtrackStore((s) => s.stopCuePreview);

  const togglePlayPause = useSoundtrackStore((s) => s.togglePlayPause);
  const setVolume = useSoundtrackStore((s) => s.setVolume);
  const setPanelOpen = useSoundtrackStore((s) => s.setPanelOpen);
  const loadSoundtrackForBook = useSoundtrackStore((s) => s.loadSoundtrackForBook);

  const currentEditionId = editionId || activeEditionIdFromStore || '';

  const [packages, setPackages] = useState<StoredPackagesMap>({});
  const [associations, setAssociations] = useState<StoredAssociationsMap>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [consentTarget, setConsentTarget] = useState<InstalledPackage | null>(null);
  const [preMuteVolume, setPreMuteVolume] = useState<number>(1.0);

  // Authoring mode local state
  const [authoringTitle, setAuthoringTitle] = useState('');
  const [editingCue, setEditingCue] = useState<SoundtrackCue | null>(null);
  const [validationIssues, setValidationIssues] = useState<CueValidationIssue[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const repairFileInputRef = useRef<HTMLInputElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  const isEnabled = capabilityEnabled && isBookScoreCapabilityEnabled({ isMobile });

  const activeRepairItem = activePackage
    ? (repairQueue[`${activePackage.packageId}:${activePackage.manifestHash}`] ??
      repairQueue[activePackage.packageId])
    : null;

  const refreshAttachments = async (): Promise<{
    packages: StoredPackagesMap;
    associations: StoredAssociationsMap;
  }> => {
    if (!appService)
      return { packages: {} as StoredPackagesMap, associations: {} as StoredAssociationsMap };
    try {
      const fs = appService as unknown as FileSystem;
      const pkgs = await loadInstalledPackages(fs, 'Data');
      const assocs = await loadLocalAssociations(fs, 'Data');
      setPackages(pkgs);
      setAssociations(assocs);
      setLoading(false);
      return { packages: pkgs, associations: assocs };
    } catch (err) {
      console.warn('Failed to load soundtrack attachments:', err);
      setLoading(false);
      return { packages: {}, associations: {} };
    }
  };

  useEffect(() => {
    if (isEnabled && isPanelOpen) {
      refreshAttachments();
      loadRepairQueueAction();
    }
  }, [isEnabled, isPanelOpen, currentEditionId]);

  const handleRepairFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !appService || !currentEditionId) return;
    setErrorMsg(null);

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const fs = appService as unknown as FileSystem;

      const res = await importAndAssociateBookScorePackage(
        fs,
        'Data',
        bytes,
        currentEditionId,
        undefined,
        { autoAttach: true },
      );

      if (!res.success) {
        setErrorMsg(res.error || _('Failed to repair soundtrack package.'));
        return;
      }

      const fresh = await refreshAttachments();
      await loadRepairQueueAction();
      loadSoundtrackForBook(
        currentEditionId,
        fresh.packages,
        fresh.associations,
        undefined,
        activeBookKeyFromStore || undefined,
      );
    } catch (err) {
      setErrorMsg(`Repair failed: ${err}`);
    } finally {
      if (repairFileInputRef.current) {
        repairFileInputRef.current.value = '';
      }
    }
  };

  // Keyboard focus lifecycle & Tab/Shift+Tab focus containment
  useEffect(() => {
    if (!isPanelOpen || consentTarget) return;

    if (typeof document !== 'undefined' && document.activeElement) {
      previouslyFocusedElementRef.current = document.activeElement as HTMLElement;
    }

    // Set initial focus to close button
    const focusTimeout = setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanelOpen(false);
        return;
      }

      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;

        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;

        if (e.shiftKey) {
          if (
            document.activeElement === first ||
            !panelRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (
            document.activeElement === last ||
            !panelRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimeout);
      window.removeEventListener('keydown', handleKeyDown);
      if (
        previouslyFocusedElementRef.current &&
        typeof previouslyFocusedElementRef.current.focus === 'function'
      ) {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, [isPanelOpen, consentTarget, setPanelOpen]);

  const storeCfi = useSoundtrackStore((s) => s.currentCfi);
  const effectiveCfi = currentCfi || storeCfi || 'epubcfi(/6/2!/4/2:0)';

  const assetFileInputRef = useRef<HTMLInputElement>(null);

  const handleMakeEditableCopy = useCallback(
    async (pkg: InstalledPackage) => {
      if (!appService || !currentEditionId) return;
      setErrorMsg(null);
      const fs = appService as unknown as FileSystem;
      const res = await makeEditableCopy(
        fs,
        'Data',
        pkg.packageId,
        pkg.manifestHash,
        currentEditionId,
      );
      if (!res.success) {
        setErrorMsg(res.error);
        return;
      }
      setAuthoringTitle(res.copy.manifest.title);
      setValidationIssues([]);
      setExportError(null);
      enterAuthoringMode(res.copy);
    },
    [appService, currentEditionId, enterAuthoringMode],
  );

  const handleAssetFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !editableCopy) return;
      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const assetId = `asset-${Date.now()}`;
        const exportPath = `audio/${assetId}.mp3`;

        let durationSec = 10;
        try {
          const { defaultAudioDecoder } = await import('@/services/bookscore/packageValidation');
          const decoded = await defaultAudioDecoder(bytes);
          if (decoded?.durationSec && decoded.durationSec > 0) {
            durationSec = Math.round(decoded.durationSec * 10) / 10;
          }
        } catch (_) {}

        const { sha256Hex } = await import('@/services/bookscore/packageValidation');
        const hash = await sha256Hex(bytes);

        const newAsset: SoundtrackAsset = {
          id: assetId,
          path: exportPath,
          mimeType: 'audio/mpeg',
          hash,
          durationSec,
        };

        const updated = addAssetToCopy(editableCopy, newAsset, bytes);
        updateEditableCopy(updated);
        setValidationIssues([]);
      } finally {
        if (assetFileInputRef.current) {
          assetFileInputRef.current.value = '';
        }
      }
    },
    [editableCopy, updateEditableCopy],
  );

  const handleRemoveAsset = useCallback(
    (assetId: string) => {
      if (!editableCopy) return;
      const updated = removeAssetFromCopy(editableCopy, assetId);
      updateEditableCopy(updated);
      setValidationIssues([]);
    },
    [editableCopy, updateEditableCopy],
  );

  const handleAddAudioCueHere = useCallback(() => {
    if (!editableCopy) return;
    const assets = editableCopy.manifest.assets;
    const firstAsset = assets[0];
    const assetId = firstAsset ? firstAsset.id : 'asset-1';
    const duration = firstAsset ? firstAsset.durationSec : 10;

    const newId = `cue-${Date.now()}`;
    const newCue: AudioCue = {
      id: newId,
      startCfi: effectiveCfi,
      type: 'audio',
      assetId,
      startSec: 0,
      loopStartSec: 0,
      loopEndSec: duration,
      volume: 1,
      crossfadeSec: 0.5,
    };
    const updated = addCueAtCfi(editableCopy, newCue);
    updateEditableCopy(updated);
    setEditingCue(newCue);
    setValidationIssues([]);
  }, [editableCopy, effectiveCfi, updateEditableCopy]);

  const handleAddSilenceCueHere = useCallback(() => {
    if (!editableCopy) return;
    const newId = `cue-${Date.now()}`;
    const newCue: SilenceCue = { id: newId, startCfi: effectiveCfi, type: 'silence' };
    const updated = addCueAtCfi(editableCopy, newCue);
    updateEditableCopy(updated);
    setEditingCue(newCue);
    setValidationIssues([]);
  }, [editableCopy, effectiveCfi, updateEditableCopy]);

  const handleRemoveCue = useCallback(
    (cueId: string) => {
      if (!editableCopy) return;
      const updated = removeCue(editableCopy, cueId);
      updateEditableCopy(updated);
      if (editingCue?.id === cueId) setEditingCue(null);
      setValidationIssues([]);
    },
    [editableCopy, editingCue, updateEditableCopy],
  );

  const handleEditCueSave = useCallback(
    (cue: SoundtrackCue) => {
      if (!editableCopy) return;
      const updated = editCue(editableCopy, cue);
      updateEditableCopy(updated);
      setEditingCue(null);
      setValidationIssues([]);
    },
    [editableCopy, updateEditableCopy],
  );

  const handleAuthoringTitleBlur = useCallback(() => {
    if (!editableCopy) return;
    const updated = updateCopyTitle(editableCopy, authoringTitle);
    updateEditableCopy(updated);
  }, [editableCopy, authoringTitle, updateEditableCopy]);

  const handleValidate = useCallback(() => {
    if (!editableCopy) return;
    const result = validateEditableCopy(editableCopy);
    setValidationIssues(result.issues);
    setExportError(null);
  }, [editableCopy]);

  const handleExport = useCallback(async () => {
    if (!editableCopy) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const result = await exportEditableCopy(editableCopy);
      if (!result.success) {
        setExportError(result.error);
        if ('issues' in result && result.issues) {
          setValidationIssues(result.issues);
        }
        return;
      }
      // Trigger download in browser
      if (typeof window !== 'undefined') {
        const buf = result.archiveBytes.buffer.slice(
          result.archiveBytes.byteOffset,
          result.archiveBytes.byteOffset + result.archiveBytes.byteLength,
        ) as ArrayBuffer;
        const blob = new Blob([buf], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${editableCopy.manifest.title || 'soundtrack'}.bookscore`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setExportError(String(err));
    } finally {
      setIsExporting(false);
    }
  }, [editableCopy]);

  if (!isEnabled || !isPanelOpen) {
    return null;
  }

  const isPlaying = playbackStatus === 'playing';
  const isGestureRequired = playbackStatus === 'gesture_required';
  const isSilence = playbackStatus === 'silence' || (selectedCue && selectedCue.type === 'silence');

  const cueLabel = selectedCue
    ? selectedCue.type === 'audio'
      ? `${_('Audio Cue')} (${selectedCue.id})`
      : _('Quiet State (Silence)')
    : _('No Cue Loaded');

  const { candidates } = computeSoundtrackCandidates(currentEditionId, packages, associations);

  const handleToggleMute = () => {
    if (volume > 0) {
      setPreMuteVolume(volume);
      setVolume(0);
    } else {
      setVolume(preMuteVolume || 0.8);
    }
  };

  const handleSelectCandidate = async (cand: SoundtrackCandidate) => {
    if (!appService || !currentEditionId) return;
    setErrorMsg(null);

    if (cand.trustState === 'unverified') {
      setConsentTarget(cand.package);
      return;
    }

    const fs = appService as unknown as FileSystem;
    const res = await associateSoundtrackToEdition(
      fs,
      'Data',
      currentEditionId,
      cand.package.packageId,
      cand.package.manifestHash,
    );

    if (res.success) {
      const fresh = await refreshAttachments();
      loadSoundtrackForBook(
        currentEditionId,
        fresh.packages,
        fresh.associations,
        undefined,
        activeBookKeyFromStore || undefined,
      );
    } else if (res.error) {
      setErrorMsg(res.error);
    }
  };

  const handleConfirmUnverifiedConsent = async () => {
    if (!consentTarget || !appService || !currentEditionId) return;
    const fs = appService as unknown as FileSystem;
    const pkg = consentTarget;
    setConsentTarget(null);

    const res = await associateSoundtrackToEdition(
      fs,
      'Data',
      currentEditionId,
      pkg.packageId,
      pkg.manifestHash,
      { consentGiven: true },
    );

    if (res.success) {
      const fresh = await refreshAttachments();
      loadSoundtrackForBook(
        currentEditionId,
        fresh.packages,
        fresh.associations,
        undefined,
        activeBookKeyFromStore || undefined,
      );
    } else if (res.error) {
      setErrorMsg(res.error);
    }
  };

  const handleDetachActive = async () => {
    if (!appService || !currentEditionId) return;
    setErrorMsg(null);
    const fs = appService as unknown as FileSystem;
    const res = await detachSoundtrackFromEdition(fs, 'Data', currentEditionId);
    if (res.success) {
      const fresh = await refreshAttachments();
      loadSoundtrackForBook(
        currentEditionId,
        fresh.packages,
        fresh.associations,
        undefined,
        activeBookKeyFromStore || undefined,
      );
    }
  };

  return (
    <>
      <div
        ref={panelRef}
        role='dialog'
        aria-label={_('Soundtrack Control Panel')}
        aria-modal='true'
        className={clsx(
          'soundtrack-panel fixed top-0 end-0 z-40 h-full w-80 sm:w-96 bg-base-100 shadow-2xl',
          'border-s border-base-300 flex flex-col',
          'eink-bordered text-base-content overflow-hidden',
        )}
      >
        {/* Panel Header — DESIGN.md §2.9 Compliant */}
        <div className='flex items-start justify-between px-4 py-3 border-b border-base-300 bg-base-200/50'>
          <div className='flex items-start gap-2 min-w-0'>
            <MdMusicNote className='h-5 w-5 text-primary shrink-0 mt-0.5' />
            <div className='flex flex-col min-w-0'>
              <h2 className='text-lg font-semibold tracking-tight truncate'>{_('Soundtrack')}</h2>
              <p className='text-sm text-base-content/70 leading-relaxed truncate'>
                {_('Manage soundtrack playback, volume, and attached packages.')}
              </p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type='button'
            className='btn btn-ghost btn-xs btn-circle eink-bordered shrink-0 ms-2'
            onClick={() => setPanelOpen(false)}
            aria-label={_('Close soundtrack panel')}
          >
            <MdClose className='h-4 w-4' />
          </button>
        </div>

        {/* Panel Body */}
        <div className='flex-1 overflow-y-auto p-4 space-y-5'>
          {errorMsg && (
            <div className='alert alert-error text-xs p-2.5 rounded-lg flex items-center justify-between'>
              <span>{errorMsg}</span>
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                onClick={() => setErrorMsg(null)}
                aria-label={_('Dismiss soundtrack error')}
              >
                ✕
              </button>
            </div>
          )}

          {/* Current State / Audio Card */}
          <div className='p-3.5 rounded-lg border border-base-300 bg-base-200/40 space-y-3 eink-bordered'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-xs font-semibold uppercase tracking-wider text-neutral-content/90'>
                {_('Status')}
              </span>
              {activeRepairItem ? (
                <span className='badge badge-error gap-1 text-xs py-0.5 px-2 font-medium text-white'>
                  <MdWarning className='h-3 w-3 me-0.5 inline' />
                  {_('Silence (Repair Required)')}
                </span>
              ) : isPlaying ? (
                <span className='badge badge-success gap-1 text-xs py-0.5 px-2 font-medium text-white'>
                  {_('Playing')}
                </span>
              ) : isGestureRequired ? (
                <span className='badge badge-warning text-xs py-0.5 px-2 font-medium'>
                  {_('Click Play')}
                </span>
              ) : isSilence ? (
                <span className='badge badge-neutral text-xs py-0.5 px-2 font-medium'>
                  {_('Armed Quiet State')}
                </span>
              ) : (
                <span className='badge badge-warning text-xs py-0.5 px-2 font-medium'>
                  {_('Paused')}
                </span>
              )}
            </div>

            <div className='text-sm font-medium text-base-content/90 line-clamp-1'>{cueLabel}</div>

            {activeRepairItem && (
              <div className='p-3 rounded-lg border border-warning bg-warning/10 space-y-2 text-xs eink-bordered'>
                <div className='flex items-center gap-1.5 font-bold text-base-content'>
                  <MdWarning className='h-4 w-4 text-warning shrink-0' />
                  <span>
                    {_('Package failure ({reason})', { reason: activeRepairItem.reason })}
                  </span>
                </div>
                <p className='text-neutral-content text-[11px] leading-relaxed'>
                  {_(
                    'Audio file for this soundtrack is missing, unreadable, or corrupted. Re-import the package to repair.',
                  )}
                </p>
                <div className='pt-1 flex items-center gap-2'>
                  <input
                    type='file'
                    ref={repairFileInputRef}
                    accept='.bookscore,.zip'
                    className='hidden'
                    onChange={handleRepairFileChange}
                  />
                  <button
                    type='button'
                    className='btn btn-xs btn-contrast gap-1.5 font-semibold'
                    onClick={() => repairFileInputRef.current?.click()}
                  >
                    <MdOutlineFileUpload className='h-3.5 w-3.5' />
                    {_('Repair Soundtrack')}
                  </button>
                </div>
              </div>
            )}

            {/* Explicit Play / Pause / Resume Button */}
            <div className='pt-1 flex items-center justify-center'>
              <button
                type='button'
                className={clsx(
                  'btn btn-contrast btn-md w-full gap-2 font-semibold eink-bordered',
                  isPlaying ? 'btn-outline' : '',
                )}
                onClick={() => void togglePlayPause()}
                aria-label={
                  isPlaying
                    ? _('Pause soundtrack')
                    : playbackStatus === 'paused'
                      ? _('Resume soundtrack')
                      : _('Play soundtrack')
                }
              >
                {isPlaying ? (
                  <>
                    <MdPause className='h-5 w-5' />
                    {_('Pause')}
                  </>
                ) : (
                  <>
                    <MdPlayArrow className='h-5 w-5' />
                    {playbackStatus === 'paused' ? _('Resume') : _('Play')}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Volume Control */}
          <div className='p-3.5 rounded-lg border border-base-300 bg-base-200/40 space-y-2 eink-bordered'>
            <div className='flex items-center justify-between text-xs font-semibold text-neutral-content/90'>
              <span>{_('Volume')}</span>
              <span>{Math.round(volume * 100)}%</span>
            </div>
            <div className='flex items-center gap-3'>
              <button
                type='button'
                className='btn btn-ghost btn-xs p-1'
                onClick={handleToggleMute}
                aria-label={volume === 0 ? _('Unmute volume') : _('Mute volume')}
              >
                {volume === 0 ? (
                  <MdVolumeOff className='h-5 w-5 text-error' />
                ) : (
                  <MdVolumeUp className='h-5 w-5' />
                )}
              </button>
              <input
                type='range'
                min='0'
                max='1'
                step='0.01'
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className='range range-xs range-primary flex-1'
                aria-label={_('Soundtrack volume slider')}
              />
            </div>
          </div>

          {/* Switching Existing Attachments List */}
          <div className='space-y-2.5 pt-1'>
            <div className='flex items-center justify-between'>
              <h3 className='text-xs font-bold uppercase tracking-wider text-neutral-content/90'>
                {_('Attached Soundtrack Packages')}
              </h3>
              {activeAssociation && (
                <button
                  type='button'
                  className='btn btn-xs btn-ghost border border-base-300 text-xs eink-bordered'
                  onClick={handleDetachActive}
                >
                  {_('Detach')}
                </button>
              )}
            </div>

            {loading ? (
              <p className='text-xs text-neutral-content not-eink:animate-pulse py-2'>
                {_('Loading soundtrack attachments...')}
              </p>
            ) : candidates.length === 0 ? (
              <p className='text-xs text-neutral-content italic py-1'>
                {_('No soundtrack packages attached to this edition.')}
              </p>
            ) : (
              <div className='space-y-2 max-h-56 overflow-y-auto pe-1'>
                {candidates.map((cand) => (
                  <div
                    key={`${cand.package.packageId}:${cand.package.manifestHash}`}
                    className={clsx(
                      'p-2.5 rounded-lg border text-xs space-y-2',
                      cand.isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-base-300 bg-base-100',
                      'eink-bordered',
                    )}
                  >
                    <div className='flex items-center justify-between gap-2'>
                      <div className='min-w-0 flex-1 space-y-0.5'>
                        <div className='flex items-center gap-1.5 flex-wrap'>
                          <span className='font-semibold line-clamp-1'>
                            {cand.package.manifest.title}
                          </span>
                          {cand.trustState === 'verified' ? (
                            <span
                              className='badge badge-xs badge-success text-white shrink-0'
                              title={_('EPUB edition fingerprint match verified.')}
                            >
                              <MdCheckCircle className='h-2.5 w-2.5 me-0.5 inline' />
                              {_('Verified')}
                            </span>
                          ) : (
                            <span
                              className='badge badge-xs badge-warning shrink-0'
                              title={_(
                                'EPUB edition fingerprint mismatch. Consent required for local association.',
                              )}
                            >
                              <MdWarning className='h-2.5 w-2.5 me-0.5 inline' />
                              {_('Unverified')}
                            </span>
                          )}
                        </div>
                        <p className='text-[11px] text-neutral-content'>
                          v{cand.package.manifest.version}
                        </p>
                      </div>

                      <div className='shrink-0'>
                        {cand.isSelected ? (
                          <span className='text-xs font-semibold text-primary px-2 py-0.5 bg-primary/10 rounded'>
                            {_('Active')}
                          </span>
                        ) : (
                          <button
                            type='button'
                            className={clsx(
                              'btn btn-xs',
                              cand.trustState === 'verified'
                                ? 'btn-contrast'
                                : 'btn-outline btn-warning',
                            )}
                            onClick={() => handleSelectCandidate(cand)}
                            aria-label={
                              cand.trustState === 'verified'
                                ? _('Attach verified package')
                                : _('Attach unverified package')
                            }
                          >
                            {cand.trustState === 'verified' ? _('Switch') : _('Switch (Consent)')}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Make editable copy button — only for selected package */}
                    {cand.isSelected && (
                      <button
                        type='button'
                        id={`make-editable-copy-${cand.package.packageId}`}
                        className='btn btn-xs btn-ghost border border-base-300 w-full eink-bordered gap-1'
                        onClick={() => handleMakeEditableCopy(cand.package)}
                        aria-label={_('Make an editable copy of this soundtrack')}
                      >
                        <MdEdit className='h-3.5 w-3.5' />
                        {_('Make Editable Copy')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Authoring Mode Panel (inline, replaces reading view when active) */}
          {isAuthoringMode && editableCopy && (
            <div className='border border-primary/30 rounded-lg bg-primary/5 space-y-3 p-3.5 eink-bordered'>
              <div className='flex items-center justify-between'>
                <span className='text-xs font-bold uppercase tracking-wider text-primary/80'>
                  {_('Authoring Mode')}
                </span>
                <button
                  type='button'
                  id='exit-authoring-mode'
                  className='btn btn-xs btn-ghost eink-bordered'
                  onClick={exitAuthoringMode}
                  aria-label={_('Exit authoring mode')}
                >
                  {_('← Reading')}
                </button>
              </div>

              {/* Title editor */}
              <label className='block text-xs font-medium'>
                {_('Soundtrack name')}
                <input
                  id='authoring-title-input'
                  className='mt-1 w-full rounded border border-base-300 bg-base-100 px-2 py-1.5 text-sm font-normal eink-bordered'
                  value={authoringTitle}
                  onChange={(e) => setAuthoringTitle(e.target.value)}
                  onBlur={handleAuthoringTitleBlur}
                  aria-label={_('Soundtrack name')}
                />
              </label>

              {/* MP3 Assets section */}
              <div>
                <div className='flex items-center justify-between mb-1.5'>
                  <span className='text-xs font-semibold'>{_('MP3 Assets')}</span>
                  <input
                    type='file'
                    ref={assetFileInputRef}
                    accept='audio/mpeg,.mp3'
                    className='hidden'
                    onChange={handleAssetFileUpload}
                  />
                  <button
                    type='button'
                    id='upload-mp3-asset'
                    className='btn btn-xs btn-ghost border border-base-300 eink-bordered gap-1'
                    onClick={() => assetFileInputRef.current?.click()}
                    aria-label={_('Upload MP3 asset')}
                  >
                    + {_('Upload MP3')}
                  </button>
                </div>

                <div className='space-y-1 max-h-32 overflow-y-auto pe-1'>
                  {editableCopy.manifest.assets.length === 0 && (
                    <p className='text-xs text-neutral-content italic py-0.5'>
                      {_('No MP3 assets added yet.')}
                    </p>
                  )}
                  {editableCopy.manifest.assets.map((asset) => (
                    <div
                      key={asset.id}
                      className='flex items-center justify-between gap-1 rounded border border-base-300 bg-base-100 px-2 py-1 text-xs eink-bordered'
                    >
                      <div className='min-w-0 flex-1 truncate'>
                        <span className='font-medium'>{asset.id}</span>
                        <span className='text-[10px] text-neutral-content ms-1'>
                          ({asset.durationSec}s)
                        </span>
                      </div>
                      <button
                        type='button'
                        id={`remove-asset-${asset.id}`}
                        className='btn btn-xs btn-ghost p-0.5 text-error shrink-0'
                        onClick={() => handleRemoveAsset(asset.id)}
                        aria-label={_('Remove asset')}
                      >
                        <MdDelete className='h-3.5 w-3.5' />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cue list */}
              <div>
                <div className='flex items-center justify-between mb-1.5'>
                  <span className='text-xs font-semibold'>{_('Cues')}</span>
                  <div className='flex gap-1'>
                    <button
                      type='button'
                      id='add-audio-cue-at-position'
                      className='btn btn-xs btn-ghost border border-base-300 eink-bordered gap-1'
                      onClick={handleAddAudioCueHere}
                      aria-label={_('Add Audio cue at current reading position')}
                    >
                      + {_('Audio Cue')}
                    </button>
                    <button
                      type='button'
                      id='add-silence-cue-at-position'
                      className='btn btn-xs btn-ghost border border-base-300 eink-bordered gap-1'
                      onClick={handleAddSilenceCueHere}
                      aria-label={_('Add Silence cue at current reading position')}
                    >
                      + {_('Silence Cue')}
                    </button>
                  </div>
                </div>

                <div className='space-y-1.5 max-h-40 overflow-y-auto'>
                  {editableCopy.manifest.cues.length === 0 && (
                    <p className='text-xs text-neutral-content italic py-1'>
                      {_('No cues yet. Add one at the current position.')}
                    </p>
                  )}
                  {editableCopy.manifest.cues.map((cue) => (
                    <div
                      key={cue.id}
                      className={clsx(
                        'flex items-center justify-between gap-1 rounded border px-2 py-1 text-xs',
                        editingCue?.id === cue.id
                          ? 'border-primary bg-primary/5'
                          : 'border-base-300 bg-base-100',
                        'eink-bordered',
                      )}
                    >
                      <div className='min-w-0 flex-1'>
                        <span className='font-mono text-[10px] text-neutral-content truncate block'>
                          {cue.startCfi}
                        </span>
                        <span className='font-medium'>
                          {cue.type === 'silence' ? _('Silence') : cue.assetId}
                        </span>
                      </div>
                      <div className='shrink-0 flex gap-1'>
                        {cue.type === 'audio' && (
                          <button
                            type='button'
                            id={`preview-cue-${cue.id}`}
                            className='btn btn-xs btn-ghost p-0.5'
                            onClick={() =>
                              isPreviewingCue ? stopCuePreview() : void startCuePreview(cue)
                            }
                            aria-label={
                              isPreviewingCue && editingCue?.id === cue.id
                                ? _('Stop preview')
                                : _('Preview cue')
                            }
                          >
                            {isPreviewingCue && editingCue?.id === cue.id ? (
                              <MdPause className='h-3.5 w-3.5' />
                            ) : (
                              <MdPlayArrow className='h-3.5 w-3.5' />
                            )}
                          </button>
                        )}
                        <button
                          type='button'
                          id={`edit-cue-${cue.id}`}
                          className='btn btn-xs btn-ghost p-0.5'
                          onClick={() => setEditingCue(editingCue?.id === cue.id ? null : cue)}
                          aria-label={_('Edit cue')}
                        >
                          <MdEdit className='h-3.5 w-3.5' />
                        </button>
                        <button
                          type='button'
                          id={`remove-cue-${cue.id}`}
                          className='btn btn-xs btn-ghost p-0.5 text-error'
                          onClick={() => handleRemoveCue(cue.id)}
                          aria-label={_('Remove cue')}
                        >
                          <MdDelete className='h-3.5 w-3.5' />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Inline cue editor */}
              {editingCue && (
                <CueEditor
                  cue={editingCue}
                  assets={editableCopy.manifest.assets}
                  onSave={handleEditCueSave}
                  onCancel={() => setEditingCue(null)}
                  _={_}
                />
              )}

              {/* Validation issues */}
              {validationIssues.length > 0 && (
                <div className='space-y-1'>
                  {validationIssues.map((issue, idx) => (
                    <div
                      key={idx}
                      className={clsx(
                        'text-xs rounded px-2 py-1',
                        issue.severity === 'error'
                          ? 'bg-error/10 text-error'
                          : 'bg-warning/10 text-warning',
                      )}
                    >
                      {issue.severity === 'error' ? '✕' : '⚠'} {issue.message}
                    </div>
                  ))}
                </div>
              )}

              {exportError && (
                <p className='text-xs text-error rounded bg-error/10 px-2 py-1'>{exportError}</p>
              )}

              {/* Validate + Export actions */}
              <div className='grid grid-cols-2 gap-2 pt-1'>
                <button
                  type='button'
                  id='validate-editable-copy'
                  className='btn btn-xs btn-ghost border border-base-300 eink-bordered'
                  onClick={handleValidate}
                >
                  {_('Validate')}
                </button>
                <button
                  type='button'
                  id='export-editable-copy'
                  className='btn btn-xs btn-contrast gap-1'
                  onClick={() => void handleExport()}
                  disabled={isExporting}
                  aria-label={_('Export editable copy as .bookscore file')}
                >
                  {isExporting ? (
                    <span className='not-eink:animate-spin'>⟳</span>
                  ) : (
                    <MdOutlineFileDownload className='h-3.5 w-3.5' />
                  )}
                  {_('Export')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Unverified Consent Modal */}
      {consentTarget && (
        <Dialog
          isOpen={Boolean(consentTarget)}
          title={_('Attach Unverified Soundtrack')}
          onClose={() => setConsentTarget(null)}
          boxClassName='sm:max-w-[440px] sm:h-auto'
        >
          <div className='p-4 space-y-4 text-sm select-text'>
            <div className='flex items-start gap-3 text-warning'>
              <MdWarning className='h-6 w-6 shrink-0 mt-0.5' />
              <div>
                <p className='font-bold text-base-content'>{_('Edition Fingerprint Mismatch')}</p>
                <p className='text-xs text-neutral-content mt-1'>
                  {_(
                    "This soundtrack package ('{title}') was created for a different EPUB edition fingerprint.",
                    {
                      title: consentTarget.manifest.title,
                    },
                  )}
                </p>
              </div>
            </div>

            <p className='text-xs leading-relaxed text-neutral-content'>
              {_(
                'Audio timing or CFI paragraph alignment issues may occur when attached to a mismatched edition. Do you want to proceed and persist a local-only unverified association for this edition?',
              )}
            </p>

            <div className='flex justify-end gap-2 pt-2'>
              <button
                type='button'
                className='btn btn-sm btn-ghost eink-bordered'
                onClick={() => setConsentTarget(null)}
              >
                {_('Cancel')}
              </button>
              <button
                type='button'
                className='btn btn-sm btn-contrast'
                onClick={handleConfirmUnverifiedConsent}
              >
                {_('Attach as Unverified')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// CueEditor – inline editor for SoundtrackCue (Audio or Silence)
// ---------------------------------------------------------------------------

interface CueEditorProps {
  cue: SoundtrackCue;
  assets: SoundtrackAsset[];
  onSave: (cue: SoundtrackCue) => void;
  onCancel: () => void;
  _: (key: string) => string;
}

const CueEditor: React.FC<CueEditorProps> = ({ cue, assets, onSave, onCancel, _ }) => {
  const [cueType, setCueType] = useState<'audio' | 'silence'>(cue.type);
  const [assetId, setAssetId] = useState<string>(
    cue.type === 'audio' ? cue.assetId : assets[0]?.id || 'asset-1',
  );
  const [startSec, setStartSec] = useState(cue.type === 'audio' ? String(cue.startSec) : '0');
  const [loopStartSec, setLoopStartSec] = useState(
    cue.type === 'audio' ? String(cue.loopStartSec) : '0',
  );

  const selectedAsset = assets.find((a) => a.id === assetId);
  const defaultLoopEnd = selectedAsset ? String(selectedAsset.durationSec) : '10';

  const [loopEndSec, setLoopEndSec] = useState(
    cue.type === 'audio' ? String(cue.loopEndSec) : defaultLoopEnd,
  );
  const [volume, setVolume] = useState(cue.type === 'audio' ? String(cue.volume) : '1');
  const [crossfadeSec, setCrossfadeSec] = useState(
    cue.type === 'audio' ? String(cue.crossfadeSec) : '0.5',
  );

  const handleSave = () => {
    if (cueType === 'silence') {
      const updated: SilenceCue = {
        id: cue.id,
        startCfi: cue.startCfi,
        type: 'silence',
      };
      onSave(updated);
    } else {
      const updated: AudioCue = {
        id: cue.id,
        startCfi: cue.startCfi,
        type: 'audio',
        assetId,
        startSec: parseFloat(startSec) || 0,
        loopStartSec: parseFloat(loopStartSec) || 0,
        loopEndSec: parseFloat(loopEndSec) || (selectedAsset ? selectedAsset.durationSec : 10),
        volume: Math.min(1, Math.max(0, parseFloat(volume) || 1)),
        crossfadeSec: parseFloat(crossfadeSec) || 0.5,
      };
      onSave(updated);
    }
  };

  return (
    <div className='rounded border border-primary/30 bg-base-100 p-2.5 space-y-2 text-xs eink-bordered'>
      <div className='flex items-center justify-between'>
        <p className='font-semibold text-primary/80'>
          {_('Edit Cue')}: {cue.id}
        </p>
        <label className='flex items-center gap-1.5 text-xs'>
          <span>{_('Type')}:</span>
          <select
            id={`cue-type-${cue.id}`}
            value={cueType}
            onChange={(e) => setCueType(e.target.value as 'audio' | 'silence')}
            className='select select-xs border border-base-300 bg-base-100 eink-bordered'
          >
            <option value='audio'>{_('Audio')}</option>
            <option value='silence'>{_('Silence')}</option>
          </select>
        </label>
      </div>

      {cueType === 'audio' && (
        <>
          <label className='flex items-center justify-between gap-2'>
            <span className='text-neutral-content shrink-0'>{_('Asset')}</span>
            <select
              id={`cue-asset-${cue.id}`}
              value={assetId}
              onChange={(e) => {
                const nextAssetId = e.target.value;
                setAssetId(nextAssetId);
                const a = assets.find((x) => x.id === nextAssetId);
                if (a) setLoopEndSec(String(a.durationSec));
              }}
              className='select select-xs border border-base-300 bg-base-100 flex-1 max-w-[160px] eink-bordered'
            >
              {assets.length === 0 && <option value='asset-1'>asset-1</option>}
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} ({a.durationSec}s)
                </option>
              ))}
            </select>
          </label>
          {[
            {
              label: _('Start (s)'),
              value: startSec,
              setter: setStartSec,
              id: `cue-start-${cue.id}`,
            },
            {
              label: _('Loop start (s)'),
              value: loopStartSec,
              setter: setLoopStartSec,
              id: `cue-loop-start-${cue.id}`,
            },
            {
              label: _('Loop end (s)'),
              value: loopEndSec,
              setter: setLoopEndSec,
              id: `cue-loop-end-${cue.id}`,
            },
            {
              label: _('Volume (0-1)'),
              value: volume,
              setter: setVolume,
              id: `cue-volume-${cue.id}`,
            },
            {
              label: _('Crossfade (s)'),
              value: crossfadeSec,
              setter: setCrossfadeSec,
              id: `cue-crossfade-${cue.id}`,
            },
          ].map(({ label, value, setter, id }) => (
            <label key={id} className='flex items-center justify-between gap-2'>
              <span className='text-neutral-content shrink-0'>{label}</span>
              <input
                id={id}
                type='number'
                step='0.01'
                className='input input-xs border border-base-300 bg-base-100 w-20 text-right eink-bordered'
                value={value}
                onChange={(e) => setter(e.target.value)}
              />
            </label>
          ))}
        </>
      )}

      {cueType === 'silence' && (
        <p className='text-[11px] text-neutral-content italic py-1'>
          {_('Silence cue will mute playback at this position.')}
        </p>
      )}

      <div className='flex gap-2 justify-end pt-1'>
        <button type='button' className='btn btn-xs btn-ghost eink-bordered' onClick={onCancel}>
          {_('Cancel')}
        </button>
        <button
          type='button'
          id={`save-cue-${cue.id}`}
          className='btn btn-xs btn-contrast'
          onClick={handleSave}
        >
          {_('Save')}
        </button>
      </div>
    </div>
  );
};
