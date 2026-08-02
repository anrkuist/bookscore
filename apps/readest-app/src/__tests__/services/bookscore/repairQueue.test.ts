import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BaseDir, FileSystem } from '@/types/system';
import {
  loadInstalledPackages,
  loadLocalAssociations,
  loadRepairQueue,
  recordPackageRepairFailure,
  removePackageFromRepairQueue,
} from '@/services/bookscore/persistence';
import { RepairQueueItem } from '@/services/bookscore/types';
import {
  importAndAssociateBookScorePackage,
  removeInstalledPackage,
  createDevelopmentFixturePackageBytes,
} from '@/services/bookscore/importService';
import { useSoundtrackStore } from '@/store/soundtrackStore';

import { createTestFileSystem } from './testHelpers';

describe('Soundtrack Repair Queue & Failure Recovery (Issue #16)', () => {
  let tmpDir: string;
  let fs: FileSystem;
  const baseDir: BaseDir = 'Data';
  const editionId = 'edition-repair-test-1';

  beforeEach(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'bookscore-repair-test-'));
    fs = createTestFileSystem(tmpDir);
    useSoundtrackStore.setState({
      capabilityEnabled: true,
      activeEditionId: null,
      activeBookKey: null,
      activePackage: null,
      activeAssociation: null,
      selectedCue: null,
      playbackStatus: 'silence',
      isGestureUnlocked: true,
      isUserPlaying: false,
      repairQueue: {},
    });
  });

  afterEach(async () => {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  it('persists and manages Soundtrack Repair Queue entries', async () => {
    let queue = await loadRepairQueue(fs, baseDir);
    expect(queue).toEqual({});

    const failureItem: RepairQueueItem = {
      packageId: 'pkg-fail-1',
      manifestHash: 'hash-fail-1',
      title: 'Corrupt Soundtrack Package',
      reason: 'corrupt',
      assetId: 'asset-1',
      detectedAt: Date.now(),
      affectedEditionIds: [editionId],
    };

    queue = await recordPackageRepairFailure(fs, baseDir, failureItem);
    expect(queue['pkg-fail-1:hash-fail-1']).toBeDefined();
    expect(queue['pkg-fail-1:hash-fail-1']?.reason).toBe('corrupt');

    const loaded = await loadRepairQueue(fs, baseDir);
    expect(loaded['pkg-fail-1:hash-fail-1']).toBeDefined();

    queue = await removePackageFromRepairQueue(fs, baseDir, 'pkg-fail-1', 'hash-fail-1');
    expect(queue['pkg-fail-1:hash-fail-1']).toBeUndefined();
  });

  it('detects missing asset during play and records failure in Repair Queue, transitioning to silence', async () => {
    const fixtureBytes = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-missing-asset',
      'Missing Asset Soundtrack',
      editionId,
    );

    const importRes = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      fixtureBytes,
      editionId,
      undefined,
      { autoAttach: true },
    );
    expect(importRes.success).toBe(true);
    expect(importRes.package).toBeDefined();

    const pkg = importRes.package!;
    const packages = await loadInstalledPackages(fs, baseDir);
    const associations = await loadLocalAssociations(fs, baseDir);

    // Delete the asset file from disk to simulate missing asset
    const assetPath = `soundtracks/${pkg.packageId}/${pkg.manifestHash}/asset-main.mp3`;
    await (fs as unknown as { deleteFile: (p: string, b: BaseDir) => Promise<void> }).deleteFile(
      assetPath,
      baseDir,
    );

    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(editionId, packages, associations, 'epubcfi(/6/2!/4/2:0)', editionId);

    const mockPlayer = {
      isUnlocked: () => true,
      unlockGesture: async () => true,
      playCue: async () => {},
      transitionToSilence: async () => {},
      pause: () => {},
      stop: () => {},
      dispose: async () => {},
      getCurrentCue: () => null,
      getSavedOffset: () => undefined,
      setVolume: () => {},
      getVolume: () => 1.0,
    };

    useSoundtrackStore.getState().registerSoundtrackPlayer(mockPlayer);

    // Attempt to play missing asset
    await useSoundtrackStore.getState().play(false, fs);

    // Playback should transition to silence
    expect(useSoundtrackStore.getState().playbackStatus).toBe('silence');

    // Repair queue should record missing failure
    const repairQueue = await loadRepairQueue(fs, baseDir);
    const item = repairQueue[`${pkg.packageId}:${pkg.manifestHash}`];
    expect(item).toBeDefined();
    expect(item?.reason).toBe('missing');
  });

  it('detects unreadable (0-byte) asset during play and records failure in Repair Queue', async () => {
    const fixtureBytes = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-unreadable-asset',
      'Unreadable Asset Soundtrack',
      editionId,
    );

    const importRes = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      fixtureBytes,
      editionId,
      undefined,
      { autoAttach: true },
    );
    expect(importRes.success).toBe(true);

    const pkg = importRes.package!;
    const packages = await loadInstalledPackages(fs, baseDir);
    const associations = await loadLocalAssociations(fs, baseDir);

    // Write empty 0-byte file to simulate unreadable asset
    const assetPath = `soundtracks/${pkg.packageId}/${pkg.manifestHash}/asset-main.mp3`;
    await fs.writeFile(assetPath, baseDir, new Uint8Array(0).buffer);

    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(editionId, packages, associations, 'epubcfi(/6/2!/4/2:0)', editionId);

    const mockPlayer = {
      isUnlocked: () => true,
      unlockGesture: async () => true,
      playCue: async () => {},
      transitionToSilence: async () => {},
      pause: () => {},
      stop: () => {},
      dispose: async () => {},
      getCurrentCue: () => null,
      getSavedOffset: () => undefined,
      setVolume: () => {},
      getVolume: () => 1.0,
    };

    useSoundtrackStore.getState().registerSoundtrackPlayer(mockPlayer);

    await useSoundtrackStore.getState().play(false, fs);

    expect(useSoundtrackStore.getState().playbackStatus).toBe('silence');

    const repairQueue = await loadRepairQueue(fs, baseDir);
    const item = repairQueue[`${pkg.packageId}:${pkg.manifestHash}`];
    expect(item).toBeDefined();
    expect(item?.reason).toBe('unreadable');
  });

  it('detects corrupt asset checksum mismatch during play and records failure in Repair Queue', async () => {
    const fixtureBytes = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-corrupt-asset',
      'Corrupt Checksum Soundtrack',
      editionId,
    );

    const importRes = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      fixtureBytes,
      editionId,
      undefined,
      { autoAttach: true },
    );
    expect(importRes.success).toBe(true);

    const pkg = importRes.package!;
    const packages = await loadInstalledPackages(fs, baseDir);
    const associations = await loadLocalAssociations(fs, baseDir);

    // Overwrite asset file with corrupted content (wrong sha256)
    const assetPath = `soundtracks/${pkg.packageId}/${pkg.manifestHash}/asset-main.mp3`;
    await fs.writeFile(assetPath, baseDir, new Uint8Array([99, 99, 99, 99, 99]).buffer);

    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(editionId, packages, associations, 'epubcfi(/6/2!/4/2:0)', editionId);

    const mockPlayer = {
      isUnlocked: () => true,
      unlockGesture: async () => true,
      playCue: async () => {},
      transitionToSilence: async () => {},
      pause: () => {},
      stop: () => {},
      dispose: async () => {},
      getCurrentCue: () => null,
      getSavedOffset: () => undefined,
      setVolume: () => {},
      getVolume: () => 1.0,
    };

    useSoundtrackStore.getState().registerSoundtrackPlayer(mockPlayer);

    await useSoundtrackStore.getState().play(false, fs);

    expect(useSoundtrackStore.getState().playbackStatus).toBe('silence');

    const repairQueue = await loadRepairQueue(fs, baseDir);
    const item = repairQueue[`${pkg.packageId}:${pkg.manifestHash}`];
    expect(item).toBeDefined();
    expect(item?.reason).toBe('corrupt');
  });

  it('clears Repair Queue entry when package is re-imported (repaired)', async () => {
    const fixtureBytes = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-repair-reimport',
      'Repair Reimport Soundtrack',
      editionId,
    );

    const importRes = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      fixtureBytes,
      editionId,
      undefined,
      { autoAttach: true },
    );
    const pkg = importRes.package!;

    // Manually record failure in Repair Queue
    await recordPackageRepairFailure(fs, baseDir, {
      packageId: pkg.packageId,
      manifestHash: pkg.manifestHash,
      title: pkg.manifest.title,
      reason: 'missing',
      detectedAt: Date.now(),
      affectedEditionIds: [editionId],
    });

    const queueBefore = await loadRepairQueue(fs, baseDir);
    expect(queueBefore[`${pkg.packageId}:${pkg.manifestHash}`]).toBeDefined();

    // Re-import the package archive (re-import repair)
    const reImportRes = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      fixtureBytes,
      editionId,
      undefined,
      { autoAttach: true },
    );
    expect(reImportRes.success).toBe(true);

    // Repair queue entry should now be cleared
    const queueAfter = await loadRepairQueue(fs, baseDir);
    expect(queueAfter[`${pkg.packageId}:${pkg.manifestHash}`]).toBeUndefined();
  });

  it('clears Repair Queue entry and detaches associations when package is removed from Library', async () => {
    const fixtureBytes = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-removal-test',
      'Removal Test Soundtrack',
      editionId,
    );

    const importRes = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      fixtureBytes,
      editionId,
      undefined,
      { autoAttach: true },
    );
    const pkg = importRes.package!;

    await recordPackageRepairFailure(fs, baseDir, {
      packageId: pkg.packageId,
      manifestHash: pkg.manifestHash,
      title: pkg.manifest.title,
      reason: 'corrupt',
      detectedAt: Date.now(),
      affectedEditionIds: [editionId],
    });

    // Remove package via Library action
    const removeRes = await removeInstalledPackage(fs, baseDir, pkg.packageId, pkg.manifestHash);
    expect(removeRes.success).toBe(true);

    const queueAfter = await loadRepairQueue(fs, baseDir);
    expect(queueAfter[`${pkg.packageId}:${pkg.manifestHash}`]).toBeUndefined();

    const assocs = await loadLocalAssociations(fs, baseDir);
    expect(assocs[editionId]?.selected).toBeFalsy();
  });

  it('unresolved locations remain ordinary no-assignment/silence and never defect', async () => {
    const packages = await loadInstalledPackages(fs, baseDir);
    const associations = await loadLocalAssociations(fs, baseDir);

    // Load book with no active package or invalid CFI location
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'unresolved-edition',
        packages,
        associations,
        'epubcfi(/6/99!/4/99:0)',
        'unresolved-edition',
      );

    expect(useSoundtrackStore.getState().playbackStatus).toBe('silence');
    expect(useSoundtrackStore.getState().selectedCue).toBeNull();

    // Report location for unassigned/unresolved location
    useSoundtrackStore.getState().reportLocation({
      seq: 1,
      kind: 'resolved',
      cfi: 'epubcfi(/6/99!/4/99:0)',
    });

    expect(useSoundtrackStore.getState().playbackStatus).toBe('silence');
  });

  it('end-to-end: restores corrupt/0-byte asset bytes on re-import and allows successful playback', async () => {
    const fixtureBytes = await createDevelopmentFixturePackageBytes(
      undefined,
      'pkg-e2e-repair',
      'E2E Repair Soundtrack',
      editionId,
    );

    // 1. Initial import & attach
    const importRes = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      fixtureBytes,
      editionId,
      undefined,
      { autoAttach: true },
    );
    expect(importRes.success).toBe(true);
    const pkg = importRes.package!;

    // 2. Corrupt asset file on disk (write 0-byte unreadable file)
    const assetPath = `soundtracks/${pkg.packageId}/${pkg.manifestHash}/asset-main.mp3`;
    await fs.writeFile(assetPath, baseDir, new Uint8Array(0).buffer);

    // 3. Load book & attempt playback -> fails and enters repair queue
    let packages = await loadInstalledPackages(fs, baseDir);
    let associations = await loadLocalAssociations(fs, baseDir);

    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(editionId, packages, associations, 'epubcfi(/6/2!/4/2:0)', editionId);

    let playedCue: unknown = null;
    const mockPlayer = {
      isUnlocked: () => true,
      unlockGesture: async () => true,
      playCue: async (cue: unknown) => {
        playedCue = cue;
      },
      transitionToSilence: async () => {},
      pause: () => {},
      stop: () => {},
      dispose: async () => {},
      getCurrentCue: () => null,
      getSavedOffset: () => undefined,
      setVolume: () => {},
      getVolume: () => 1.0,
    };

    useSoundtrackStore.getState().registerSoundtrackPlayer(mockPlayer);

    await useSoundtrackStore.getState().play(false, fs);

    expect(useSoundtrackStore.getState().playbackStatus).toBe('silence');
    let repairQueue = await loadRepairQueue(fs, baseDir);
    expect(repairQueue[`${pkg.packageId}:${pkg.manifestHash}`]).toBeDefined();

    // 4. Re-import package archive to repair
    const reImportRes = await importAndAssociateBookScorePackage(
      fs,
      baseDir,
      fixtureBytes,
      editionId,
      undefined,
      { autoAttach: true },
    );
    expect(reImportRes.success).toBe(true);

    // 5. Verify asset bytes on disk are restored (non-zero byte length)
    const restoredBuffer = (await fs.readFile(assetPath, baseDir, 'binary')) as ArrayBuffer;
    expect(restoredBuffer).not.toBeNull();
    expect(restoredBuffer.byteLength).toBeGreaterThan(0);

    // 6. Verify Repair Queue is cleared
    repairQueue = await loadRepairQueue(fs, baseDir);
    expect(repairQueue[`${pkg.packageId}:${pkg.manifestHash}`]).toBeUndefined();

    // 7. Load soundtrack again & trigger play -> playback succeeds and cue is played
    packages = await loadInstalledPackages(fs, baseDir);
    associations = await loadLocalAssociations(fs, baseDir);

    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(editionId, packages, associations, 'epubcfi(/6/2!/4/2:0)', editionId);

    await useSoundtrackStore.getState().play(false, fs);

    expect(useSoundtrackStore.getState().playbackStatus).toBe('playing');
    expect(playedCue).not.toBeNull();
  });
});
