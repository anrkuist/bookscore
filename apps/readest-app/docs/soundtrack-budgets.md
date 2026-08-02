# Soundtrack Release Budgets & Platform Gating

This document establishes the repeatable performance budgets for the BookScore soundtrack feature (GitHub issue #29 / parent #19), documents the platform-gating mechanisms, and details the verification procedures for all target platforms.

---

## 1. Reproducible Baseline Budgets

Measurements are obtained by running the soundtrack benchmark:
```bash
pnpm bench soundtrack
```
The benchmark measures reader navigation lookup latency, package validation time using the production validator, and calculates decompressed PCM memory consumption.

### Reference Host Environment
The illustrative measurements below were captured under the following environment:
- **Platform**: `darwin/x64` (macOS running Node via Rosetta translation)
- **CPU**: Intel(R) Core(TM) i7-8750H CPU @ 2.20GHz (12 cores)
- **Memory**: 16 GiB
- **Node**: `v24.18.1`
- **Revision**: `8e4a1a48`

### A. Reader Navigation / Transition Impact (`findCueForCfi`)
- **Metric**: Average duration of a CFI lookup (sorting then linear scan) against a cue list during page transitions.
- **Illustrative Results**:
  - **10 cues**: ~320.57 µs (0.32 ms)
  - **100 cues**: ~4,183.89 µs (4.18 ms)
  - **1,000 cues**: ~71,370.92 µs (71.37 ms)
  - **5,000 cues**: ~232,462.41 µs (232.46 ms)
- **Analysis**: The current implementation of `findCueForCfi` performs an in-place sort of the cues array (`[...cues].sort(...)`) followed by a linear scan on every navigation event, resulting in $O(N \log N)$ complexity.
- **Budget / Threshold**:
  - For standard novels with under 100 cues, lookup is fast (< 5 ms) and has negligible frame budget impact.
  - Large cue sets (> 1,000 cues) exceed 16.6 ms (1 frame) and can cause visible transition stutter.
  - **Release Budget Policy**: Audio loop/cues should ideally be kept under **100 cues** per soundtrack package, or timing maps consolidated to section-level starts.

### B. Import Validation Time
- **Metric**: Time taken to unzip a `.bookscore` package, parse the manifest, verify SHA-256 checksums, and decode/validate MP3 headers using the production validator.
- **Illustrative Result**: ~2.78 ms (for a minimal package with 1 asset and 1 cue, verifying decoded duration limits).
- **Budget / Threshold**: Package validation must complete in **< 100 ms** to ensure the import UI does not freeze or feel unresponsive to the user.

### C. Installed-Audio Memory Footprint (Web Audio PCM)
- **Metric**: Calculated uncompressed float32 PCM buffer memory allocated in the AudioContext once loaded.
- **Formula**: `durationSec * sampleRate (44100 Hz) * channels (2) * bytesPerSample (4 bytes / float32)`
- **Reference Footprints**:
  - **1m loop**: 20.19 MiB (21,168,000 bytes)
  - **5m track**: 100.94 MiB (105,840,000 bytes)
  - **15m album**: 302.81 MiB (317,520,000 bytes)
  - **60m soundtrack**: 1,211.24 MiB (1,270,080,000 bytes)
- **Release Budget Policy**:
  - Web Audio API loads fully decoded PCM buffers in memory.
  - To prevent OOM crashes on memory-constrained systems, individual audio loop tracks must not exceed **5 minutes** (~100 MiB).

---

## 2. Platform Gating & Guard Rails

Soundtrack playback, file system storage, and user interface panels are gated strictly to **Desktop Only** (macOS, Windows, Linux Tauri apps).

- **Implementation**: Gated via `isBookScoreCapabilityEnabled` in `src/services/bookscore/capability.ts`.
- **UI Gating**:
  - The reader header `SoundtrackControl` (which renders the note button and launches the control panel) is completely hidden (`return null`) if the capability is disabled.
  - The `BookDetailSoundtrack` panel (in the book detail view) is completely hidden (`return null`) if the capability is disabled.
- **Behavior on Unsupported Platforms**:
  - **Web / Cloudflare Workers**: Returns `false` (no Tauri APIs).
  - **iOS / Android**: Returns `false` (gated by `isMobile: true` options).

---

## 3. Verification & Smoke Checks

### A. Web / Mobile Check (Proving Soundtrack UI remains absent)
1. **Web (Local)**:
   - Run: `pnpm dev-web`
   - Open reader in browser: `http://localhost:3000`
   - **Verification**: The music note icon is absent from the header bar, and no soundtrack option appears in the Book Details panel.
2. **Mobile (Android/iOS)**:
   - Run: `pnpm dev-android` or `pnpm dev-ios`
   - **Verification**: Open any book. The music note icon is absent from the header, and no soundtrack details are shown in the Book Details view.

### B. Unaffected-Reader Smoke Check
1. Open a book without any attached soundtrack.
2. Navigate between chapters and turn pages.
3. **Verification**: Confirm page turns are instantaneous, and console logs are free of soundtrack errors (no playback triggers, state remains `silence` / `null`).

### C. Windows / Linux Build Instructions (For respective hosts)
- **Windows Build**:
  ```bash
  pnpm build-win-x64
  ```
  *Note*: Despite the target name `build-win-x64`, the underlying command compiles targeting 32-bit Windows (`i686-pc-windows-msvc`) as configured in `package.json`.
  Generates `src-tauri/target/i686-pc-windows-msvc/release/bundle/nsis/Readest_*_x86-setup.exe` installer.
- **Linux Build**:
  ```bash
  pnpm build-linux-x64
  ```
  Generates `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/Readest_*_amd64.AppImage`.
