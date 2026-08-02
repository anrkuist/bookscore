'use client';

import clsx from 'clsx';
import React from 'react';
import { MdMusicNote } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';
import { isBookScoreCapabilityEnabled } from '@/services/bookscore/capability';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import { SoundtrackPanel } from './SoundtrackPanel';

export interface SoundtrackControlProps {
  isMobile?: boolean;
}

export const SoundtrackControl: React.FC<SoundtrackControlProps> = ({ isMobile }) => {
  const _ = useTranslation();
  const capabilityEnabled = useSoundtrackStore((s) => s.capabilityEnabled);
  const activePackage = useSoundtrackStore((s) => s.activePackage);
  const selectedCue = useSoundtrackStore((s) => s.selectedCue);
  const playbackStatus = useSoundtrackStore((s) => s.playbackStatus);
  const isPanelOpen = useSoundtrackStore((s) => s.isPanelOpen);
  const togglePanel = useSoundtrackStore((s) => s.togglePanel);

  const repairQueue = useSoundtrackStore((s) => s.repairQueue);

  // Gating check: Web, iOS, Android remain healthy and show no soundtrack controls
  const isEnabled = capabilityEnabled && isBookScoreCapabilityEnabled({ isMobile });
  if (!isEnabled || !activePackage) {
    return null;
  }

  const activeRepairItem = activePackage
    ? (repairQueue[`${activePackage.packageId}:${activePackage.manifestHash}`] ??
      repairQueue[activePackage.packageId])
    : null;

  const isPlaying = playbackStatus === 'playing';
  const isGestureRequired = playbackStatus === 'gesture_required';
  const isSilence = playbackStatus === 'silence' || (selectedCue && selectedCue.type === 'silence');

  const cueLabel = selectedCue
    ? selectedCue.type === 'audio'
      ? `${_('Cue')} ${selectedCue.id}`
      : _('Silence')
    : _('No Cue');

  const statusTooltip = activeRepairItem
    ? `${_('Soundtrack Quiet State (Repair Required)')} (${cueLabel})`
    : isPlaying
      ? `${_('Soundtrack Playing')} (${cueLabel})`
      : isGestureRequired
        ? `${_('Click to enable Soundtrack Audio')} (${cueLabel})`
        : isSilence
          ? `${_('Soundtrack Quiet State')} (${cueLabel})`
          : `${_('Soundtrack Paused')} (${cueLabel})`;

  return (
    <>
      <div className='flex items-center gap-1.5' title={statusTooltip}>
        <button
          type='button'
          onClick={togglePanel}
          aria-label={`${_('Soundtrack controls')} - ${statusTooltip}`}
          aria-expanded={isPanelOpen}
          className={clsx(
            'btn btn-ghost btn-xs sm:btn-sm gap-1 eink-bordered font-normal',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
            isPanelOpen && 'bg-base-300/50',
          )}
        >
          <MdMusicNote
            className={clsx(
              'h-4 w-4 text-xs',
              activeRepairItem
                ? 'text-warning'
                : isPlaying
                  ? 'text-primary not-eink:animate-pulse'
                  : 'text-base-content/80',
            )}
          />
          <span className='text-xs max-w-[100px] truncate hidden sm:inline'>
            {activeRepairItem
              ? _('Quiet (Repair)')
              : isPlaying
                ? _('Playing')
                : isGestureRequired
                  ? _('Click Play')
                  : isSilence
                    ? _('Quiet')
                    : _('Paused')}
          </span>
        </button>
      </div>

      <SoundtrackPanel isMobile={isMobile} />
    </>
  );
};
