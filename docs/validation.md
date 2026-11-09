# Validation and remaining QA

## Current staged package: November 9, 2026

`npm run check` passes four JavaScript syntax checks and **151 tests**, with zero failures, skips, or cancellations. The two optional evaluation scripts also pass `node --check`. Tests cover the engine, source grounding, retrieval safeguards, adapter validation, real ephemeral-loopback HTTP/CLI behavior, client DOM doubles, import cancellation/races, and accessibility source contracts. DOM doubles and declared CSS contrast calculations are not browser or assistive-technology audits.

The README regression preserves historical problem sentences as explicit test fixtures and also grounds generated items from the current README. Application code is unchanged from the reviewed source.

## Reproduced offline evaluation

Run `mkdir -p artifacts && node scripts/evaluate-diverse-notes.mjs` from the repository root. Four original synthetic fixtures produced 32 map excerpts and 48 cards. All 80 items passed exact-source checks and the HTTP health check passed. **18 of 20 query expectations matched.** The script records mismatches but does not fail its exit status for them:

- “When did France proclaim a republic?” abstained despite the expected S9 passage. Morphology matching remains limited.
- “What happens to a after b[0].append(3)?” abstained despite the expected S12 passage. Code behavior and cross-source context are not inferred.

These conservative false negatives remain limitations. Development fixtures, retrospectively chosen expectations, heading coverage, and exact quotes do not establish general retrieval accuracy, card quality, or learning outcomes.

## Historical desktop evidence: November 8, 2026

A focused real-browser demo check recorded sample generation (13 sources, eight excerpts, ten cards, four topics), source reveal, a scripted confidence gap, retry with retained attempt history, matching and abstaining questions, a real Markdown export, disclosure, and reload persistence. This is historical evidence, not a fresh browser run of the staged folder. The video was later rebuilt using real interaction footage; see [demo notes](demo.md).

## Still not complete

- Current native file-chooser and interrupted-import browser checks.
- Mobile layout, zoom/reflow, keyboard-only navigation, focus behavior, and screen-reader announcements.
- Fresh live-model inference and broader model/card-quality evaluation.
- Learner testing with appropriate consent, security audit, and production hardening.

The optional live helper requires an already installed and running Ollama service/model: `mkdir -p artifacts && node scripts/validate-live-coverage.mjs`. It was not run for this staging check. No runtime/model download, public deployment, or publication was performed. A fallback response does not establish successful inference.
