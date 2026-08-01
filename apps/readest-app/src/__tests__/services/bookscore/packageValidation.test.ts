import { describe, it, expect } from 'vitest';
import {
  validatePackageManifest,
  validateBookScorePackageArchive,
  sha256Hex,
} from '@/services/bookscore/packageValidation';

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
          loopEndSec: 150,
        },
      ],
    };
    const result = validatePackageManifest(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds asset duration'))).toBe(true);
  });

  it('validates a real .bookscore ZIP package archive with SHA-256 asset checksum verification', async () => {
    const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } = await import(
      '@zip.js/zip.js'
    );

    const assetBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const assetHash = await sha256Hex(assetBytes);

    const manifestObj = {
      packageId: 'pkg-zip-test',
      title: 'Zip Package Test',
      version: 1,
      manifestHash: '',
      editionCompatibility: [
        {
          algorithm: 'readest-partial-md5-v1',
          digest: 'md5digest',
          epubByteLength: 10000,
        },
      ],
      assets: [
        {
          id: 'track-1',
          path: 'audio/track1.mp3',
          mimeType: 'audio/mpeg',
          hash: assetHash,
          durationSec: 30,
        },
      ],
      cues: [
        {
          id: 'cue-1',
          startCfi: 'epubcfi(/6/2!/4/2:0)',
          type: 'audio',
          assetId: 'track-1',
          startSec: 0,
          loopStartSec: 0,
          loopEndSec: 20,
          volume: 1,
          crossfadeSec: 0.5,
        },
      ],
    };

    const encoder = new TextEncoder();
    const manifestText = JSON.stringify(manifestObj, null, 2);
    const computedManifestHash = await sha256Hex(encoder.encode(manifestText));
    manifestObj.manifestHash = computedManifestHash;

    const zipWriter = new ZipWriter(new Uint8ArrayWriter());
    await zipWriter.add('manifest.json', new TextReader(JSON.stringify(manifestObj)));
    await zipWriter.add('audio/track1.mp3', new Uint8ArrayReader(assetBytes));
    const zipArchiveBytes = await zipWriter.close();

    const res = await validateBookScorePackageArchive(zipArchiveBytes);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.package?.packageId).toBe('pkg-zip-test');
    expect(res.assetFiles?.has('track-1')).toBe(true);
  });

  it('rejects ZIP package archive with unsafe entry path traversal', async () => {
    const { ZipWriter, Uint8ArrayWriter, TextReader } = await import('@zip.js/zip.js');
    const zipWriter = new ZipWriter(new Uint8ArrayWriter());
    await zipWriter.add('../unsafe.json', new TextReader('{}'));
    const zipArchiveBytes = await zipWriter.close();

    const res = await validateBookScorePackageArchive(zipArchiveBytes);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Unsafe ZIP entry path'))).toBe(true);
  });

  it('rejects package archive when asset audio fails runtime decoding despite matching hash', async () => {
    const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } = await import(
      '@zip.js/zip.js'
    );

    const corruptAssetBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const assetHash = await sha256Hex(corruptAssetBytes);

    const manifestObj = {
      packageId: 'pkg-corrupt-asset',
      title: 'Corrupt Asset Package',
      version: 1,
      manifestHash: '',
      editionCompatibility: [
        {
          algorithm: 'readest-partial-md5-v1',
          digest: 'md5digest',
          epubByteLength: 10000,
        },
      ],
      assets: [
        {
          id: 'corrupt-track',
          path: 'audio/corrupt.mp3',
          mimeType: 'audio/mpeg',
          hash: assetHash,
          durationSec: 30,
        },
      ],
      cues: [
        {
          id: 'cue-corrupt',
          startCfi: 'epubcfi(/6/2!/4/2:0)',
          type: 'audio',
          assetId: 'corrupt-track',
          startSec: 0,
          loopStartSec: 0,
          loopEndSec: 20,
          volume: 1,
          crossfadeSec: 0.5,
        },
      ],
    };

    const encoder = new TextEncoder();
    const manifestText = JSON.stringify(manifestObj, null, 2);
    manifestObj.manifestHash = await sha256Hex(encoder.encode(manifestText));

    const zipWriter = new ZipWriter(new Uint8ArrayWriter());
    await zipWriter.add('manifest.json', new TextReader(JSON.stringify(manifestObj)));
    await zipWriter.add('audio/corrupt.mp3', new Uint8ArrayReader(corruptAssetBytes));
    const zipArchiveBytes = await zipWriter.close();

    const failingDecoder = async () => {
      throw new Error('Corrupt MP3 header');
    };

    const res = await validateBookScorePackageArchive(zipArchiveBytes, failingDecoder);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('runtime audio decoding failed'))).toBe(true);
  });
});
