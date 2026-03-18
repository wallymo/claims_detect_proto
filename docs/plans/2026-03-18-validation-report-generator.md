# Validation Report Generator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generate a side-by-side HTML report comparing PyMuPDF raw extraction against exact frontend transform output, per page, flagging every gap.

**Architecture:** Single Node.js ESM script that runs `pymupdf_poc.py` via child_process, imports the real frontend transform dependencies (`citationLibraryMatcher.js`, `textMatcher.js`/`addGlobalIndices`), copies the exact `transformPyMuPDFResults` logic from `MKG3ClaimsDetector.jsx`, compares raw vs transformed per page, and generates a self-contained HTML file.

**Tech Stack:** Node.js ESM, child_process.execFile, direct imports from `app/src/utils/`

---

### Task 1: Create the script scaffold with CLI arg parsing and PyMuPDF execution

**Files:**
- Create: `scripts/generate-validation-report.mjs`

**Step 1: Write the script scaffold**

```javascript
#!/usr/bin/env node
/**
 * Validation Report Generator
 *
 * Compares PyMuPDF raw extraction output against the exact frontend
 * transform (transformPyMuPDFResults + addGlobalIndices) to surface
 * gaps in superscript → reference resolution.
 *
 * Usage:
 *   node scripts/generate-validation-report.mjs <pdf_path> [--output report.html]
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Real frontend deps — pure JS, no browser APIs
import { matchCitationToLibrary } from '../app/src/utils/citationLibraryMatcher.js'
import { addGlobalIndices } from '../app/src/utils/textMatcher.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

// Embed Hedgehox logo as base64 for self-contained HTML
const LOGO_PATH = resolve(__dirname, '..', 'assets', 'hedgehox-logo.png')
let logoBase64 = ''
try { logoBase64 = readFileSync(LOGO_PATH, 'base64') } catch { /* logo optional */ }

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const pdfPath = args.find(a => !a.startsWith('--'))
const outputFlag = args.indexOf('--output')
const outputPath = outputFlag !== -1 ? args[outputFlag + 1] : null

if (!pdfPath) {
  console.error('Usage: node scripts/generate-validation-report.mjs <pdf_path> [--output report.html]')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. Run PyMuPDF extraction
// ---------------------------------------------------------------------------

async function runPyMuPDF(pdf) {
  const pythonPath = resolve(__dirname, '.venv/bin/python3')
  const scriptPath = resolve(__dirname, 'pymupdf_poc.py')
  const { stdout } = await execFileAsync(pythonPath, [scriptPath, pdf, '--pretty'], {
    maxBuffer: 10 * 1024 * 1024 // 10MB
  })
  return JSON.parse(stdout)
}
```

**Step 2: Verify the script runs and can call PyMuPDF**

Add a temporary main block:

```javascript
const rawData = await runPyMuPDF(resolve(pdfPath))
console.log(`PyMuPDF extracted ${rawData.total_pages} pages, ${rawData.pages.length} with data`)
```

Run:
```bash
node scripts/generate-validation-report.mjs "MKG Knowledge Base/Test Doc/Marissa_SYN slides for AI testing_V3_no annos.pdf"
```

Expected: `PyMuPDF extracted 31 pages, 31 with data`

**Step 3: Commit**

```bash
git add scripts/generate-validation-report.mjs
git commit -m "feat: validation report scaffold with PyMuPDF runner"
```

---

### Task 2: Add the exact `transformPyMuPDFResults` function (copied verbatim from JSX)

**Files:**
- Modify: `scripts/generate-validation-report.mjs`

**Step 1: Copy the exact transform from `app/src/pages/MKG3ClaimsDetector.jsx` lines 177-237**

Add this function to the script, verbatim. The only change: reference library matching is skipped (empty array) since we're validating superscript→reference resolution, not citation→library linking.

