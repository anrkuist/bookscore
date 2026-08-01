import { LocationReport, PlaybackStatus, SoundtrackCue } from './types';
import { findCueForCfi } from './cfiUtils';

export type ProcessReportResult = {
  status: PlaybackStatus;
  selectedCue: SoundtrackCue | null;
  reason:
    | 'stale_or_duplicate'
    | 'location_started'
    | 'location_unavailable'
    | 'missing_cfi'
    | 'unresolved_cfi'
    | 'explicit_silence_cue'
    | 'resolved_audio_cue';
  isStaleOrDuplicate: boolean;
};

export class LocationReportSeam {
  private lastProcessedSeq = -1;

  public reset(seq = -1) {
    this.lastProcessedSeq = seq;
  }

  public getLastProcessedSeq(): number {
    return this.lastProcessedSeq;
  }

  public processReport(report: LocationReport, cues: SoundtrackCue[]): ProcessReportResult {
    // Ordering check: stale or duplicate sequence numbers trigger safe silence
    if (report.seq <= this.lastProcessedSeq) {
      return {
        status: 'silence',
        selectedCue: null,
        reason: 'stale_or_duplicate',
        isStaleOrDuplicate: true,
      };
    }

    this.lastProcessedSeq = report.seq;

    // Started or unavailable locations select safe silence
    if (report.kind === 'started') {
      return {
        status: 'silence',
        selectedCue: null,
        reason: 'location_started',
        isStaleOrDuplicate: false,
      };
    }

    if (report.kind === 'unavailable') {
      return {
        status: 'silence',
        selectedCue: null,
        reason: 'location_unavailable',
        isStaleOrDuplicate: false,
      };
    }

    if (report.kind === 'resolved') {
      if (!report.cfi) {
        return {
          status: 'silence',
          selectedCue: null,
          reason: 'missing_cfi',
          isStaleOrDuplicate: false,
        };
      }

      const selectedCue = findCueForCfi(report.cfi, cues);

      if (!selectedCue) {
        // Unresolved CFI selects safe silence
        return {
          status: 'silence',
          selectedCue: null,
          reason: 'unresolved_cfi',
          isStaleOrDuplicate: false,
        };
      }

      if (selectedCue.type === 'silence') {
        return {
          status: 'silence',
          selectedCue,
          reason: 'explicit_silence_cue',
          isStaleOrDuplicate: false,
        };
      }

      return {
        status: 'playing',
        selectedCue,
        reason: 'resolved_audio_cue',
        isStaleOrDuplicate: false,
      };
    }

    return {
      status: 'silence',
      selectedCue: null,
      reason: 'unresolved_cfi',
      isStaleOrDuplicate: false,
    };
  }
}
