# StudyTrace

A local education prototype that turns notes into source-linked study aids and lets learners compare confidence with self-rated recall.

A dependency-free prototype with an offline extractive mode and optional local Ollama model selection. No model is bundled; offline extraction is **not generative AI**.

## Try it

Requires **Node.js 22 or newer**. There are no runtime packages, package installation, API keys, build tools, or external assets required for offline use.

```sh
npm start
```

Open the printed address, normally `http://127.0.0.1:3000`. Choose the sample biology notes or paste your own English notes, then build a study set. The server accepts 40–60,000 characters of notes.

```sh
npm run check
```

This checks four JavaScript files and runs the Node test suite. See [validation and remaining QA](docs/validation.md) for current results and the difference between automated tests and browser checks.

## What the prototype does

- Extracts up to eight study-map excerpts and twelve cloze cards, ranked for information and sampled across headings.
- Chooses concise offline answer spans and favors eligible card sources absent from the study map. These English heuristics can skip useful material and do not guarantee good recall questions.
- Links each card and excerpt to a stable source ID within that note set and an exact quote.
- Asks learners to choose confidence before revealing a card's answer, then self-rate whether they recalled it or need review.
- Highlights a confidence gap when a learner chose the highest confidence but marked the card for review. The trace connects the attempt to its card, topic, and source evidence.
- Offers source search and cautious matching excerpts for questions. Query numbers must appear literally in the matching source. Q&A abstains on formula/equation requests and recognized mathematical notation, as well as tested missing terms, comparisons, negation, and unsupported quantities. It does not calculate or interpret formulas.
- Saves one workspace in the browser, keeps up to 500 practice attempts, and exports a Markdown study record. New sets reset their practice history.

Self-ratings are not automatic grading, proof of mastery, or evidence of educational effectiveness. Source matching checks correspondence to supplied notes, not factual truth. No claim of unique or globally novel functionality is made.

## Exploratory note evaluation

Four original synthetic fixtures are included under `examples/evaluation/`. They exercise history, statistics, programming, and chemistry. They are development fixtures, not an independent benchmark or learner study. Exact quotes and heading coverage do not guarantee useful cards, complete content, or educational effectiveness.

To reproduce the offline evaluation:

```sh
mkdir -p artifacts
node scripts/evaluate-diverse-notes.mjs
```

Output is written to the ignored `artifacts/` directory. The report records query expectation matches; a successful script exit alone does not mean all query expectations passed. Read [validation](docs/validation.md) for limitations.

## Optional local AI

The optional adapter uses a locally running Ollama model to select source IDs and exact cloze answer spans. The server constructs every displayed excerpt, quote and prompt directly from its cited source. It does not permit uncited generated explanations. Valid model selections are combined with deterministic fallback items; the app reports their origins and counts. Summary and card selection reserve one item per available heading before repeats, up to eight summaries and twelve cards, and visibly label any needed offline additions.

To try this yourself:

1. Review and install Ollama from its official site, [ollama.com](https://ollama.com/). Review its terms and the selected model's terms before use.
2. Download the model using `ollama pull qwen2.5:3b`. This setup step requires internet access, disk space, and suitable hardware; the application does not download models for you.
3. Start Ollama locally, typically through its app or `ollama serve`, and leave it running.
4. Start StudyTrace and choose local AI mode before building a set.

The default 3B model uses the [Qwen Research License](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct/blob/main/LICENSE), not Apache 2.0. Review its non-commercial research/evaluation restrictions and suitability for your intended use. Model terms are separate from this project's licensing.

Earlier limited sample runs used real local inference, but it has not been rerun for this staged package. Automated adapter tests use controlled responses, not a real model. The app labels accepted model selections and offline fallback items separately. A successful fallback is not evidence of model inference.

### Configuration

```sh
npm start -- --host 127.0.0.1 --port 4173 --strictPort
```

`--host=value` and `--port=value` also work. CLI options override `HOST` and `PORT`. The default host is `127.0.0.1` and port is `3000`; port `0` requests an available ephemeral port. An occupied port fails rather than silently changing ports; `--strictPort` is accepted for preview tooling.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server bind address. Keep loopback for local use. |
| `PORT` | `3000` | Server port. |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Local origin only: `localhost`, `127.0.0.1`, or `[::1]`. Credentials, paths, query strings, redirects, and other hosts are rejected. |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Model already installed in the local Ollama service. |
| `OLLAMA_TIMEOUT_MS` | `90000` | Model timeout, clamped to 5,000–180,000 ms. Invalid values use 90,000 ms. |

The server limits concurrent AI requests to two. Model requests use temperature `0`, JSON-schema-constrained selections, and a `num_predict` limit of `3000`. Larger notes and CPU-only systems may still time out; use offline mode or smaller note sets.

## Privacy and limitations

- In normal loopback operation, browser requests go to the local server. The application has no analytics, external fonts, paid APIs, or third-party network calls except the explicitly selected localhost Ollama service.
- Notes, generated study sets, typed practice answers, and progress are saved in **unencrypted browser localStorage**. People or scripts with access to that browser profile may read them. Avoid sensitive notes on shared devices. Clearing the workspace removes this app's stored workspace; downloaded exports remain separate files.
- The server processes notes in memory and does not intentionally log or persist them. The optional model service has its own independent data-handling behavior. This is not an encryption or secure-erasure guarantee.
- If the app is run on a remote machine or through a preview proxy, the notes travel to that machine. “Local” refers to the server and model placement, not an automatic promise that a remote preview stays on your device.
- Fixed public routes, CSP, same-host Origin checks, size limits, and text rendering reduce some risks. Unknown Host headers remain accepted for managed previews, so strict DNS-rebinding protection is absent. There is no authentication, multi-user isolation, production deployment hardening, or security certification. Do not expose this prototype to untrusted networks.
- English sentence, ranking, and morphology heuristics can miss relevant passages or select weak cards. Citations do not correct inaccurate or malicious notes. Instruction-like text filtering is heuristic, not a complete prompt-injection defense. See [architecture and trust boundaries](docs/architecture.md).

## Demo and QA

See the [demo and video notes](docs/demo.md) for the demonstrated flow and honest video disclosure. No public video URL is included in this package. Video production files and personal submission records are intentionally excluded.

## Project layout

- `src/`: local HTTP server, extractive engine, and optional Ollama adapter.
- `public/`: browser UI and local static assets.
- `test/`: Node regression tests, HTTP tests, and DOM/source-contract checks.
- `examples/`: original synthetic notes.
- `scripts/`: optional offline and local-model evaluation helpers.
- `docs/`: architecture, validation, and demo limitations.

## Attribution and licensing

OpenAI dot/Codex generated and assisted with implementation code, tests, UI, and documentation. Human authorship and contribution statements should be reviewed by the project owner before publication.

No project license has been selected or added. Public visibility alone does not grant an open-source license. The owner must decide what rights to grant before describing this project as open source. Model weights are not included and remain governed by their own license.

## Before public release

- Review the complete source and attribution, and choose a project license if desired.
- Complete outstanding browser/accessibility checks and broader model/card-quality evaluation.
- Review any public demo and add its verified link only after it is hosted.
- Keep private notes, exports, credentials, production media, and personal submission information out of the repository.
- Do not expose this local prototype directly to untrusted networks.
