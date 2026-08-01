import { describe, it, expect } from 'vitest';
import { validatePackageManifest } from '@/services/bookscore/packageValidation';

describe('packageValidation', () => {
  const validManifest = {
    packageId: 'pkg-dune-v1',
    title: 'Dune Original Soundtrack',
    version: 1,
    manifestHash: 'a1b2c3d4e5f6',
    editionCompatibility: [
      {
        algorithm: 'readest-partial-md5-v1',
        digest: '8f7e6d5c4b3a',
        epubByteLength: 1048576,
      },
    ],
    assets: [
      {
        id: 'asset-desert',
        path: 'audio/desert.mp3',
        mimeType: 'audio/mpeg',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        durationSec: 120,
      },
    ],
    cues: [
      {
        id: 'cue-arrakis',
        startCfi: 'epubcfi(/6/2!/4/2:0)',
        type: 'audio',
        assetId: 'asset-desert',
        startSec: 0,
        loopStartSec: 10,
        loopEndSec: 110,
        volume: 0.9,
        crossfadeSec: 1.5,
      },
      {
        id: 'cue-silence-pause',
        startCfi: 'epubcfi(/6/10!/4/2:0)',
        type: 'silence',
      },
    ],
  };

  it('validates a correct manifest and returns InstalledPackage', () => {
    const result = validatePackageManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.package).toBeDefined();
    expect(result.package?.packageId).toBe('pkg-dune-v1');
    expect(result.package?.manifestHash).toBe('a1b2c3d4e5f6');
  });

  it('fails validation when packageId or manifestHash is missing', () => {
    const invalid = { ...validManifest, packageId: '' };
    const result = validatePackageManifest(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing packageId');
  });

  it('fails validation when asset mimeType is not audio/mpeg', () => {
    const invalid = {
      ...validManifest,
      assets: [{ ...validManifest.assets[0], mimeType: 'audio/wav' }],
    };
    const result = validatePackageManifest(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('audio/mpeg'))).toBe(true);
  });

  it('fails validation when loopEndSec exceeds asset durationSec', () => {
    const invalid = {
      ...validManifest,
      cues: [
        {
          ...validManifest.cues[0],
          loopEndSec: 150, // exceeds asset durationSec (120)
        },
      ],
    };
    const result = validatePackageManifest(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds asset duration'))).toBe(true);
  });

  it('fails validation when audio cue references non-existent assetId', () => {
    const invalid = {
      ...validManifest,
      cues: [
        {
          ...validManifest.cues[0],
          assetId: 'non-existent-asset',
        },
      ],
    };
    const result = validatePackageManifest(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent assetId'))).toBe(true);
  });
});
