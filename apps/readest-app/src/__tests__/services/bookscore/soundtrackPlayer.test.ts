import { describe, it, expect, vi } from 'vitest';
import {
  AudioContextInterface,
  GainNodeInterface,
  SoundSourceNode,
  WebAudioSoundtrackPlayer,
} from '@/services/bookscore/soundtrackPlayer';
import { AudioCue } from '@/services/bookscore/types';

class FakeGainNode implements GainNodeInterface {
  gain = {
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeBufferSourceNode implements SoundSourceNode {
  start = vi.fn();
  stop = vi.fn();
  connect = vi.fn();
  disconnect = vi.fn();
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended = null;
}

class FakeAudioContext implements AudioContextInterface {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 10;
  destination = {};

  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createGain = vi.fn(() => new FakeGainNode());
  createBufferSource = vi.fn(() => new FakeBufferSourceNode());
  createBuffer = vi.fn();
  decodeAudioData = vi.fn(async () => ({}));
}

describe('WebAudioSoundtrackPlayer', () => {
  const sampleCue: AudioCue = {
    id: 'cue-sample',
    startCfi: 'epubcfi(/6/2!/4/2:0)',
    type: 'audio',
    assetId: 'asset-1',
    startSec: 5,
    loopStartSec: 10,
    loopEndSec: 50,
    volume: 0.75,
    crossfadeSec: 1.0,
  };

  it('handles gesture unlock', async () => {
    const fakeCtx = new FakeAudioContext();
    const player = new WebAudioSoundtrackPlayer(fakeCtx);

    expect(player.isUnlocked()).toBe(false);

    const unlocked = await player.unlockGesture();
    expect(unlocked).toBe(true);
    expect(fakeCtx.resume).toHaveBeenCalled();
    expect(player.isUnlocked()).toBe(true);
  });

  it('configures cue looping and starts audio playback when unlocked', async () => {
    const fakeCtx = new FakeAudioContext();
    fakeCtx.state = 'running';
    const player = new WebAudioSoundtrackPlayer(fakeCtx);

    await player.playCue(sampleCue);

    expect(fakeCtx.createBufferSource).toHaveBeenCalled();
    const lastCreatedSource = vi.mocked(fakeCtx.createBufferSource).mock.results[0]
      ?.value as FakeBufferSourceNode;
    expect(lastCreatedSource).toBeDefined();
    expect(lastCreatedSource.loop).toBe(true);
    expect(lastCreatedSource.loopStart).toBe(10);
    expect(lastCreatedSource.loopEnd).toBe(50);
    expect(lastCreatedSource.start).toHaveBeenCalledWith(10, 5);
  });

  it('fails to play audio if gesture is not unlocked', async () => {
    const fakeCtx = new FakeAudioContext();
    fakeCtx.resume = vi.fn(async () => {
      fakeCtx.state = 'suspended';
    });
    const player = new WebAudioSoundtrackPlayer(fakeCtx);

    await expect(player.playCue(sampleCue)).rejects.toThrow('Gesture unlock required');
  });

  it('preserves playback position offset on pause and resumes from saved offset', async () => {
    const fakeCtx = new FakeAudioContext();
    fakeCtx.state = 'running';
    fakeCtx.currentTime = 10;
    const player = new WebAudioSoundtrackPlayer(fakeCtx);

    // Initial playback at startSec = 5
    await player.playCue(sampleCue);

    // Advance audio context currentTime by 15s (10 -> 25)
    fakeCtx.currentTime = 25;

    // Pause playback
    player.pause();

    // Verify saved offset was calculated as 5 + 15 = 20 seconds
    const savedOffset = player.getSavedOffset(sampleCue.id);
    expect(savedOffset).toBe(20);

    // Resume playback for the same cue with isResume = true
    await player.playCue(sampleCue, undefined, true);

    const secondSource = vi.mocked(fakeCtx.createBufferSource).mock.results[1]
      ?.value as FakeBufferSourceNode;
    expect(secondSource).toBeDefined();
    // Verify playback resumed at saved offset 20 instead of initial startSec 5
    expect(secondSource.start).toHaveBeenCalledWith(25, 20);
  });
});
