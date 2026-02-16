# Reference Matching Benchmark Runbook

## 1) Prepare benchmark claims
- Copy `docs/benchmarks/reference-matching-claims.template.json` to `docs/benchmarks/reference-matching-claims.json`.
- Replace claim text with a fixed benchmark set.
- For recall metrics, include `expected_reference_id` or `expected_reference_alias` per claim.

## 2) Start backend
```bash
cd ../backend
npm run dev
```

## 3) Run passage-search benchmark
```bash
cd ../backend
npm run benchmark:passages -- \
  --claims-file ../app/docs/benchmarks/reference-matching-claims.json \
  --spawn-local \
  --top-k 20 \
  --candidate-pool 40 \
  --warmup 5 \
  --iterations 2 \
  --scorecard ../app/docs/benchmarks/reference-matching-scorecard.md \
  --label "post-pr4-pr6"
```

Notes:
- If claims do not include `brand_id`, add `--brand-id <id>`.
- You can use `--brand-name "<exact brand name>"` instead of `--brand-id`.
- If you want to benchmark an already-running backend, remove `--spawn-local` and optionally pass `--server-url`.
- To compare tuning runs, vary `--top-k` / `--candidate-pool` and use a new `--label`.

## 4) Optional: estimate re-embedding impact before changes
```bash
cd ../backend
npm run embed:references -- --dry-run --brand-id 1 --chunk-size 1800 --chunk-overlap 300
```

## 5) Thresholds for readiness
- Backend retrieval p95 (`/passages/search`) <= 300ms on local benchmark.
- Recall@5 >= 85%, Recall@20 >= 95% on labeled claims.
- Failure count = 0 for benchmark run.

## 6) Recommended manual test gate
Run `/mkg2` manual UI verification only after:
1. benchmark run has stable p95 and zero failures, and
2. recall metrics meet threshold (or are clearly improved vs baseline).
