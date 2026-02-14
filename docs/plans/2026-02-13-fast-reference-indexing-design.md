# Fast Reference Indexing Design

**Date:** 2026-02-13
**Status:** Approved
**Problem:** Batch indexing 40 reference documents takes ~3 hours (sequential, gemini-2.5-flash thinking model)
**Target:** Under 15 minutes for 40 docs
**Expected result:** ~2-3 minutes for 40 docs

## Root Cause

`gemini-2.5-flash` is a "thinking" model that generates internal chain-of-thought reasoning before producing output. For structured JSON extraction from text, this thinking overhead adds no value and accounts for ~90% of the processing time (~4.5 min/doc).

## Solution: Model Switch + Parallel Processing

### Change 1: Model Switch

Switch from `gemini-2.5-flash` to `gemini-2.0-flash`.

- 2.0-flash handles structured extraction tasks well without thinking overhead
- Expected per-doc time: ~30-45s (down from ~4.5 min)
- Quality validation: Run 5 docs through both models, compare fact counts and quality before shipping. If 2.0-flash is comparable (within ~10%), keep it. Fallback: disable thinking on 2.5-flash via `thinkingConfig`.

### Change 2: Parallel Processing

Replace sequential `for` loop with concurrency-limited parallel execution.

- Add `p-limit` npm package for concurrency control
- Default concurrency: **10** (paid Gemini API tier supports 1000+ RPM)
- Add `--concurrency <n>` flag to batch script for tuning
- Each reference still processes its chunks sequentially; different references process in parallel
- Remove the 1-second delay between requests (p-limit handles flow control)
- Add retry with exponential backoff on 429 rate limit errors (2s → 4s → 8s)

### Math

- Model switch: ~4.5 min/doc → ~30-45s/doc
- Parallelism (10 concurrent): 40 docs / 10 = 4 rounds * ~40s = ~2-3 minutes total

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/factExtractor.js` | Default model `gemini-2.5-flash` → `gemini-2.0-flash` |
| `backend/scripts/index-references.js` | Sequential → `p-limit` parallel (default 10), `--concurrency` flag, 429 retry with backoff, remove 1s delay |
| `backend/package.json` | Add `p-limit` dependency |

## What Stays the Same

- Extraction prompt (no changes)
- Chunking logic (24K chars per chunk, sequential within a doc)
- DB schema (no changes)
- Auto-index on upload (benefits from model switch automatically)
- Frontend (no changes)
- Existing indexed facts (no re-run needed)
