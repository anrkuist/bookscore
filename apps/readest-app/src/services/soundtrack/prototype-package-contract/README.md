# Soundtrack package contract prototype

**THROWAWAY PROTOTYPE.** This is a small in-memory terminal model, not package implementation code.

It asks whether one reader-neutral manifest can express authorship and licensing, versioning, compatible EPUB fingerprints, self-contained MP3 assets, ordered EPUB-CFI scene-start cues, explicit silence, loop/start/volume/crossfade values, and an immutable imported package with an editable descendant.

Run from `apps/readest-app`:

```sh
pnpm prototype:soundtrack-package
```

Try these sequences:

1. `v` validates the original package.
2. `a` demonstrates that imports cannot be edited.
3. `c`, then `a`, makes an editable descendant and adds an intentional-silence cue.
4. `x`, then `v`, demonstrates archive-integrity validation.

The model deliberately keeps `mode` outside the manifest: immutability is a local import rule, while `derivedFrom` is portable lineage.