```javascript
// ---------------------------------------------------------------------------
// 2. Exact frontend transform (from MKG3ClaimsDetector.jsx lines 177-237)
// ---------------------------------------------------------------------------

function transformPyMuPDFResults(data, referenceDocuments = []) {
  const annotations = []
  if (!data?.pages) return annotations
  const matchRef = (text) => {
    if (!referenceDocuments.length) return null
    const matched = matchCitationToLibrary(text, referenceDocuments)
    return matched ? matched.id : null
  }
  for (const page of data.pages) {
    const mapClaim = (claim, idx, region, prefix) => ({
      id: `pymupdf-${prefix}-${page.page}-${idx}`,
      text: claim.text,
      claim: claim.text,
      statement: claim.text,
      region,
      refNumbers: claim.superscripts || [],
      superscripts: claim.superscripts || [],
      references: (claim.references || []).map(r => ({ number: r.number, text: r.text, missing: false, id: matchRef(r.text) })),
      source: 'pymupdf',
      matched: (claim.references || []).length > 0,
      matchTier: 'on-page',
      confidence: 100,
      page: page.page,
      position: claim.position || null,
      globalSpot: false,
      status: 'pending',
    })
    for (const [idx, claim] of (page.slide_claims || []).entries()) {
      annotations.push(mapClaim(claim, idx, 'slide', 's'))
    }
    for (const [idx, claim] of (page.notes_claims || []).entries()) {
      annotations.push(mapClaim(claim, idx, 'notes', 'n'))
    }
    for (const [idx, g] of (page.global_annotations || []).entries()) {
      const region = (g.global_reason || '').includes('slide') ? 'slide' : 'notes'
      annotations.push({
        id: `pymupdf-g-${page.page}-${idx}`,
        text: g.text,
        claim: g.text,
        statement: g.text,
        region,
        refNumbers: g.superscripts || [],
        superscripts: g.superscripts || [],
        references: (g.references || []).map(r => ({ number: r.number, text: r.text, missing: false, id: matchRef(r.text) })),
        source: 'pymupdf',
        matched: true,
        matchTier: 'on-page',
        confidence: 100,
        page: page.page,
        position: g.position || null,
        globalSpot: true,
        globalReason: g.global_reason || 'orphan-page-reference',
        status: 'pending',
      })
    }
  }
  return annotations
}
```

**Step 2: Wire up the transform and verify annotation count**

```javascript
const rawData = await runPyMuPDF(resolve(pdfPath))
const annotations = addGlobalIndices(transformPyMuPDFResults(rawData))
console.log(`Raw pages: ${rawData.pages.length}, Frontend annotations: ${annotations.length}`)
```

Run:
```bash
node scripts/generate-validation-report.mjs "MKG Knowledge Base/Test Doc/Marissa_SYN slides for AI testing_V3_no annos.pdf"
```

Expected: prints page count and annotation count without errors.

**Step 3: Commit**

```bash
git add scripts/generate-validation-report.mjs
git commit -m "feat: add exact transformPyMuPDFResults from frontend"
```

---

### Task 3: Build the per-page comparison engine

**Files:**
- Modify: `scripts/generate-validation-report.mjs`

**Step 1: Write the comparison function**

This function takes a raw page object and the frontend annotations for that page, and produces a structured diff:

