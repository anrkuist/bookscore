'use client';

import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import {
  MdCheckCircle,
  MdClose,
  MdMusicNote,
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
} from '@/services/bookscore/importService';
import {
  loadInstalledPackages,
  loadLocalAssociations,
  StoredAssociationsMap,
  StoredPackagesMap,
} from '@/services/bookscore/persistence';
import { InstalledPackage, SoundtrackCandidate } from '@/services/bookscore/types';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import { FileSystem } from '@/types/system';
import Dialog from '../Dialog';

export interface SoundtrackPanelProps {
  editionId?: string;
  isMobile?: boolean;
}

export const SoundtrackPanel: React.FC<SoundtrackPanelProps> = ({ editionId, isMobile }) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const capabilityEnabled = useSoundtrackStore((s) => s.capabilityEnabled);
  const activePackage = useSoundtrackStore((s) => s.activePackage);
  const activeAssociation = useSoundtrackStore((s) => s.activeAssociation);
  const selectedCue = useSoundtrackStore((s) => s.selectedCue);
  const playbackStatus = useSoundtrackStore((s) => s.playbackStatus);
  const volume = useSoundtrackStore((s) => s.volume);
  const isPanelOpen = useSoundtrackStore((s) => s.isPanelOpen);
  const activeEditionIdFromStore = useSoundtrackStore((s) => s.activeEditionId);
  const activeBookKeyFromStore = useSoundtrackStore((s) => s.activeBookKey);

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

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  const isEnabled = capabilityEnabled && isBookScoreCapabilityEnabled({ isMobile });

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
    }
  }, [isEnabled, isPanelOpen, currentEditionId]);

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
  }, [isPanelOpen, setPanelOpen]);

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
          <div className='p-3.5 rounded-xl border border-base-300 bg-base-200/40 space-y-3 eink-bordered'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-xs font-semibold uppercase tracking-wider text-neutral-content/90'>
                {_('Status')}
              </span>
              {isPlaying ? (
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
          <div className='p-3.5 rounded-xl border border-base-300 bg-base-200/40 space-y-2 eink-bordered'>
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
                      'p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2',
                      cand.isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-base-300 bg-base-100',
                      'eink-bordered',
                    )}
                  >
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
                ))}
              </div>
            )}
          </div>
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
