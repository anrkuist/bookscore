import { describe, it, expect, beforeEach } from 'vitest';
import { LocationReportSeam } from '@/services/bookscore/locationSeam';
import { SoundtrackCue } from '@/services/bookscore/types';

describe('LocationReportSeam', () => {
  let seam: LocationReportSeam;
  const mockCues: SoundtrackCue[] = [
    {
      id: 'cue-intro',
      startCfi: 'epubcfi(/6/2!/4/2:0)',
      type: 'audio',
      assetId: 'asset-1',
      startSec: 0,
      loopStartSec: 2,
      loopEndSec: 10,
      volume: 0.8,
      crossfadeSec: 1.0,
    },
    {
      id: 'cue-silence',
      startCfi: 'epubcfi(/6/4!/4/2:0)',
      type: 'silence',
    },
    {
      id: 'cue-action',
      startCfi: 'epubcfi(/6/6!/4/2:0)',
      type: 'audio',
      assetId: 'asset-2',
      startSec: 0,
      loopStartSec: 0,
      loopEndSec: 15,
      volume: 1.0,
      crossfadeSec: 0.5,
    },
  ];

  beforeEach(() => {
    seam = new LocationReportSeam();
  });

  it('accepts location started and selects safe silence', () => {
    const result = seam.processReport({ seq: 1, kind: 'started' }, mockCues);
    expect(result.status).toBe('silence');
    expect(result.selectedCue).toBeNull();
    expect(result.reason).toBe('location_started');
  });

  it('accepts location unavailable and selects safe silence', () => {
    const result = seam.processReport({ seq: 1, kind: 'unavailable' }, mockCues);
    expect(result.status).toBe('silence');
    expect(result.selectedCue).toBeNull();
    expect(result.reason).toBe('location_unavailable');
  });

  it('resolves CFI to corresponding audio cue', () => {
    const result = seam.processReport(
      { seq: 1, kind: 'resolved', cfi: 'epubcfi(/6/2!/4/2:5)' },
      mockCues,
    );
    expect(result.status).toBe('playing');
    expect(result.selectedCue?.id).toBe('cue-intro');
    expect(result.reason).toBe('resolved_audio_cue');
  });

  it('resolves CFI to explicit silence cue', () => {
    const result = seam.processReport(
      { seq: 1, kind: 'resolved', cfi: 'epubcfi(/6/4!/4/2:10)' },
      mockCues,
    );
    expect(result.status).toBe('silence');
    expect(result.selectedCue?.id).toBe('cue-silence');
    expect(result.reason).toBe('explicit_silence_cue');
  });

  it('selects safe silence for unresolved CFI before first cue boundary', () => {
    const result = seam.processReport(
      { seq: 1, kind: 'resolved', cfi: 'epubcfi(/6/1!/4/2:0)' },
      mockCues,
    );
    expect(result.status).toBe('silence');
    expect(result.selectedCue).toBeNull();
    expect(result.reason).toBe('unresolved_cfi');
  });

  it('rejects stale sequence reports and selects safe silence', () => {
    seam.processReport({ seq: 5, kind: 'resolved', cfi: 'epubcfi(/6/2!/4/2:5)' }, mockCues);

    // Incoming report with older seq 3 (stale)
    const staleResult = seam.processReport(
      { seq: 3, kind: 'resolved', cfi: 'epubcfi(/6/6!/4/2:0)' },
      mockCues,
    );
    expect(staleResult.status).toBe('silence');
    expect(staleResult.isStaleOrDuplicate).toBe(true);
    expect(staleResult.reason).toBe('stale_or_duplicate');
  });

  it('rejects duplicate sequence reports and selects safe silence', () => {
    seam.processReport({ seq: 5, kind: 'resolved', cfi: 'epubcfi(/6/2!/4/2:5)' }, mockCues);

    // Duplicate report with same seq 5
    const dupResult = seam.processReport(
      { seq: 5, kind: 'resolved', cfi: 'epubcfi(/6/2!/4/2:5)' },
      mockCues,
    );
    expect(dupResult.status).toBe('silence');
    expect(dupResult.isStaleOrDuplicate).toBe(true);
  });
});
