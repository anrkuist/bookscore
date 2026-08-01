'use client';

import React from 'react';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import { isTauriAppPlatform } from '@/services/environment';

export interface SoundtrackControlProps {
  isMobile?: boolean;
}

export const SoundtrackControl: React.FC<SoundtrackControlProps> = ({ isMobile }) => {
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
      ? `Cue ${selectedCue.id}`
      : 'Silence'
    : 'No Cue';

  const statusTooltip = isPlaying
    ? `Soundtrack Playing (${cueLabel})`
    : isGestureRequired
      ? `Click to enable Soundtrack Audio (${cueLabel})`
      : `Soundtrack Paused (${cueLabel})`;

  return (
    <div className='flex items-center gap-1.5' title={statusTooltip}>
      <button
        type='button'
        onClick={() => void togglePlayPause()}
        aria-label={isPlaying ? 'Pause soundtrack' : 'Play soundtrack'}
        className='btn btn-ghost btn-xs sm:btn-sm gap-1 eink-bordered font-normal'
      >
        <span className='text-xs'>🎵</span>
        <span className='text-xs max-w-[100px] truncate hidden sm:inline'>
          {isPlaying ? 'Playing' : isGestureRequired ? 'Click Play' : 'Paused'}
        </span>
      </button>
    </div>
  );
};
