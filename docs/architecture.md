# Architecture and trust boundaries

StudyTrace is a dependency-free Node.js ESM server with a plain HTML/CSS/JavaScript client. It is a single-browser local prototype, not a production service.

## Files and flow

- `public/index.html`, `public/styles.css`, `public/app.js`, and `public/favicon.svg`: interface, confidence-before-reveal practice, source dialogs, local history, Markdown export, and browser storage.
- `src/server.mjs`: fixed static routes, input validation, JSON endpoints, HTTP security headers, CLI configuration, and a two-request AI concurrency limit.
- `src/engine.mjs`: deterministic parsing, extractive study generation, source search, and conservative matching-excerpt answers.
- `src/ollama.mjs`: optional local-model request and strict source-matching validation with extractive fallback.
- `test/*.test.mjs`: engine, retrieval, adapter, server, CLI, and client regression tests using Node's built-in test runner; client tests use DOM doubles.

The browser submits notes to `POST /api/study`. The server parses them and uses either offline extraction or the configured local-model adapter. The result includes sources, excerpts, cards, mode, warnings, and generation provenance. The client stores the current set and the original notes used to build it separately from editable draft notes. `POST /api/ask` uses that set's original notes, preventing draft edits from silently changing its evidence IDs. The server reparses each question request independently; it does not retain previous users' notes.

`GET /api/health` returns service metadata. Other API routes are rejected; known routes reject unsupported methods. Notes must contain at least 40 characters after trimming leading/trailing whitespace and at most 60,000 total characters. JSON bodies are bounded at 270,000 bytes; questions must be 3–500 characters.

## Offline engine

`parseNotes(text)` emits `{id, text, heading}` sources. Headings and list markers are interpreted as structure. Sentence text remains an exact substring of the input; decimal points, common abbreviations, and URLs are preserved. IDs are deterministic within a parsed note set, not universal identifiers across edits.

Study generation filters short or instruction-like sentences, removes repeated facts, scores information-bearing text, and samples across heading groups. It returns at most eight complete-source summaries and twelve cloze cards. Each card blanks a verbatim answer span; its evidence is the full source sentence. Candidates with no letter or number left in the visible source context are excluded before the twelve-card selection, without removing their source or changing summary eligibility. This prevents a blank-only card, but does not guarantee a useful or self-contained learning prompt. The implementation is deterministic extraction and must not be presented as an AI model inference result.

Offline cards prefer intact subjects, relation complements, and full dates, with an eight-word and 80-character answer cap. Surface rules preserve tested qualifications, skip obvious unresolved references, and avoid whole-answer hints in headings or the remaining sentence. Card selection favors eligible sources absent from the study map while retaining heading diversity. These heuristics can omit useful unfamiliar structures and leave weak or strongly cued targets. See [validation](validation.md) for reproduced fixture checks and remaining limitations.

### Retrieval safeguards

Source search normalizes a limited set of English word endings and returns up to four ranked candidates. It filters for every numeric literal in the query before scoring and limiting results. Signs, decimals, and exponent notation are compared as written; values, units, and number roles are not interpreted or normalized. A numeral match is necessary evidence, not proof that the requested condition is supported.

Programmatic source lookup also recognizes one simple `P(...)` expression. It preserves event case, event order, and the literal operator, and requires the expression to occupy a formula's entire left side. A right-side occurrence is insufficient; malformed or compound probability requests return no candidates. This does not infer independence, gather assumptions from neighboring sources, or equate alternative notation.

Q&A requires all meaningful query terms to match a candidate and conservatively declines negation/comparison requests. Quantity questions also require explicit numerical evidence. Explicit `formula`/`equation` requests, `P(...)` notation, and recognized mathematical operator characters cause Q&A to abstain even if source lookup can locate a formula. This intentionally rejects some answerable requests, including some non-mathematical uses of symbols. Unrecognized symbolic forms can still escape the heuristic.

Successful results are labeled **Matching note excerpt**. The question endpoint remains deterministic in either study-generation mode. This is lexical retrieval, not semantic reasoning, mathematical support, a correctness judgment, or a synthesized answer. See [validation](validation.md) for observed query mismatches and limitations.

## Optional model path

`generateWithOllama` posts to `/api/generate` on a validated localhost origin. The prompt treats notes as untrusted data and asks for summary source IDs and card source IDs with exact answer spans. Ollama receives a JSON schema limiting the output to these selections, temperature zero, and a 3,000-token generation limit. Request redirects are prohibited. The timeout defaults to 90 seconds and is bounded between 5 and 180 seconds.

The adapter validates every selection independently, even when schema-constrained generation is available:

