# PROTOTYPE — Soundtrack playback experience

**Status:** throwaway interaction-model artifact for [Design the soundtrack playback experience](https://github.com/anrkuist/bookscore/issues/6). This is not production UI or a specification for component structure.

## Question

What reader experience makes soundtrack discovery, selection, consent, playback controls, active-track visibility, scene transitions, intentional silence, navigation, reopening, mismatch warnings, and TTS exclusion understandable without distracting from reading or revealing spoilers?

## Agreed interaction model

### Reading surface

The reading surface stays free of track and scene names. Its header has one quiet music button that communicates only playback state:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  Book title                                                  [♬  paused] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                          EPUB reading surface                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

Opening that button explicitly reveals an on-demand right-side panel. It is the only place in reading mode that exposes the active soundtrack, track, scene, volume, or an Unverified association label.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  Book title                                           [♬ playing] [×]  │
├─────────────────────────────────────────────────────┬───────────────────┤
│                                                     │  Soundtrack       │
│                  EPUB reading surface               │                   │
│                                                     │  [❚❚ Pause]       │
│                                                     │                   │
│                                                     │  Now playing      │
│                                                     │  Rain at Dusk     │
│                                                     │  ━━━━━━━━●━━  70% │
│                                                     │                   │
│                                                     │  Soundtrack       │
│                                                     │  Moonlit Road  ▾  │
│                                                     │                   │
│                                                     │  Manage in Library│
└─────────────────────────────────────────────────────┴───────────────────┘
```

### Discovery and selection

Library → book details owns soundtrack import, first attachment, mismatch confirmation, and management. The reader panel can switch only among soundtracks already attached to the current edition.

### First use and reopening

On first attachment, Library opens the reader panel with a compact ready state. Audio never starts without the reader pressing Play.

```text
┌────────────────────────── Soundtrack ───────────────────────────────────┐
│  Ready to play                                                           │
│  This soundtrack is stored on this device and starts only when you ask.  │
│                                                                          │
│                         [▶ Play soundtrack]                              │
└──────────────────────────────────────────────────────────────────────────┘
```

Reopening a book restores its saved reading location, selects the containing cue, and waits paused for Play.

### Scene transitions and intentional silence

Scene changes crossfade in audio without a toast, banner, or reader-surface announcement. The open panel updates its track details. A silence cue is a valid, armed playback state—not a missing track or error.

```text
┌────────────────────────── Soundtrack ───────────────────────────────────┐
│  Quiet scene                                                             │
│  This scene has no audio. Playback is armed for the next scene.         │
│                                                                          │
│                         [❚❚ Pause]                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

Play while at an intentional-silence cue arms playback for the next audible cue; Pause prevents future scene-triggered audio.

### Trust and TTS

A forced mismatch displays its prominent warning before attachment. Once accepted, the Local Association is marked Unverified only in Library details and the open reader panel; unresolved cues fail to silence.

Starting text-to-speech pauses an active soundtrack immediately and gives a brief one-line notice. The soundtrack remains paused when TTS stops; the reader explicitly presses Play to resume it.

## Verdict

Use an on-demand right-side **Soundtrack panel** as the playback module's sole detailed interface. It provides a small reader-surface seam—open/close, Play/Pause, volume, and choose an attached soundtrack—while hiding cue resolution, crossfading, silence handling, association trust, and TTS arbitration behind it. This preserves reader focus, avoids spoiler-prone chrome, and makes all audible behavior explicitly user-controlled.