```javascript
// ---------------------------------------------------------------------------
// 3. Per-page comparison
// ---------------------------------------------------------------------------

function comparePage(rawPage, frontendAnnotations) {
  const pageNum = rawPage.page

  // --- RAW side ---
  const rawSlideClaims = rawPage.slide_claims || []
  const rawNotesClaims = rawPage.notes_claims || []
  const rawGlobals = rawPage.global_annotations || []
  const rawUnresolved = rawPage.unresolved_superscripts || []
  const rawSlideFootnotes = rawPage.slide_footnotes || {}
  const rawNotesRefs = rawPage.notes_references || {}

  const rawTotalSups = [...rawSlideClaims, ...rawNotesClaims].reduce(
    (sum, c) => sum + (c.superscripts?.length || 0), 0
  )
  const rawResolvedRefs = [...rawSlideClaims, ...rawNotesClaims].reduce(
    (sum, c) => sum + (c.references?.length || 0), 0
  )
  const rawMissing = rawTotalSups - rawResolvedRefs

  // --- FRONTEND side ---
  const feAnnotations = frontendAnnotations.filter(a => a.page === pageNum)
  const feRegular = feAnnotations.filter(a => !a.globalSpot)
  const feGlobals = feAnnotations.filter(a => a.globalSpot)
  const feMatched = feRegular.filter(a => a.matched)
  const feUnmatched = feRegular.filter(a => !a.matched)

  const feTotalSups = feRegular.reduce((sum, a) => sum + (a.superscripts?.length || 0), 0)
  const feResolvedRefs = feRegular.reduce((sum, a) => sum + a.references.length, 0)

  // --- GAPS ---
  const gaps = []

  // Unresolved superscripts (in raw but no annotation ref in frontend)
  for (const u of rawUnresolved) {
    gaps.push({
      type: 'unresolved-superscript',
      region: u.region,
      superscript: u.superscript,
      claimText: u.claim_text,
    })
  }

  // Claims where some superscripts resolved but others didn't
  for (const claim of [...rawSlideClaims, ...rawNotesClaims]) {
    const resolvedNums = new Set((claim.references || []).map(r => r.number))
    for (const sup of (claim.superscripts || [])) {
      if (!resolvedNums.has(sup)) {
        // Only add if not already in unresolved list
        const alreadyLogged = gaps.some(g =>
          g.type === 'unresolved-superscript' && g.superscript === sup
        )
        if (!alreadyLogged) {
          gaps.push({
            type: 'partial-resolution',
            superscript: sup,
            claimText: (claim.text || '').slice(0, 60),
          })
        }
      }
    }
  }

  // Frontend annotations with matched:false
  for (const a of feUnmatched) {
    gaps.push({
      type: 'frontend-unmatched',
      id: a.id,
      text: (a.text || '').slice(0, 60),
      superscripts: a.superscripts,
    })
  }

  // Determine page status
  const isPass = rawMissing === 0 && rawUnresolved.length === 0 && feUnmatched.length === 0

  return {
    page: pageNum,
    raw: {
      slideClaims: rawSlideClaims,
      notesClaims: rawNotesClaims,
      globals: rawGlobals,
      unresolved: rawUnresolved,
      slideFootnotes: rawSlideFootnotes,
      notesRefs: rawNotesRefs,
      totalSups: rawTotalSups,
      resolvedRefs: rawResolvedRefs,
      missing: rawMissing,
    },
    frontend: {
      annotations: feAnnotations,
      regular: feRegular,
      globals: feGlobals,
      matched: feMatched,
      unmatched: feUnmatched,
      totalSups: feTotalSups,
      resolvedRefs: feResolvedRefs,
    },
    gaps,
    pass: isPass,
  }
}
```

**Step 2: Wire it up and print summary**

```javascript
const rawData = await runPyMuPDF(resolve(pdfPath))
const annotations = addGlobalIndices(transformPyMuPDFResults(rawData))

const comparisons = rawData.pages.map(p => comparePage(p, annotations))
const passCount = comparisons.filter(c => c.pass).length
const failCount = comparisons.filter(c => !c.pass).length
console.log(`Pages: ${comparisons.length} | Pass: ${passCount} | Fail: ${failCount}`)
for (const c of comparisons.filter(c => !c.pass)) {
  console.log(`  Page ${c.page}: ${c.gaps.length} gaps`)
}
```

Run:
```bash
node scripts/generate-validation-report.mjs "MKG Knowledge Base/Test Doc/Marissa_SYN slides for AI testing_V3_no annos.pdf"
```

Expected: summary showing pass/fail per page with gap counts.

