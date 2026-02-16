import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import process from 'process'
import { performance } from 'perf_hooks'
import { initDb, closeDb } from '../src/config/database.js'
import { createApp } from '../src/app.js'

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0
  const index = Math.max(0, Math.ceil(sortedValues.length * p) - 1)
  return sortedValues[index]
}

function average(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normalizeAlias(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function printUsage() {
  console.log(`Usage:
  node scripts/benchmark-passages-search.js \\
    --claims-file ../app/docs/benchmarks/reference-matching-claims.json \\
    --brand-id 1 --spawn-local \\
    --top-k 20 \\
    --candidate-pool 40 \\
    --warmup 5 \\
    --iterations 2 \\
    --scorecard ../app/docs/benchmarks/reference-matching-scorecard.md \\
    --label "pr4-pr6"

Options:
  --claims-file      JSON file with benchmark claims (required)
  --brand-id         Default brand id for claims without brand_id
  --brand-name       Default brand name for claims without brand_id
  --server-url       Backend URL (default: http://localhost:$PORT)
  --spawn-local      Start a temporary local backend server for this benchmark run
  --local-port       Port for --spawn-local (default: 3901)
  --top-k            Response size top_k (default: 20)
  --candidate-pool   Internal retrieval depth (default: 40)
  --warmup           Warmup request count (default: 5)
  --iterations       Full dataset repetitions (default: 1)
  --timeout-ms       Per-request timeout (default: 60000)
  --scorecard        Optional markdown scorecard file to append row
  --label            Optional run label for scorecard row
  --help             Show this help
`)
}

function parseArgs() {
  const args = process.argv.slice(2)
  const flags = {
    claimsFile: null,
    brandId: null,
    brandName: null,
    serverUrl: `http://localhost:${process.env.PORT || 3001}`,
    spawnLocal: false,
    localPort: 3901,
    topK: 20,
    candidatePool: 40,
    warmup: 5,
    iterations: 1,
    timeoutMs: 60000,
    scorecard: null,
    label: null
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help') {
      printUsage()
      process.exit(0)
    }
    if (arg === '--claims-file' && args[i + 1]) flags.claimsFile = args[++i]
    if (arg === '--brand-id' && args[i + 1]) flags.brandId = parsePositiveInt(args[++i], null)
    if (arg === '--brand-name' && args[i + 1]) flags.brandName = args[++i]
    if (arg === '--server-url' && args[i + 1]) flags.serverUrl = args[++i]
    if (arg === '--spawn-local') flags.spawnLocal = true
    if (arg === '--local-port' && args[i + 1]) flags.localPort = parsePositiveInt(args[++i], 3901)
    if (arg === '--top-k' && args[i + 1]) flags.topK = parsePositiveInt(args[++i], 20)
    if (arg === '--candidate-pool' && args[i + 1]) flags.candidatePool = parsePositiveInt(args[++i], 40)
    if (arg === '--warmup' && args[i + 1]) flags.warmup = parsePositiveInt(args[++i], 5)
    if (arg === '--iterations' && args[i + 1]) flags.iterations = parsePositiveInt(args[++i], 1)
    if (arg === '--timeout-ms' && args[i + 1]) flags.timeoutMs = parsePositiveInt(args[++i], 60000)
    if (arg === '--scorecard' && args[i + 1]) flags.scorecard = args[++i]
    if (arg === '--label' && args[i + 1]) flags.label = args[++i]
  }

  if (!flags.claimsFile) {
    throw new Error('--claims-file is required')
  }

  flags.candidatePool = Math.max(flags.candidatePool, flags.topK)
  return flags
}

function normalizeClaims(raw, defaultBrandId) {
  const claimsArray = Array.isArray(raw) ? raw : raw?.claims
  if (!Array.isArray(claimsArray) || claimsArray.length === 0) {
    throw new Error('Claims file must contain a non-empty array or { "claims": [...] }')
  }

  return claimsArray.map((entry, idx) => {
    if (typeof entry === 'string') {
      return {
        id: `claim-${idx + 1}`,
        claimText: entry,
        brandId: defaultBrandId || null,
        expectedReferenceId: null,
        expectedAlias: null
      }
    }

    const claimText = entry.claim_text || entry.claimText || entry.text
    if (!claimText || !String(claimText).trim()) {
      throw new Error(`Claim at index ${idx} is missing claim_text`)
    }

    return {
      id: entry.id || `claim-${idx + 1}`,
      claimText: String(claimText).trim(),
      brandId: parsePositiveInt(entry.brand_id || entry.brandId, defaultBrandId),
      expectedReferenceId: parsePositiveInt(entry.expected_reference_id || entry.expectedReferenceId, null),
      expectedAlias: entry.expected_alias || entry.expectedAlias || entry.expected_display_alias || null
    }
  })
}

function loadBenchmarkClaims(filePath, defaultBrandId) {
  const resolvedPath = path.resolve(process.cwd(), filePath)
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Claims file not found: ${resolvedPath}`)
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'))
  const claims = normalizeClaims(raw, defaultBrandId)
  claims.forEach((claim, index) => {
    if (!claim.brandId) {
      throw new Error(`Claim ${claim.id || index} is missing brand_id and no --brand-id was provided`)
    }
  })

  return {
    datasetName: raw?.dataset_name || path.basename(resolvedPath),
    claimsFilePath: resolvedPath,
    claims
  }
}

async function runSearchRequest(claim, flags) {
  const endpoint = `${flags.serverUrl}/api/brands/${claim.brandId}/passages/search`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), flags.timeoutMs)
  const requestBody = {
    claim_text: claim.claimText,
    top_k: flags.topK,
    candidate_pool: flags.candidatePool
  }

  const started = performance.now()
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    })
    const durationMs = performance.now() - started
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${data.error || response.statusText}`)
    }

    return {
      ok: true,
      durationMs,
      count: data.count || 0,
      results: Array.isArray(data.results) ? data.results : []
    }
  } catch (err) {
    const durationMs = performance.now() - started
    return {
      ok: false,
      durationMs,
      error: err.message
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function resolveBrandIdFromName(flags) {
  if (!flags.brandName) return flags.brandId
  const response = await fetch(`${flags.serverUrl}/api/brands`)
  if (!response.ok) {
    throw new Error(`Unable to resolve --brand-name. HTTP ${response.status} from /api/brands`)
  }

  const data = await response.json()
  const brands = Array.isArray(data.brands) ? data.brands : []
  const target = normalizeAlias(flags.brandName)
  const matched = brands.find(brand => normalizeAlias(brand.name) === target)

  if (!matched) {
    const names = brands.map(brand => brand.name).join(', ')
    throw new Error(`Brand "${flags.brandName}" not found. Available brands: ${names || '(none)'}`)
  }

  return Number(matched.id)
}

function checkExpectedHit(results, claim, k) {
  const topResults = results.slice(0, k)
  if (claim.expectedReferenceId) {
    return topResults.some(result => Number(result.reference_id) === Number(claim.expectedReferenceId))
  }
  if (claim.expectedAlias) {
    const expected = normalizeAlias(claim.expectedAlias)
    return topResults.some(result => normalizeAlias(result.display_alias) === expected)
  }
  return null
}

function buildSummary(runContext, responses, flags) {
  const successful = responses.filter(item => item.response.ok)
  const failed = responses.length - successful.length
  const durations = successful.map(item => item.response.durationMs).sort((a, b) => a - b)
  const counts = successful.map(item => item.response.count)

  let expectedTotal = 0
  let recallAt1Hits = 0
  let recallAt5Hits = 0
  let recallAt20Hits = 0

  successful.forEach(({ claim, response }) => {
    const hasExpected = Boolean(claim.expectedReferenceId || claim.expectedAlias)
    if (!hasExpected) return
    expectedTotal++

    const hitAt1 = checkExpectedHit(response.results, claim, 1)
    const hitAt5 = checkExpectedHit(response.results, claim, Math.min(5, flags.topK))
    const hitAt20 = checkExpectedHit(response.results, claim, Math.min(20, flags.topK))

    if (hitAt1) recallAt1Hits++
    if (hitAt5) recallAt5Hits++
    if (hitAt20) recallAt20Hits++
  })

  return {
    dataset_name: runContext.datasetName,
    claims_file: runContext.claimsFilePath,
    server_url: flags.serverUrl,
    top_k: flags.topK,
    candidate_pool: flags.candidatePool,
    warmup: flags.warmup,
    iterations: flags.iterations,
    total_requests: responses.length,
    successful_requests: successful.length,
    failed_requests: failed,
    latency_ms: {
      min: durations.length ? percentile(durations, 0.01) : 0,
      p50: percentile(durations, 0.50),
      p90: percentile(durations, 0.90),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
      max: durations.length ? durations[durations.length - 1] : 0,
      avg: average(durations)
    },
    result_count: {
      min: counts.length ? Math.min(...counts) : 0,
      max: counts.length ? Math.max(...counts) : 0,
      avg: average(counts)
    },
    expected_claims: expectedTotal,
    recall: {
      at1: expectedTotal > 0 ? recallAt1Hits / expectedTotal : null,
      at5: expectedTotal > 0 ? recallAt5Hits / expectedTotal : null,
      at20: expectedTotal > 0 ? recallAt20Hits / expectedTotal : null
    },
    generated_at: new Date().toISOString()
  }
}

function formatPercent(value) {
  if (value === null || value === undefined) return 'n/a'
  return `${(value * 100).toFixed(1)}%`
}

function formatMs(value) {
  return `${Number(value || 0).toFixed(1)}ms`
}

function printSummary(summary) {
  console.log('\n=== Passage Search Benchmark Summary ===')
  console.log(`Dataset: ${summary.dataset_name}`)
  console.log(`Claims File: ${summary.claims_file}`)
  console.log(`Server: ${summary.server_url}`)
  console.log(`Requests: ${summary.successful_requests}/${summary.total_requests} successful`)
  console.log(`top_k=${summary.top_k}, candidate_pool=${summary.candidate_pool}, warmup=${summary.warmup}, iterations=${summary.iterations}`)
  console.log(`Latency: avg ${formatMs(summary.latency_ms.avg)} | p50 ${formatMs(summary.latency_ms.p50)} | p95 ${formatMs(summary.latency_ms.p95)} | p99 ${formatMs(summary.latency_ms.p99)} | max ${formatMs(summary.latency_ms.max)}`)
  console.log(`Result count: avg ${summary.result_count.avg.toFixed(1)} | min ${summary.result_count.min} | max ${summary.result_count.max}`)
  if (summary.expected_claims > 0) {
    console.log(`Recall: @1 ${formatPercent(summary.recall.at1)} | @5 ${formatPercent(summary.recall.at5)} | @20 ${formatPercent(summary.recall.at20)} (${summary.expected_claims} labeled claims)`)
  } else {
    console.log('Recall: n/a (no expected reference labels provided)')
  }
}

function ensureScorecardHeader(filePath) {
  if (fs.existsSync(filePath)) return
  const header = [
    '# Reference Matching Benchmark Scorecard',
    '',
    '| Date (UTC) | Label | Dataset | Requests | Failures | p50 ms | p95 ms | p99 ms | Avg ms | Recall@5 | Recall@20 | TopK | CandidatePool | Iterations |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
  ].join('\n')
  fs.writeFileSync(filePath, `${header}\n`)
}

function appendScorecardRow(filePath, summary, label = '') {
  ensureScorecardHeader(filePath)
  const row = [
    summary.generated_at,
    label || '',
    summary.dataset_name,
    summary.total_requests,
    summary.failed_requests,
    summary.latency_ms.p50.toFixed(1),
    summary.latency_ms.p95.toFixed(1),
    summary.latency_ms.p99.toFixed(1),
    summary.latency_ms.avg.toFixed(1),
    summary.recall.at5 !== null ? (summary.recall.at5 * 100).toFixed(1) : 'n/a',
    summary.recall.at20 !== null ? (summary.recall.at20 * 100).toFixed(1) : 'n/a',
    summary.top_k,
    summary.candidate_pool,
    summary.iterations
  ]
  fs.appendFileSync(filePath, `| ${row.join(' | ')} |\n`)
}

async function main() {
  const flags = parseArgs()
  let server = null

  if (flags.spawnLocal) {
    initDb()
    const app = createApp()
    await new Promise((resolve) => {
      server = app.listen(flags.localPort, () => resolve())
    })
    flags.serverUrl = `http://localhost:${flags.localPort}`
    console.log(`Spawned local backend on ${flags.serverUrl}`)
  }

  try {
    const resolvedBrandId = await resolveBrandIdFromName(flags)
    const runContext = loadBenchmarkClaims(flags.claimsFile, resolvedBrandId)
    const { claims } = runContext

    console.log('=== Passage Search Benchmark ===')
    console.log(`Claims: ${claims.length}, warmup=${flags.warmup}, iterations=${flags.iterations}`)
    console.log(`Server: ${flags.serverUrl}`)
    if (flags.brandName) {
      console.log(`Resolved --brand-name "${flags.brandName}" => brand_id=${resolvedBrandId}`)
    }
    console.log(`top_k=${flags.topK}, candidate_pool=${flags.candidatePool}\n`)

    // Warmup requests are excluded from measured metrics.
    for (let i = 0; i < flags.warmup; i++) {
      const claim = claims[i % claims.length]
      const result = await runSearchRequest(claim, flags)
      const status = result.ok ? 'ok' : `error (${result.error})`
      console.log(`[warmup ${i + 1}/${flags.warmup}] ${claim.id}: ${status}`)
    }

    const responses = []
    const totalRuns = claims.length * flags.iterations
    let runIndex = 0

    for (let iteration = 0; iteration < flags.iterations; iteration++) {
      for (const claim of claims) {
        runIndex++
        const response = await runSearchRequest(claim, flags)
        responses.push({ claim, response })
        const status = response.ok
          ? `ok ${response.durationMs.toFixed(1)}ms (${response.count} results)`
          : `error ${response.durationMs.toFixed(1)}ms (${response.error})`
        console.log(`[${runIndex}/${totalRuns}] ${claim.id}: ${status}`)
      }
    }

    const summary = buildSummary(runContext, responses, flags)
    printSummary(summary)

    if (flags.scorecard) {
      const scorecardPath = path.resolve(process.cwd(), flags.scorecard)
      appendScorecardRow(scorecardPath, summary, flags.label)
      console.log(`Scorecard updated: ${scorecardPath}`)
    }

    if (summary.successful_requests === 0) {
      process.exitCode = 1
    }
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()))
      closeDb()
    }
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err.message)
  process.exit(1)
})
