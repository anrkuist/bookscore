import { describe, it, expect, vi } from 'vitest';
import { WebAudioSoundtrackPlayer } from '@/services/bookscore/soundtrackPlayer';
import { defaultAudioDecoder } from '@/services/bookscore/packageValidation';
import {
  createMinimalValidMp3Bytes,
  createCorruptMp3Bytes,
  createTestAudioCue,
} from './bookscoreHelpers';

interface WebkitWindow extends Window {
  webkitAudioContext: typeof AudioContext;
}

describe('Tauri WebView BookScore Validation', () => {
  interface TrackedSource {
    src: AudioBufferSourceNode;
    startSpy: ReturnType<typeof vi.fn>;
    stopSpy: ReturnType<typeof vi.fn>;
    disconnectSpy: ReturnType<typeof vi.fn>;
  }

  interface TrackedGain {
    gainNode: GainNode;
    setValueSpy: ReturnType<typeof vi.fn>;
    rampSpy: ReturnType<typeof vi.fn>;
    disconnectSpy: ReturnType<typeof vi.fn>;
  }

  function createSpiedPlayer() {
    const AudioCtx = window.AudioContext || (window as unknown as WebkitWindow).webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('Web Audio API (AudioContext) is not supported in this environment');
    }

    const realCtx = new AudioCtx();
    let lastCreatedSource: AudioBufferSourceNode | null = null;
    const createdSources: TrackedSource[] = [];
    const createdGains: TrackedGain[] = [];

    // Wrap AudioContext to intercept source node creation and monitor loops/playback
    const wrappedCtx = {
      state: realCtx.state,
      get currentTime() {
        return realCtx.currentTime;
      },
      get destination() {
        return realCtx.destination;
      },
      resume: async () => {
        await realCtx.resume();
        wrappedCtx.state = realCtx.state;
      },
      close: async () => {
        await realCtx.close();
        wrappedCtx.state = realCtx.state;
      },
      createGain: () => {
        const g = realCtx.createGain();
        const setValueSpy = vi.spyOn(g.gain, 'setValueAtTime');
        const rampSpy = vi.spyOn(g.gain, 'linearRampToValueAtTime');
        const disconnectSpy = vi.spyOn(g, 'disconnect');
        createdGains.push({ gainNode: g, setValueSpy, rampSpy, disconnectSpy });
        return g;
      },
      createBuffer: (channels: number, len: number, rate: number) =>
        realCtx.createBuffer(channels, len, rate),
      decodeAudioData: (buf: ArrayBuffer) => realCtx.decodeAudioData(buf),
      createBufferSource: () => {
        const src = realCtx.createBufferSource();
        const startSpy = vi.spyOn(src, 'start');
        const stopSpy = vi.spyOn(src, 'stop');
        const disconnectSpy = vi.spyOn(src, 'disconnect');
        lastCreatedSource = src;
        createdSources.push({ src, startSpy, stopSpy, disconnectSpy });
        return src;
      },
    };

    const player = new WebAudioSoundtrackPlayer(
      wrappedCtx as unknown as ConstructorParameters<typeof WebAudioSoundtrackPlayer>[0],
    );
    return {
      player,
      realCtx,
      wrappedCtx,
      getLastSource: () => lastCreatedSource,
      getCreatedSources: () => createdSources,
      getCreatedGains: () => createdGains,
    };
  }

  // 1. Packaged MP3 Decode Validation
  describe('Packaged MP3 Decode', () => {
    it('should successfully decode valid minimal MP3 bytes and return duration', async () => {
      const validBytes = createMinimalValidMp3Bytes();
      try {
        const result = await defaultAudioDecoder(validBytes);
        expect(result.durationSec).toBeGreaterThan(0);
        // Minimal valid MP3 is ~2.6 seconds
        expect(result.durationSec).toBeCloseTo(2.6, 1);
        console.log(`[PASS] Decoded valid MP3: duration = ${result.durationSec}s`);
      } catch (err) {
        // If the WebView environment strictly blocks Web Audio, report constraint clearly.
        console.warn(
          '[WARN] Web Audio API decodeAudioData failed, possibly due to autoplay/sandbox policies:',
          err,
        );
        // Fallback checks to see if the fallback decoder was triggered
        expect(err).toBeUndefined();
      }
    });

    it('should throw an error when decoding corrupt MP3 bytes', async () => {
      const corruptBytes = createCorruptMp3Bytes();
      await expect(defaultAudioDecoder(corruptBytes)).rejects.toThrow();
      console.log('[PASS] Corrupt MP3 bytes failed decoding as expected.');
    });
  });

  // 2. Player Integration (Loops, Transitions, Pause/Resume, Cleanup, Silence failures)
  describe('Soundtrack Player playback logic', () => {
    it('should configure loops and start playback on target source node', async () => {
      const { player, realCtx, getLastSource } = createSpiedPlayer();
      const cue = createTestAudioCue({ loopStartSec: 0.5, loopEndSec: 2.0 });
      const validBytes = createMinimalValidMp3Bytes();

      try {
        // Unlock gesture (required before playback)
        await player.unlockGesture();
        expect(player.isUnlocked()).toBe(true);

        // Play cue
        await player.playCue(cue, validBytes.buffer as ArrayBuffer);

        const sourceNode = getLastSource();
        expect(sourceNode).not.toBeNull();
        expect(sourceNode!.loop).toBe(true);
        expect(sourceNode!.loopStart).toBe(0.5);
        expect(sourceNode!.loopEnd).toBe(2.0);
        expect(player.getCurrentCue()?.id).toBe(cue.id);

        console.log('[PASS] Configured loop properties and verified active cue.');
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });

    it('should handle pause and resume by saving and passing the correct offset to source.start', async () => {
      const { player, realCtx, getCreatedSources } = createSpiedPlayer();
      const cue = createTestAudioCue({ startSec: 0.2, loopStartSec: 0.5, loopEndSec: 2.0 });
      const validBytes = createMinimalValidMp3Bytes();

      try {
        await player.unlockGesture();
        await player.playCue(cue, validBytes.buffer as ArrayBuffer);

        const sourcesBeforePause = getCreatedSources();
        expect(sourcesBeforePause.length).toBe(1);
        const source1 = sourcesBeforePause[0];
        expect(source1).toBeDefined();
        // Initial play must start at cue.startSec (0.2)
        expect(source1!.startSpy).toHaveBeenCalledWith(expect.any(Number), 0.2);

        // Pause the player
        player.pause();
        const savedOffset = player.getSavedOffset(cue.id);
        expect(savedOffset).toBeDefined();
        expect(savedOffset).toBeGreaterThanOrEqual(0.2);
        expect(player.getCurrentCue()?.id).toBe(cue.id);

        // Resume playback (isResume = true)
        await player.playCue(cue, validBytes.buffer as ArrayBuffer, true);
        const sourcesAfterResume = getCreatedSources();
        expect(sourcesAfterResume.length).toBe(2);
        const source2 = sourcesAfterResume[1];
        expect(source2).toBeDefined();
        expect(source2!.src).not.toBe(source1!.src);

        // Explicitly assert that source2.start was invoked with savedOffset
        expect(source2!.startSpy).toHaveBeenCalledWith(expect.any(Number), savedOffset);

        console.log(
          '[PASS] Player successfully paused and resumed with start offset:',
          savedOffset,
        );
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });

    it('should handle transitionToSilence and cleanup on stop', async () => {
      const { player, realCtx } = createSpiedPlayer();
      const cue = createTestAudioCue();
      const validBytes = createMinimalValidMp3Bytes();

      try {
        await player.unlockGesture();
        await player.playCue(cue, validBytes.buffer as ArrayBuffer);

        expect(player.getCurrentCue()).not.toBeNull();

        // Stop playback (clears saved offsets and stops nodes)
        player.stop();
        expect(player.getCurrentCue()).toBeNull();
        expect(player.getSavedOffset(cue.id)).toBeUndefined();

        console.log('[PASS] Player stopped and references cleaned up.');
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });

    it('should transition to silence and propagate errors on silence-first decode failures', async () => {
      const { player, realCtx, getCreatedSources, getCreatedGains } = createSpiedPlayer();
      const corruptCue = createTestAudioCue({ id: 'cue-corrupt-silence-first' });
      const corruptBytes = createCorruptMp3Bytes();

      try {
        await player.unlockGesture();
        expect(player.getCurrentCue()).toBeNull();

        // Silence-first decode failure: play cue with invalid bytes from clean idle state
        await expect(
          player.playCue(corruptCue, corruptBytes.buffer as ArrayBuffer),
        ).rejects.toThrow();

        // Player must remain in silent/null state with no active cue
        expect(player.getCurrentCue()).toBeNull();

        // Verify per-cue created gain node (gains[1]) was disconnected to prevent resource leak
        const gains = getCreatedGains();
        expect(gains.length).toBeGreaterThanOrEqual(2);
        expect(gains[1]!.disconnectSpy).toHaveBeenCalled();

        // Verify created source node was disconnected and never started
        const sources = getCreatedSources();
        expect(sources.length).toBeGreaterThanOrEqual(1);
        expect(sources[0]!.startSpy).not.toHaveBeenCalled();
        expect(sources[0]!.disconnectSpy).toHaveBeenCalled();

        console.log(
          '[PASS] Silence-first decode failure correctly rejected, cleaned up nodes, and maintained silent state.',
        );
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });

    it('should transition active playback to silence and propagate errors on active-source decode failure', async () => {
      const { player, realCtx, getCreatedSources } = createSpiedPlayer();
      const validCue = createTestAudioCue({ id: 'cue-active-valid' });
      const corruptCue = createTestAudioCue({ id: 'cue-corrupt' });
      const validBytes = createMinimalValidMp3Bytes();
      const corruptBytes = createCorruptMp3Bytes();

      try {
        await player.unlockGesture();

        // 1. Play valid cue to establish active playback
        await player.playCue(validCue, validBytes.buffer as ArrayBuffer);
        expect(player.getCurrentCue()?.id).toBe('cue-active-valid');
        const activeSource = getCreatedSources()[0];

        // 2. Play corrupt cue to trigger active-source decode failure
        await expect(
          player.playCue(corruptCue, corruptBytes.buffer as ArrayBuffer),
        ).rejects.toThrow();

        // 3. Player must tear down active playback, clear currentCue, and transition to silence
        expect(player.getCurrentCue()).toBeNull();

        // Wait for transitionToSilence fadeout timeout (0.5s default + 50ms)
        await new Promise((res) => setTimeout(res, 600));

        expect(activeSource!.stopSpy).toHaveBeenCalled();
        expect(activeSource!.disconnectSpy).toHaveBeenCalled();

        console.log(
          '[PASS] Active playback correctly transitioned to silence on corrupt decode failure.',
        );
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });

    it('should crossfade and transition smoothly between two cues with gain ramp and node cleanup', async () => {
      const { player, realCtx, getCreatedSources, getCreatedGains } = createSpiedPlayer();
      const cueA = createTestAudioCue({ id: 'cue-a', volume: 0.9, crossfadeSec: 0.1 });
      const cueB = createTestAudioCue({ id: 'cue-b', volume: 0.5, crossfadeSec: 0.1 });
      const validBytes = createMinimalValidMp3Bytes();

      try {
        await player.unlockGesture();

        // Play cue A
        await player.playCue(cueA, validBytes.buffer as ArrayBuffer);
        const sourcesAfterA = getCreatedSources();
        expect(sourcesAfterA.length).toBe(1);
        const sourceA = sourcesAfterA[0];
        expect(player.getCurrentCue()?.id).toBe('cue-a');

        // Transition to cue B (triggers crossfade of sourceA and fade in of sourceB)
        await player.playCue(cueB, validBytes.buffer as ArrayBuffer);
        const sourcesAfterB = getCreatedSources();
        expect(sourcesAfterB.length).toBe(2);
        const sourceB = sourcesAfterB[1];

        expect(sourceB!.src).not.toBe(sourceA!.src);
        expect(player.getCurrentCue()?.id).toBe('cue-b');

        // Verify gain ramp down was initiated for sourceA gain node (gains[1], since gains[0] is masterGain)
        const gains = getCreatedGains();
        expect(gains.length).toBeGreaterThanOrEqual(3);
        expect(gains[1]!.rampSpy).toHaveBeenCalledWith(0, expect.any(Number));

        // Wait for crossfade timeout (0.1s + 50ms buffer) to complete cleanup of old source
        await new Promise((res) => setTimeout(res, 200));

        expect(sourceA!.stopSpy).toHaveBeenCalled();
        expect(sourceA!.disconnectSpy).toHaveBeenCalled();

        console.log(
          '[PASS] Successfully crossfaded from cue A to cue B and verified gain ramping and node teardown.',
        );
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });
  });

  // 3. Installed-Style macOS BookScore Reader Round-Trip Suite (#33)
  describe('Installed-Style macOS Reader Round-Trip Journey', () => {
    it('executes full installed-style macOS reader lifecycle from EPUB import to replay', async () => {
      const {
        importAndAssociateBookScorePackage,
        computeSoundtrackCandidates,
        associateSoundtrackToEdition,
      } = await import('@/services/bookscore/importService');
      const { exportBookScorePackage } = await import('@/services/bookscore/exportService');
      const { makeEditableCopy } = await import('@/services/bookscore/authoringService');
      const { loadRepairQueue, loadInstalledPackages, loadLocalAssociations } = await import(
        '@/services/bookscore/persistence'
      );
      const { useSoundtrackStore } = await import('@/store/soundtrackStore');
      const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } = await import(
        '@zip.js/zip.js'
      );
      const { sha256Hex } = await import('@/services/bookscore/packageValidation');
      const { getAssetFilePath } = await import('@/services/bookscore/assetStorage');
      const { partialMD5 } = await import('@/utils/md5');
      const { DocumentLoader } = await import('@/libs/document');
      const { computeBookNav } = await import('@/services/nav');
      const { nativeFileSystem } = await import('@/services/nativeAppService');
      type BaseDir = import('@/types/system').BaseDir;

      async function waitForCondition(
        predicate: () => boolean | Promise<boolean>,
        timeoutMs = 5000,
        pollIntervalMs = 25,
      ) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (await predicate()) return;
          await new Promise((r) => setTimeout(r, pollIntervalMs));
        }
        if (!(await predicate())) {
          throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
        }
      }

      function createScopedNativeFileSystem(profileName: string) {
        const prefix = `bookscore_mac_prof_${profileName}`;
        const withPrefix = (p: string) => (p ? `${prefix}/${p.replace(/^\/+/, '')}` : prefix);

        return {
          ...nativeFileSystem,
          resolvePath: (p: string, base: BaseDir) =>
            nativeFileSystem.resolvePath(withPrefix(p), base),
          exists: (p: string, base: BaseDir) => nativeFileSystem.exists(withPrefix(p), base),
          readFile: (p: string, base: BaseDir, mode: 'text' | 'binary') =>
            nativeFileSystem.readFile(withPrefix(p), base, mode),
          writeFile: (p: string, base: BaseDir, content: string | ArrayBuffer | File) =>
            nativeFileSystem.writeFile(withPrefix(p), base, content),
          removeFile: (p: string, base: BaseDir) =>
            nativeFileSystem.removeFile(withPrefix(p), base),
          deleteFile: (p: string, base: BaseDir) =>
            nativeFileSystem.removeFile(withPrefix(p), base),
          createDir: (p: string, base: BaseDir, recursive = true) =>
            nativeFileSystem.createDir(withPrefix(p), base, recursive),
          removeDir: (p: string, base: BaseDir, recursive = true) =>
            nativeFileSystem.removeDir(withPrefix(p), base, recursive),
          readDir: (p: string, base: BaseDir) => nativeFileSystem.readDir(withPrefix(p), base),
        } as unknown as import('@/types/system').FileSystem & {
          deleteFile: (p: string, b: BaseDir) => Promise<void>;
        };
      }

      // Step A: Load real EPUB file fixture, open via DocumentLoader & computeNav
      const fixtureUrl = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;
      const epubBuf = await (await fetch(fixtureUrl)).arrayBuffer();
      const epubFile = new File([epubBuf], 'sample-alice.epub', { type: 'application/epub+zip' });

      // Compute actual edition digest from the imported EPUB file
      const editionId = await partialMD5(epubFile);

      // Open EPUB via DocumentLoader (simulates reader loading real book)
      const bookDoc = (await new DocumentLoader(epubFile).open()).book;
      const bookNav = await computeBookNav(bookDoc);

      // Extract real reader CFIs from EPUB spine
      const sectionIds = Object.keys(bookNav.sections);
      const sec0 = bookNav.sections[sectionIds[0]!];
      const sec1 = bookNav.sections[sectionIds[1]!];
      const cueACfi = sec0?.fragments[0]?.cfi || 'epubcfi(/6/2!/4/2:0)';
      const cueBCfi = sec1?.fragments[0]?.cfi || 'epubcfi(/6/10!/4/2:0)';

      // Create real native Tauri app-data profile storage filesystems for profile 1 and clean profile 2
      const baseDir: BaseDir = 'Data';
      const realFs1 = createScopedNativeFileSystem('1');
      const realFs2 = createScopedNativeFileSystem('2');

      // Clean any pre-existing directories for a fresh test run
      await realFs1.removeDir('', baseDir, true).catch(() => {});
      await realFs2.removeDir('', baseDir, true).catch(() => {});

      const packageId = 'pkg-mac-roundtrip-33';
      const mp3A = createMinimalValidMp3Bytes();
      const mp3B = new Uint8Array([...createMinimalValidMp3Bytes(), 0xff, 0xfb, 0x90, 0x64]);
      const hashA = await sha256Hex(mp3A);
      const hashB = await sha256Hex(mp3B);

      // Build a valid multi-cue package fixture mapped to the real EPUB edition and spine CFIs
      const encoder = new TextEncoder();
      const manifestObj = {
        packageId,
        title: 'macOS Installed Reader Soundtrack',
        version: 1,
        manifestHash: '',
        editionCompatibility: [
          {
            algorithm: 'readest-partial-md5-v1' as const,
            digest: editionId,
            epubByteLength: epubBuf.byteLength,
          },
        ],
        assets: [
          {
            id: 'asset-a',
            path: 'audio/asset-a.mp3',
            mimeType: 'audio/mpeg' as const,
            hash: hashA,
            durationSec: 2.6,
          },
          {
            id: 'asset-b',
            path: 'audio/asset-b.mp3',
            mimeType: 'audio/mpeg' as const,
            hash: hashB,
            durationSec: 2.6,
          },
        ],
        cues: [
          {
            id: 'cue-a',
            startCfi: cueACfi,
            type: 'audio' as const,
            assetId: 'asset-a',
            startSec: 0,
            loopStartSec: 0.2,
            loopEndSec: 2.4,
            volume: 0.9,
            crossfadeSec: 0.2,
          },
          {
            id: 'cue-b',
            startCfi: cueBCfi,
            type: 'audio' as const,
            assetId: 'asset-b',
            startSec: 0,
            loopStartSec: 0.1,
            loopEndSec: 2.5,
            volume: 0.8,
            crossfadeSec: 0.2,
          },
        ],
      };

      const copyManifest = { ...manifestObj };
      delete (copyManifest as Partial<typeof copyManifest>).manifestHash;
      manifestObj.manifestHash = await sha256Hex(encoder.encode(JSON.stringify(copyManifest)));

      const zipWriter = new ZipWriter(new Uint8ArrayWriter());
      await zipWriter.add('manifest.json', new TextReader(JSON.stringify(manifestObj)));
      await zipWriter.add('audio/asset-a.mp3', new Uint8ArrayReader(mp3A));
      await zipWriter.add('audio/asset-b.mp3', new Uint8ArrayReader(mp3B));
      const zipBytes = await zipWriter.close();

      const { player, realCtx, getCreatedSources, getCreatedGains } = createSpiedPlayer();
      const createdSources = getCreatedSources();
      const createdGains = getCreatedGains();

      try {
        // Step B: Soundtrack attachment & Editable Copy creation on real Tauri native profile 1
        const importRes = await importAndAssociateBookScorePackage(
          realFs1,
          baseDir,
          zipBytes,
          editionId,
          undefined,
          { autoAttach: true },
        );
        expect(importRes.success).toBe(true);
        expect(importRes.package).toBeDefined();
        expect(importRes.association?.selected).toBe(true);

        const manifestHash = importRes.package!.manifestHash;

        const copyRes = await makeEditableCopy(
          realFs1,
          baseDir,
          packageId,
          manifestHash,
          editionId,
        );
        expect(copyRes.success).toBe(true);
        if (copyRes.success) {
          expect(copyRes.copy.sourcePackageId).toBe(packageId);
        }

        // Step C: User-started playback and crossfade with real spied player
        const store = useSoundtrackStore.getState();
        store.resetSoundtrack();
        store.setCapabilityEnabled(true);

        store.registerSoundtrackPlayer(player);
        await player.unlockGesture();
        expect(player.isUnlocked()).toBe(true);

        const packagesMap = await loadInstalledPackages(realFs1, baseDir);
        const associationsMap = await loadLocalAssociations(realFs1, baseDir);

        // Load soundtrack for reopened book at initial CFI (starts selected but PAUSED)
        store.loadSoundtrackForBook(editionId, packagesMap, associationsMap, cueACfi, editionId);
        expect(useSoundtrackStore.getState().playbackStatus).toBe('paused');
        expect(useSoundtrackStore.getState().selectedCue?.id).toBe('cue-a');
        expect(useSoundtrackStore.getState().isUserPlaying).toBe(false);

        // User explicitly starts playback (gesture unlocked + user play)
        await store.play(true, realFs1);
        expect(useSoundtrackStore.getState().isUserPlaying).toBe(true);
        expect(useSoundtrackStore.getState().playbackStatus).toBe('playing');
        expect(createdSources.length).toBe(1);

        // Reader location moves to cue B -> real crossfade / cue transition occurs
        store.reportLocation({ seq: 1, kind: 'resolved', cfi: cueBCfi });
        await waitForCondition(
          () =>
            useSoundtrackStore.getState().selectedCue?.id === 'cue-b' &&
            createdSources.length === 2,
        );
        expect(useSoundtrackStore.getState().selectedCue?.id).toBe('cue-b');

        expect(createdSources.length).toBe(2);
        const sourceA = createdSources[0]!;
        const sourceB = createdSources[1]!;
        expect(sourceB.src).not.toBe(sourceA.src);

        // Assert gain ramp down was initiated for sourceA
        expect(createdGains.length).toBeGreaterThanOrEqual(3);
        expect(createdGains[1]!.rampSpy).toHaveBeenCalledWith(0, expect.any(Number));

        // Step D: Induce real active-playback asset failure in installed profile & assert repair/silence recovery
        // Remove physical asset-a file from real disk storage
        const assetPath = getAssetFilePath(packageId, 'asset-a', manifestHash);
        await (
          realFs1 as unknown as { deleteFile: (p: string, b: string) => Promise<void> }
        ).deleteFile(assetPath, baseDir);

        // Move reader location back to cue-a to trigger active playback load of missing asset
        store.reportLocation({ seq: 2, kind: 'resolved', cfi: cueACfi });
        await waitForCondition(() => useSoundtrackStore.getState().playbackStatus === 'silence');

        // Playback MUST transition to silence-first recovery state
        expect(useSoundtrackStore.getState().playbackStatus).toBe('silence');

        // Verify failure was recorded in repairQueue
        const repairQueue = await loadRepairQueue(realFs1, baseDir);
        const repairItem = repairQueue[`${packageId}:${manifestHash}`];
        expect(repairItem).toBeDefined();
        expect(repairItem?.reason).toBe('missing');

        // Repair/re-import package back into profile 1
        const repairImportRes = await importAndAssociateBookScorePackage(
          realFs1,
          baseDir,
          zipBytes,
          editionId,
          undefined,
          { autoAttach: true },
        );
        expect(repairImportRes.success).toBe(true);

        // Assert repair queue entry is removed / cleared after successful re-import
        const clearedQueue = await loadRepairQueue(realFs1, baseDir);
        expect(clearedQueue[`${packageId}:${manifestHash}`]).toBeUndefined();

        // Reload original profile 1 maps and verify user-replay of repaired cue A
        const repairedPkgsMap = await loadInstalledPackages(realFs1, baseDir);
        const repairedAssocsMap = await loadLocalAssociations(realFs1, baseDir);
        store.loadSoundtrackForBook(
          editionId,
          repairedPkgsMap,
          repairedAssocsMap,
          cueACfi,
          editionId,
        );
        const countBeforeReplay = createdSources.length;
        await store.play(true, realFs1);
        expect(useSoundtrackStore.getState().isUserPlaying).toBe(true);
        expect(useSoundtrackStore.getState().playbackStatus).toBe('playing');
        expect(createdSources.length).toBeGreaterThan(countBeforeReplay);

        // Step E: Close/reopen with selected cue in paused state
        store.resetSoundtrack();
        store.setCapabilityEnabled(true);
        store.registerSoundtrackPlayer(player);

        const updatedPkgsMap = await loadInstalledPackages(realFs1, baseDir);
        const updatedAssocsMap = await loadLocalAssociations(realFs1, baseDir);

        store.loadSoundtrackForBook(
          editionId,
          updatedPkgsMap,
          updatedAssocsMap,
          cueACfi,
          editionId,
        );
        const reopenedState = useSoundtrackStore.getState();
        expect(reopenedState.activePackage?.packageId).toBe(packageId);
        expect(reopenedState.selectedCue?.id).toBe('cue-a');
        expect(reopenedState.playbackStatus).toBe('paused');
        expect(reopenedState.isUserPlaying).toBe(false);

        // Step F: Export, clean-profile import, explicit reattachment, and replay
        const exportRes = await exportBookScorePackage(realFs1, baseDir, packageId, manifestHash);
        expect(exportRes.success).toBe(true);
        if (!exportRes.success) return;
        expect(exportRes.archiveBytes).toBeDefined();

        // Clean profile import on real native profile 2 (realFs2)
        const cleanImportRes = await importAndAssociateBookScorePackage(
          realFs2,
          baseDir,
          exportRes.archiveBytes,
          editionId,
          undefined,
          { autoAttach: false },
        );
        expect(cleanImportRes.success).toBe(true);

        // Candidate matching for edition
        const cleanPackagesMap = await loadInstalledPackages(realFs2, baseDir);
        const { candidates } = computeSoundtrackCandidates(editionId, cleanPackagesMap, {});
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates[0]!.package.packageId).toBe(packageId);

        // Explicit reattachment
        const reattachRes = await associateSoundtrackToEdition(
          realFs2,
          baseDir,
          editionId,
          cleanImportRes.package!.packageId,
          cleanImportRes.package!.manifestHash,
        );
        expect(reattachRes.success).toBe(true);
        if (!reattachRes.success || !reattachRes.association) return;
        expect(reattachRes.association.selected).toBe(true);

        // Replay in clean profile 2
        store.resetSoundtrack();
        store.setCapabilityEnabled(true);
        store.registerSoundtrackPlayer(player);

        const cleanAssociationsMap = await loadLocalAssociations(realFs2, baseDir);

        store.loadSoundtrackForBook(
          editionId,
          cleanPackagesMap,
          cleanAssociationsMap,
          cueACfi,
          editionId,
        );
        expect(useSoundtrackStore.getState().selectedCue?.id).toBe('cue-a');
        expect(useSoundtrackStore.getState().playbackStatus).toBe('paused');

        await store.play(true, realFs2);
        expect(useSoundtrackStore.getState().isUserPlaying).toBe(true);
        expect(useSoundtrackStore.getState().playbackStatus).toBe('playing');

        console.log(
          '[PASS] Installed-style macOS BookScore reader full round-trip journey passed successfully.',
        );
      } finally {
        await player.dispose();
        await realCtx.close();
      }
    });
  });
});