**Step 3: Commit**

```bash
git add scripts/generate-validation-report.mjs
git commit -m "feat: per-page comparison engine for raw vs frontend"
```

---

### Task 4: Generate the HTML report

**Files:**
- Modify: `scripts/generate-validation-report.mjs`

**Step 1: Write the HTML generator**

The HTML is a self-contained file with inline CSS. 5-column table: Page | Raw Extraction | Frontend Annotations | What's Missing | Status.

```javascript
// ---------------------------------------------------------------------------
// 4. HTML report generator
// ---------------------------------------------------------------------------

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderClaim(claim, label) {
  const sups = (claim.superscripts || []).join(', ')
  const refs = (claim.references || []).map(r =>
    `<span class="ref-num">${r.number}</span> ${escapeHtml(r.text).slice(0, 80)}…`
  ).join('<br>')
  const unresolvedSups = (claim.superscripts || []).filter(
    s => !(claim.references || []).some(r => r.number === s)
  )
  const missTag = unresolvedSups.length > 0
    ? `<span class="miss">missing: ${unresolvedSups.join(', ')}</span>`
    : ''
  return `
    <div class="claim ${unresolvedSups.length > 0 ? 'claim-partial' : ''}">
      <div class="claim-label">${label}</div>
      <div class="claim-text">${escapeHtml(claim.text).slice(0, 120)}${claim.text.length > 120 ? '…' : ''}</div>
      <div class="claim-sups">Superscripts: [${sups}] ${missTag}</div>
      ${refs ? `<div class="claim-refs">${refs}</div>` : ''}
    </div>
  `
}

function renderAnnotation(ann) {
  const sups = (ann.superscripts || []).join(', ')
  const matchStatus = ann.matched
    ? '<span class="tag-match">matched</span>'
    : '<span class="tag-nomatch">unmatched</span>'
  const globalTag = ann.globalSpot ? '<span class="tag-global">global</span>' : ''
  const refs = ann.references.map(r =>
    `<span class="ref-num">${r.number}</span> ${escapeHtml(r.text).slice(0, 80)}…`
  ).join('<br>')
  return `
    <div class="annotation ${ann.matched ? '' : 'ann-unmatched'}">
      <div class="ann-id">${ann.id} ${matchStatus} ${globalTag}</div>
      <div class="ann-text">${escapeHtml(ann.text).slice(0, 120)}${ann.text.length > 120 ? '…' : ''}</div>
      <div class="ann-sups">[${sups}] → ${ann.references.length} refs</div>
      ${refs ? `<div class="ann-refs">${refs}</div>` : ''}
    </div>
  `
}

function renderGaps(gaps) {
  if (gaps.length === 0) return '<span class="no-gaps">None</span>'
  return gaps.map(g => {
    switch (g.type) {
      case 'unresolved-superscript':
        return `<div class="gap gap-unresolved">Superscript <strong>${g.superscript}</strong> unresolved in ${g.region}<br><small>${escapeHtml(g.claimText)}</small></div>`
      case 'partial-resolution':
        return `<div class="gap gap-partial">Superscript <strong>${g.superscript}</strong> not in ref pool<br><small>${escapeHtml(g.claimText)}</small></div>`
      case 'frontend-unmatched':
        return `<div class="gap gap-fe-unmatched">Frontend card unmatched: ${escapeHtml(g.text)}<br><small>sups: [${g.superscripts.join(', ')}]</small></div>`
      default:
        return `<div class="gap">${escapeHtml(JSON.stringify(g))}</div>`
    }
  }).join('')
}

function generateHTML(comparisons, fileName) {
  const passCount = comparisons.filter(c => c.pass).length
  const failCount = comparisons.filter(c => !c.pass).length
  const totalGaps = comparisons.reduce((sum, c) => sum + c.gaps.length, 0)
  const totalRawSups = comparisons.reduce((sum, c) => sum + c.raw.totalSups, 0)
  const totalRawResolved = comparisons.reduce((sum, c) => sum + c.raw.resolvedRefs, 0)
  const resolutionRate = totalRawSups > 0 ? ((totalRawResolved / totalRawSups) * 100).toFixed(1) : 'N/A'
  const now = new Date().toISOString().split('T')[0]

  const rows = comparisons.map(c => {
    const statusIcon = c.pass ? '✓' : '✗'
    const statusClass = c.pass ? 'status-pass' : 'status-fail'
    const rowClass = c.pass ? 'row-pass' : 'row-fail'

    // Raw column
    const rawSlide = c.raw.slideClaims.map(cl => renderClaim(cl, 'slide')).join('')
    const rawNotes = c.raw.notesClaims.map(cl => renderClaim(cl, 'notes')).join('')
    const rawGlobals = c.raw.globals.map(g => renderClaim(g, 'global')).join('')
    const poolSlide = Object.entries(c.raw.slideFootnotes).map(([k, v]) =>
      `<span class="ref-num">${k}</span> ${escapeHtml(v).slice(0, 60)}…`
    ).join('<br>')
    const poolNotes = Object.entries(c.raw.notesRefs).map(([k, v]) =>
      `<span class="ref-num">${k}</span> ${escapeHtml(v).slice(0, 60)}…`
    ).join('<br>')

    const hasContent = c.raw.slideClaims.length > 0 || c.raw.notesClaims.length > 0
      || c.raw.globals.length > 0

    const rawCell = hasContent ? `
      ${rawSlide}${rawNotes}${rawGlobals}
      ${poolSlide ? `<details><summary class="pool-toggle">Slide footnotes (${Object.keys(c.raw.slideFootnotes).length})</summary><div class="pool">${poolSlide}</div></details>` : ''}
      ${poolNotes ? `<details><summary class="pool-toggle">Notes refs (${Object.keys(c.raw.notesRefs).length})</summary><div class="pool">${poolNotes}</div></details>` : ''}
      <div class="raw-stats">${c.raw.totalSups} sups → ${c.raw.resolvedRefs} resolved, ${c.raw.missing} missing</div>
    ` : '<span class="empty">No claims</span>'

    // Frontend column
    const feCell = c.frontend.annotations.length > 0
      ? c.frontend.annotations.map(a => renderAnnotation(a)).join('')
        + `<div class="fe-stats">${c.frontend.regular.length} cards (${c.frontend.matched.length} matched, ${c.frontend.unmatched.length} unmatched) + ${c.frontend.globals.length} global</div>`
      : '<span class="empty">No annotations</span>'

    // Gaps column
    const gapsCell = renderGaps(c.gaps)

    return `
      <tr class="${rowClass}">
        <td class="col-page">${c.page}</td>
        <td class="col-raw">${rawCell}</td>
        <td class="col-fe">${feCell}</td>
        <td class="col-gaps">${gapsCell}</td>
        <td class="col-status ${statusClass}">${statusIcon}</td>
      </tr>
    `
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Validation Report — ${escapeHtml(fileName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f9fa; color: #1a1a2e; padding: 24px; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
  .meta { color: #666; margin-bottom: 16px; }
  .summary { display: flex; gap: 24px; margin-bottom: 24px; padding: 16px; background: #fff; border-radius: 8px; border: 1px solid #e0e0e0; }
  .stat { text-align: center; }
  .stat-value { font-size: 28px; font-weight: 700; }
  .stat-value.pass { color: #16a34a; }
  .stat-value.fail { color: #dc2626; }
  .stat-value.neutral { color: #2563eb; }
  .stat-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0; }
  thead { background: #1a1a2e; color: #fff; }
  th { padding: 10px 12px; text-align: left; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  .col-page { width: 50px; text-align: center; font-weight: 700; font-size: 16px; }
  .col-raw { width: 35%; }
  .col-fe { width: 30%; }
  .col-gaps { width: 20%; }
  .col-status { width: 50px; text-align: center; font-size: 22px; font-weight: 700; }
  .status-pass { color: #16a34a; }
  .status-fail { color: #dc2626; }
  .row-pass { }
  .row-fail { background: #fef2f2; }
  .claim { margin-bottom: 8px; padding: 6px 8px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #2563eb; }
  .claim-partial { border-left-color: #f59e0b; }
  .claim-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #666; }
  .claim-text { font-size: 12px; margin: 2px 0; }
  .claim-sups { font-size: 11px; color: #555; }
  .claim-refs { font-size: 11px; color: #777; margin-top: 2px; }
  .ref-num { display: inline-block; background: #e0e7ff; color: #3730a3; border-radius: 3px; padding: 0 4px; font-weight: 600; font-size: 10px; min-width: 16px; text-align: center; }
  .miss { color: #dc2626; font-weight: 600; }
  .annotation { margin-bottom: 8px; padding: 6px 8px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #16a34a; }
  .ann-unmatched { border-left-color: #dc2626; }
  .ann-id { font-size: 10px; color: #888; }
  .ann-text { font-size: 12px; margin: 2px 0; }
  .ann-sups { font-size: 11px; color: #555; }
  .ann-refs { font-size: 11px; color: #777; margin-top: 2px; }
  .tag-match { background: #dcfce7; color: #166534; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .tag-nomatch { background: #fee2e2; color: #991b1b; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .tag-global { background: #e0e7ff; color: #3730a3; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .gap { margin-bottom: 6px; padding: 4px 6px; border-radius: 4px; font-size: 12px; }
  .gap-unresolved { background: #fee2e2; color: #991b1b; }
  .gap-partial { background: #fef3c7; color: #92400e; }
  .gap-fe-unmatched { background: #fce7f3; color: #9d174d; }
  .no-gaps { color: #16a34a; font-weight: 600; }
  .empty { color: #aaa; font-style: italic; }
  .pool-toggle { cursor: pointer; font-size: 11px; color: #2563eb; margin-top: 4px; }
  .pool { font-size: 11px; color: #777; margin-top: 2px; padding: 4px; background: #fafafa; border-radius: 3px; }
  .raw-stats, .fe-stats { font-size: 11px; color: #888; margin-top: 4px; padding-top: 4px; border-top: 1px solid #eee; }
  .headline { text-align: center; margin-bottom: 24px; padding: 32px 24px; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; }
  .headline-number { font-size: 48px; font-weight: 800; letter-spacing: -1px; }
  .headline-number.good { color: #16a34a; }
  .headline-number.warn { color: #f59e0b; }
  .headline-number.bad { color: #dc2626; }
  .headline-label { font-size: 16px; color: #666; margin-top: 4px; }
  .headline-sub { font-size: 13px; color: #999; margin-top: 2px; }
  .footer { text-align: center; margin-top: 40px; padding: 24px; border-top: 1px solid #e0e0e0; }
  .footer img { height: 32px; opacity: 0.6; }
  .footer-text { font-size: 11px; color: #aaa; margin-top: 8px; }
</style>
</head>
<body>
  <h1>Validation Report</h1>
  <div class="meta">${escapeHtml(fileName)} — ${now}</div>
  <div class="headline">
    <div class="headline-number ${parseFloat(resolutionRate) >= 95 ? 'good' : parseFloat(resolutionRate) >= 80 ? 'warn' : 'bad'}">${totalRawResolved} / ${totalRawSups} — ${resolutionRate}%</div>
    <div class="headline-label">Superscripts Resolved to Reference</div>
    <div class="headline-sub">${passCount} of ${comparisons.length} pages fully correct</div>
  </div>
  <div class="summary">
    <div class="stat"><div class="stat-value neutral">${comparisons.length}</div><div class="stat-label">Pages</div></div>
    <div class="stat"><div class="stat-value pass">${passCount}</div><div class="stat-label">Pass</div></div>
    <div class="stat"><div class="stat-value fail">${failCount}</div><div class="stat-label">Fail</div></div>
    <div class="stat"><div class="stat-value neutral">${totalRawSups}</div><div class="stat-label">Superscripts</div></div>
    <div class="stat"><div class="stat-value neutral">${totalRawResolved}</div><div class="stat-label">Resolved</div></div>
    <div class="stat"><div class="stat-value ${totalRawSups - totalRawResolved > 0 ? 'fail' : 'pass'}">${totalRawSups - totalRawResolved}</div><div class="stat-label">Missing</div></div>
    <div class="stat"><div class="stat-value neutral">${resolutionRate}%</div><div class="stat-label">Resolution</div></div>
    <div class="stat"><div class="stat-value ${totalGaps > 0 ? 'fail' : 'pass'}">${totalGaps}</div><div class="stat-label">Total Gaps</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Page</th>
        <th>Raw Extraction</th>
        <th>Frontend Annotations</th>
        <th>What's Missing</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <div class="footer">
    ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Hedgehox" />` : '<strong>hedgehox</strong>'}
    <div class="footer-text">Generated by Hedgehox Claims Detector — Annotation Validation Pipeline</div>
  </div>
