# REAL_QWEN_PILOT_PLAN

This plan is intentionally not executed by the V1.1 development run.

## Authorization boundary

- Requires separate written approval for paid Qwen calls and the exact budget ceiling.
- Uses an isolated pilot database and storage; never the production database.
- Disables response reuse and cache-based scoring claims. Every repeat is an independent call.
- Uses the frozen `AIQC-PRD-V1.1-R1` prompt, schema, rubric, rating and preprocessing versions.

## Stability pilot

- Samples: at least 30 different videos, stratified by video type, platform, brand and quality.
- Calls: at least 3 independent scoring calls per video, minimum 90 valid calls.
- Technical failures do not count as valid calls and remain bounded by the six-attempt workflow cap.
- Estimated cost must be calculated from the selected Qwen model's current price before approval; no price is hard-coded here.
- Metrics: per-video maximum score difference, P90 maximum difference, exact-grade consistency and severe-instability Hold interception.
- Acceptance: deterministic backend scoring 100%; P90 maximum difference no more than 5; severe-instability interception 100%.

## Human accuracy pilot

- At least 100 manually labelled samples, including at least 30 untouched holdout samples.
- Two blind human reviewers use the same frozen eight-dimension anchors; disagreement goes to a third reviewer.
- Model runs cannot see human labels, earlier model results or appeal wording.
- Acceptance on holdout: exact-grade accuracy at least 80%; error of two or more grade levels no more than 5%.

## Audit material

For every run retain file hash, immutable metadata snapshot, media manifest/hash, model configuration snapshot, all version identifiers, run/group/decision IDs, raw provider response, validated facts/evidence/anchors, backend score and adopted pointer. Reports must not contain credentials, reusable signed URLs or cross-owner data.
