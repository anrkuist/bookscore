# Reader location seam prototype

> PROTOTYPE — this code is a disposable decision aid and must not ship as the production implementation.

## Question

Is one ordered `reportReaderLocation(report)` interface enough to preserve authored EPUB location, navigation semantics, safe unresolved states, and latest-wins behavior across pagination, scrolling, jumps, history, restore, and rapid transitions without exposing Foliate, DOM, soundtrack, or platform types?

## Run

From `apps/readest-app`:

```sh
pnpm prototype:location-seam
```

The important scenario is `z`: two jumps begin, the newer one settles first, and the older result arrives late. The visible authored location must remain on the newer transition. Use `j` then `x` to verify that an anchor failure becomes explicit safe silence rather than leaving a stale cue selected.

## Candidate interface

- One input: `reportReaderLocation(report)`.
- Every user or restore transition receives a monotonically increasing `transition` number at the reader adapter.
- A transition may report `started` before asynchronous anchor resolution, then exactly one `settled` result.
- A settled location is either a reader-neutral EPUB CFI or an explicit unavailable reason.
- Navigation retains only stable semantics: restore, page, scroll, or jump, plus authored direction where known.
- Older and duplicate reports are ignored. A newer unresolved transition immediately makes cue selection unsafe, so the consumer selects silence until it settles.

The production seam should live outside generic reader components. A thin Foliate adapter can combine renderer navigation reasons with the view's generated CFI, assign transition numbers, and report through this interface. Cue selection and Authoring Mode consume only the seam's reader-neutral state.