</body>
</html>`
}
```

**Step 2: Wire up the main function and write to file**

```javascript
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Processing: ${pdfPath}`)

  const rawData = await runPyMuPDF(resolve(pdfPath))
  console.log(`  PyMuPDF: ${rawData.total_pages} pages`)

  const annotations = addGlobalIndices(transformPyMuPDFResults(rawData))
  console.log(`  Transform: ${annotations.length} annotations`)

  const comparisons = rawData.pages.map(p => comparePage(p, annotations))
  const passCount = comparisons.filter(c => c.pass).length
  const failCount = comparisons.filter(c => !c.pass).length
  console.log(`  Result: ${passCount} pass, ${failCount} fail`)

  const html = generateHTML(comparisons, rawData.file || basename(pdfPath))
  const outFile = outputPath || `validation-report-${basename(pdfPath, '.pdf')}.html`
  await writeFile(outFile, html, 'utf-8')
  console.log(`  Report: ${outFile}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

**Step 3: Run on test document and open in browser**

```bash
node scripts/generate-validation-report.mjs "MKG Knowledge Base/Test Doc/Marissa_SYN slides for AI testing_V3_no annos.pdf" --output validation-report.html
open validation-report.html
```

Expected: HTML opens in browser with 31-page table, ~27 passing pages, ~4 failing.

**Step 4: Commit**

```bash
git add scripts/generate-validation-report.mjs
git commit -m "feat: validation report HTML generator — raw vs frontend comparison"
```

---

### Task 5: Copy Hedgehox logo to assets

**Files:**
- Create: `assets/hedgehox-logo.png`

**Step 1: Copy the logo**

```bash
mkdir -p assets
cp "/Users/wallymo/Downloads/image 1.png" assets/hedgehox-logo.png
```

**Step 2: Commit**

```bash
git add assets/hedgehox-logo.png
git commit -m "chore: add Hedgehox logo for validation reports"
```

---

### Task 6: Verify and clean up

**Step 1: Run the full report and verify output**

```bash
node scripts/generate-validation-report.mjs "MKG Knowledge Base/Test Doc/Marissa_SYN slides for AI testing_V3_no annos.pdf" --output validation-report.html
```

Verify:
- All 31 pages present
- Pass/fail icons correct
- Raw column shows claims with superscripts + reference pools
- Frontend column shows annotation cards
- Gaps column highlights unresolved superscripts
- Summary stats match expectations

**Step 2: Add `validation-report*.html` to `.gitignore`**

Generated reports should not be committed.

**Step 3: Final commit**

```bash
git add scripts/generate-validation-report.mjs .gitignore
git commit -m "feat: complete validation report generator"
```
