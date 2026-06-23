# EditorState Benchmark Baseline (pre-COW)

Captured 2026-06-21 against `master @ 1663800` (architecture doc COW roadmap commit).
Bench harness: Vitest 2.1.9, `npm run bench` -> `vitest bench --run --root libs/editor`.
Source: `libs/editor/src/lib/editor/core/state.bench.ts`.
Frozen JSON: `libs/editor/bench-baseline.json` (committed).
Latest run JSON: `libs/editor/bench-results.json` (gitignored — overwritten each run).

## How to diff after COW

```
npm run bench
# compare libs/editor/bench-results.json against bench-baseline.json
```

The `hz` field (ops/sec) is the primary comparison metric. `rme` is relative margin of error -
treat any delta inside ~2x rme as noise.

## Baseline numbers

| Scenario | ops/sec (hz) | mean (ms) | p99 (ms) | rme | notes |
| --- | ---: | ---: | ---: | ---: | --- |
| build 100 paragraphs x 80 chars | 1 933.75 | 0.517 | 1.039 | 1.25% | construction cost, small doc |
| build 1000 paragraphs x 80 chars | 19.13 | 52.265 | 57.830 | 3.82% | construction cost, large doc (~101x slower than 100-para) |
| insertText tail on 100-paragraph doc | 240 786.17 | 0.0042 | 0.0069 | 0.85% | local mutation, small doc |
| insertText tail on 1000-paragraph doc | 16 201.97 | 0.0617 | 0.1285 | 0.93% | dominated by `getTextNodes()` full walk inside `insertText` |
| applyFormat BOLD across full 100-paragraph doc | 19 307.63 | 0.0518 | 0.0974 | 1.25% | worst-case (touches everything) |
| **single-char mid-doc insert (1000 paragraphs)** | **2 731 152.36** | **0.000366** | **0.0008** | 0.62% | pure text mutation through pre-resolved key — no traversal |
| **repeated BOLD toggle on one mid-doc paragraph (1000 paragraphs)** | **4 961.55** | **0.2015** | **0.3823** | 1.11% | local op but pays full-doc walk via `collectTextNodesBetween` / `nextTextNodeInDocument` |
| **typing burst: 50 tail appends on 500-paragraph doc** | **40.87** | **24.466** | **30.158** | 5.25% | builds doc each iter + 50 appends; tail-walk dominated |

## Reading these for COW evaluation

Three signals to watch when re-running after COW lands:

1. **Single-char mid-doc insert** — pure mutation via pre-resolved key. Currently 2.7M ops/s.
   Under naive COW this should drop sharply because every mutation clones the parent chain
   to root. The drop quantifies COW's per-edit ceiling.
2. **Repeated BOLD toggle on one paragraph** — already dominated by `getTextNodes()` cost
   (full-doc walk per call). COW adds copy-up cost on top. If hz stays >~3000 we know the
   walk dominated and COW is "free"; if it drops sharply the copy-up wins as the new bottleneck.
3. **Typing burst** — closest to real input. Captures whether COW amortizes when the same
   ancestor chain is hit repeatedly. Expect a clean regression here if no path caching.

The construction benches are reference-only — they exercise structural builders, not
the COW-touched mutation path.

## Methodology caveats

- Vitest bench API is experimental in v2.x; we pin `vitest@2.1.9` exactly for that reason.
- Numbers are wall-clock on the dev machine. For headline comparisons, prefer running
  baseline + post-COW back-to-back on the same machine, same hour, same load.
- The mid-doc insert bench re-uses the same `NodeMap` across iterations and only grows the
  one target node. Across 1.3M samples this added ~1.3MB of text — within noise for a 1000-
  paragraph doc but worth resetting if iteration counts grow.
- `applyFormatToRange` benches mutate the document structurally (splits/merges). The bench
  toggles a flag rather than measuring a fixed shape, so under COW the iteration shape is
  identical pre/post by construction.
