import { AudioCue } from '@/services/bookscore/types';

/**
 * Creates a minimal valid, decodable MPEG-1 Layer III (MP3) audio byte sequence.
 * (~2.6 seconds at 44.1 kHz, 100 frames)
 */
export function createMinimalValidMp3Bytes(): Uint8Array {
  const frameHeader = [0xff, 0xfb, 0x90, 0x64];
  const frameLength = 417;
  const numFrames = 100;
  const totalLength = frameLength * numFrames;
  const bytes = new Uint8Array(totalLength);

  for (let i = 0; i < numFrames; i++) {
    const offset = i * frameLength;
    bytes.set(frameHeader, offset);
  }
  return bytes;
}

/**
 * Creates a corrupt/invalid audio byte sequence that will fail decoding.
 */
export function createCorruptMp3Bytes(): Uint8Array {
  return new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0xff]);
}

/**
 * Helper to construct a standard mock AudioCue for testing playback.
 */
export function createTestAudioCue(overrides?: Partial<AudioCue>): AudioCue {
  return {
    id: 'cue-validation-test',
    startCfi: 'epubcfi(/6/2!/4/2:0)',
    type: 'audio',
    assetId: 'asset-validation-test',
    startSec: 0.1,
    loopStartSec: 0.5,
    loopEndSec: 2.0,
    volume: 0.8,
    crossfadeSec: 0.2,
    ...overrides,
  };
}
