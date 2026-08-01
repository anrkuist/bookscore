'use client';

import React from 'react';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import { isTauriAppPlatform } from '@/services/environment';
import { useTranslation } from '@/hooks/useTranslation';

export interface SoundtrackControlProps {
  isMobile?: boolean;
}

export const SoundtrackControl: React.FC<SoundtrackControlProps> = ({ isMobile }) => {
  const _ = useTranslation();
  const capabilityEnabled = useSoundtrackStore((s) => s.capabilityEnabled);
  const activePackage = useSoundtrackStore((s) => s.activePackage);
  const selectedCue = useSoundtrackStore((s) => s.selectedCue);
  const playbackStatus = useSoundtrackStore((s) => s.playbackStatus);
  const togglePlayPause = useSoundtrackStore((s) => s.togglePlayPause);

  // Gating check: Web, iOS, Android remain healthy and show no soundtrack controls
  const isDesktop = isTauriAppPlatform() && !isMobile;
  if (!isDesktop || !capabilityEnabled || !activePackage) {
    return null;
  }

  const isPlaying = playbackStatus === 'playing';
  const isGestureRequired = playbackStatus === 'gesture_required';

  const cueLabel = selectedCue
    ? selectedCue.type === 'audio'
      ? `${_('Cue')} ${selectedCue.id}`
      : _('Silence')
    : _('No Cue');

  const statusTooltip = isPlaying
    ? `${_('Soundtrack Playing')} (${cueLabel})`
    : isGestureRequired
      ? `${_('Click to enable Soundtrack Audio')} (${cueLabel})`
      : `${_('Soundtrack Paused')} (${cueLabel})`;

  return (
    <div className='flex items-center gap-1.5' title={statusTooltip}>
      <button
        type='button'
        onClick={() => void togglePlayPause()}
        aria-label={isPlaying ? _('Pause soundtrack') : _('Play soundtrack')}
        className='btn btn-ghost btn-xs sm:btn-sm gap-1 eink-bordered font-normal'
      >
        <span className='text-xs'>🎵</span>
        <span className='text-xs max-w-[100px] truncate hidden sm:inline'>
          {isPlaying ? _('Playing') : isGestureRequired ? _('Click Play') : _('Paused')}
        </span>
      </button>
    </div>
  );
};