1. Only the specified object fields are permitted. Model-written summaries, prompts, quotes and other extra fields are rejected.
2. A selected source ID must exist and meet the prior extractive source-eligibility rule, now preserved separately in `isEligibleModelSource`. The stricter offline answer chooser does not narrow that rule. Ineligible source text is excluded from the model request. With no eligible sources, inference is skipped.
3. A card answer must be an exact, case-sensitive source substring, at least three characters, with no surrounding whitespace, generic stopword, partial-word boundary or whole-sentence blank.
4. Duplicate summary sources and identical card answers for the same source are removed. Selection limits remain eight summaries and twelve cards.
5. The application constructs summary text and evidence quotes from the complete source. It constructs each cloze prompt by replacing the first exact answer occurrence with `____`, prefixed with `Complete the note: `. The model does not supply displayed question premises.

Model-selected answers retain this validator; the offline eight-word/80-character cap and other span-selection heuristics do not apply to them. Preserved source eligibility does not establish model answer quality. Live inference was not repeated after the offline card revision.

Validated model summaries and cards are each merged with their heading-diverse extractive fallback. One item per candidate heading is reserved before adding more from already represented headings, up to eight summaries and twelve cards. Model choices take precedence within a heading; a missing heading can replace a repeated-heading model choice with an explicitly offline item. Distinct validated card spans from the same source remain eligible after heading reservation; the fallback does not add an alternative for a source already selected by the model. Retained model items keep their relative order. Coverage refers to source headings, not semantic topic completeness; empty, filtered or duplicate-only headings do not require fabricated content, and headings beyond the respective item limit cannot all fit.

If no model items survive validation, or requests/JSON parsing fail, the offline set is returned with a warning. `mode: 'ollama'` means at least one displayed item was selected by the model and passed source checks, not that every item came from the model or that the content is true.

Every card and summary carries `provenance: 'offline' | 'ollama'`. Model provenance means the model selected the source/span; the server still constructs display text. `generation` records `{model, accepted, rejected, fallbackItems}` and optional `omittedForCoverage`. `accepted` counts model-selected items actually displayed; `fallbackItems` counts displayed offline items. `rejected` counts invalid, duplicate or over-limit proposed items. `omittedForCoverage`, when nonzero, counts valid model summaries and cards displaced for heading diversity, with separate summary/card warnings rather than labeling them unverified. These three model counts reconcile to the number of proposed items. Counts refer to summary/card items, not tokens or unique concepts. A model identifier can appear on a fully rejected plan while the set remains offline. Unavailable-model fallback can have `model: null` because no accepted model generation exists.

No model is bundled or downloaded automatically. Controlled model tests are separate from live inference. Factual accuracy, robust semantic selection, educational effectiveness, and suitability on other hardware remain unverified.

## Practice trace and persistence

A learner selects confidence before revealing a card answer. After comparing with the quote, they choose recalled or needs review. There is no automatic answer grading. The browser stores the latest outcome per card and up to 500 timestamped attempts. A highest-confidence attempt marked for review creates an unresolved confidence-gap indicator until the latest rating changes. Retry controls return to the relevant card and its evidence.

The storage key is `studytrace.workspace.v1`. Browser localStorage contains the draft, study set, source notes, progress, and history as unencrypted JSON. Practice exports also contain source notes and history. Clearing progress keeps the notes/cards; clearing the workspace removes the application storage key after confirmation. The server has no database or intended note persistence. Browser storage and downloaded files are not encrypted or guaranteed securely erased.

## Security boundaries and residual risks

- Client data is rendered as text rather than trusted note HTML. The server serves only an explicit public file map.
- JSON media types, field types, sizes, methods, and paths are checked. Encoded traversal and malformed paths are rejected.
- CSP restricts resources and browser connections to the same origin; framing and common capability access are disabled through response headers.
- Origin validation rejects mismatched hosts and invalid/non-HTTP origins; `Sec-Fetch-Site: cross-site` is rejected. Missing Origin headers are accepted for normal local clients.
- Unknown Host headers are intentionally accepted to support managed previews. This leaves a DNS-rebinding limitation. Same-host Origin checks are not authentication, and forwarded/proxy trust is not a complete production security design.
- Loopback binding is the default, but CLI/environment settings can change it. Remote hosting or previewing changes the data destination; users must not assume remote use keeps notes on their own computer.
- The Ollama destination is restricted to localhost names/IPs, but the local service and machine remain trusted components with independent policies. The app does not use analytics or external AI APIs.
- Heuristic instruction filtering and exact citation checks do not establish factual accuracy, safe source content, good learning objectives, or comprehensive protection against adversarial notes. Sensitive or untrusted material needs additional review.

## Validation and remaining work

See [validation](validation.md) for current automated checks, historical browser evidence, and outstanding work. Source-contract and DOM-double tests do not establish browser accessibility or WCAG conformance. No independent security audit or learner-effectiveness validation is claimed.
