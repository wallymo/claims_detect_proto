#!/usr/bin/env node
/**
 * Validation Report Generator
 *
 * Compares PyMuPDF raw extraction output against the exact frontend
 * transform (transformPyMuPDFResults + addGlobalIndices) to surface
 * gaps in superscript -> reference resolution.
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
    // Unresolved superscripts are kept in PyMuPDF JSON for debugging
    // but not surfaced as annotations — they have no matched reference.
    // Global annotations for orphan references (no superscripts in region)
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
    `<span class="ref-num">${r.number}</span> ${escapeHtml(r.text)}`
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
      <div class="claim-text">${escapeHtml(claim.text)}</div>
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
    `<span class="ref-num">${r.number}</span> ${escapeHtml(r.text)}`
  ).join('<br>')
  return `
    <div class="annotation ${ann.matched ? '' : 'ann-unmatched'}">
      <div class="ann-id">${ann.id} ${matchStatus} ${globalTag}</div>
      <div class="ann-text">${escapeHtml(ann.text)}</div>
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

function renderPool(entries, title) {
  const items = Object.entries(entries || {})
  if (items.length === 0) return ''

  const content = items.map(([key, value]) => {
    const text = String(value || '')
    return `<span class="ref-num">${key}</span> ${escapeHtml(text)}`
  }).join('<br>')

  return `
    <details class="pool-details">
      <summary class="pool-toggle">${title} (${items.length})</summary>
      <div class="pool">${content}</div>
    </details>
  `
}

function renderRegionBlock({
  title,
  theme,
  rawClaims,
  rawLabel,
  frontendAnnotations,
  rawEmptyText,
  frontendEmptyText,
  poolTitle = '',
  poolEntries = null,
}) {
  const rawContent = rawClaims.length > 0
    ? rawClaims.map(claim => renderClaim(claim, rawLabel)).join('')
    : `<div class="empty-block">${rawEmptyText}</div>`

  const frontendContent = frontendAnnotations.length > 0
    ? frontendAnnotations.map(ann => renderAnnotation(ann)).join('')
    : `<div class="empty-block">${frontendEmptyText}</div>`

  return `
    <section class="region-block region-${theme}">
      <div class="region-header">
        <div class="region-title">${title}</div>
        <div class="region-meta">${rawClaims.length} raw · ${frontendAnnotations.length} frontend</div>
      </div>
      <div class="region-grid">
        <div class="region-column">
          <div class="region-column-header">Raw Extraction</div>
          <div class="region-column-body">${rawContent}</div>
        </div>
        <div class="region-column">
          <div class="region-column-header">Frontend</div>
          <div class="region-column-body">${frontendContent}</div>
        </div>
      </div>
      ${poolTitle ? renderPool(poolEntries, poolTitle) : ''}
    </section>
  `
}

function generateHTML(comparisons, fileName) {
  const passCount = comparisons.filter(c => c.pass).length
  const failCount = comparisons.filter(c => !c.pass).length
  const totalGaps = comparisons.reduce((sum, c) => sum + c.gaps.length, 0)
  const totalRawSups = comparisons.reduce((sum, c) => sum + c.raw.totalSups, 0)
  const totalRawResolved = comparisons.reduce((sum, c) => sum + c.raw.resolvedRefs, 0)
  const resolutionRate = totalRawSups > 0 ? ((totalRawResolved / totalRawSups) * 100).toFixed(1) : 'N/A'
  const now = new Date().toISOString().split('T')[0]

  const cards = comparisons.map(c => {
    const statusIcon = c.pass ? '✓' : '✗'
    const headerClass = c.pass ? 'page-header-pass' : 'page-header-fail'
    const statusClass = c.pass ? 'page-status-pass' : 'page-status-fail'
    const cardClass = c.pass ? 'page-card-pass' : 'page-card-fail'
    const slideFrontend = c.frontend.regular.filter(a => a.region === 'slide')
    const notesFrontend = c.frontend.regular.filter(a => a.region === 'notes')
    // Merge globals into their respective regions
    const slideGlobalsRaw = c.raw.globals.filter(g => (g.global_reason || '').includes('slide'))
    const notesGlobalsRaw = c.raw.globals.filter(g => !(g.global_reason || '').includes('slide'))
    const slideGlobalsFe = c.frontend.globals.filter(a => a.region === 'slide')
    const notesGlobalsFe = c.frontend.globals.filter(a => a.region !== 'slide')
    const slideRawAll = [...c.raw.slideClaims, ...slideGlobalsRaw]
    const notesRawAll = [...c.raw.notesClaims, ...notesGlobalsRaw]
    const slideFrontendAll = [...slideFrontend, ...slideGlobalsFe]
    const notesFrontendAll = [...notesFrontend, ...notesGlobalsFe]
    const hasAnyClaims = slideRawAll.length > 0
      || notesRawAll.length > 0
      || c.frontend.annotations.length > 0

    if (!hasAnyClaims) {
      return `
        <article class="page-card page-card-empty ${cardClass}">
          <div class="page-card-header ${headerClass}">
            <div class="page-heading">
              <div class="page-title">Page ${c.page}</div>
              <div class="page-subtitle">No claims detected</div>
            </div>
            <div class="page-status ${statusClass}" role="img" aria-label="${c.pass ? 'Pass' : 'Fail'}">${statusIcon}</div>
          </div>
        </article>
      `
    }

    const gapSection = c.gaps.length > 0
      ? `
        <section class="page-gaps">
          <div class="section-label">Gaps</div>
          <div class="gaps-list">${renderGaps(c.gaps)}</div>
        </section>
      `
      : ''

    return `
      <article class="page-card ${cardClass}">
        <div class="page-card-header ${headerClass}">
          <div class="page-heading">
            <div class="page-title">Page ${c.page}</div>
            <div class="page-subtitle">${c.pass ? 'All claims aligned across extraction and frontend' : `${c.gaps.length} gap${c.gaps.length === 1 ? '' : 's'} detected`}</div>
          </div>
          <div class="page-status ${statusClass}" role="img" aria-label="${c.pass ? 'Pass' : 'Fail'}">${statusIcon}</div>
        </div>
        <div class="page-card-body">
          <div class="page-regions">
            ${renderRegionBlock({
              title: 'Slide Region',
              theme: 'slide',
              rawClaims: slideRawAll,
              rawLabel: 'slide',
              frontendAnnotations: slideFrontendAll,
              rawEmptyText: 'No slide claims extracted for this page.',
              frontendEmptyText: 'No frontend annotations for the slide region.',
              poolTitle: 'Slide footnote pool',
              poolEntries: c.raw.slideFootnotes,
            })}
            ${renderRegionBlock({
              title: 'Notes Region',
              theme: 'notes',
              rawClaims: notesRawAll,
              rawLabel: 'notes',
              frontendAnnotations: notesFrontendAll,
              rawEmptyText: 'No notes claims extracted for this page.',
              frontendEmptyText: 'No frontend annotations for the notes region.',
              poolTitle: 'Notes reference pool',
              poolEntries: c.raw.notesRefs,
            })}
          </div>
          ${gapSection}
          <div class="page-stats">
            <span>Raw: ${c.raw.slideClaims.length + c.raw.notesClaims.length} claims, ${c.raw.totalSups} superscripts, ${c.raw.resolvedRefs} resolved, ${c.raw.missing} missing${c.raw.globals.length > 0 ? `, ${c.raw.globals.length} orphan refs` : ''}</span>
            <span>Frontend: ${c.frontend.regular.length} annotations (${c.frontend.matched.length} matched, ${c.frontend.unmatched.length} unmatched)${c.frontend.globals.length > 0 ? `, ${c.frontend.globals.length} global` : ''}</span>
          </div>
        </div>
      </article>
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
  .page-cards { display: flex; flex-direction: column; gap: 20px; }
  .page-card { background: #fff; border: 1px solid #e0e0e0; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 24px rgba(26, 26, 46, 0.04); }
  .page-card-pass { border-color: #bbf7d0; }
  .page-card-fail { border-color: #fecaca; }
  .page-card-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px; border-bottom: 1px solid #e5e7eb; }
  .page-card-empty .page-card-header { border-bottom: 0; }
  .page-header-pass { background: #ecfdf5; }
  .page-header-fail { background: #fef2f2; }
  .page-heading { min-width: 0; }
  .page-title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .page-subtitle { margin-top: 2px; color: #666; font-size: 12px; }
  .page-status { font-size: 30px; font-weight: 800; line-height: 1; flex-shrink: 0; }
  .page-status-pass { color: #16a34a; }
  .page-status-fail { color: #dc2626; }
  .page-card-body { display: flex; flex-direction: column; gap: 16px; padding: 18px 20px 20px; }
  .page-regions { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  .region-block { border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background: #fff; }
  .region-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #e5e7eb; }
  .region-title { font-size: 14px; font-weight: 700; }
  .region-meta { font-size: 11px; font-weight: 600; opacity: 0.8; }
  .region-slide .region-header { background: #eff6ff; color: #1d4ed8; border-bottom-color: #dbeafe; }
  .region-notes .region-header { background: #f5f3ff; color: #6d28d9; border-bottom-color: #e9d5ff; }
  .region-global .region-header { background: #eef2ff; color: #3730a3; border-bottom-color: #c7d2fe; }
  .region-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .region-column { min-width: 0; padding: 12px 14px 14px; }
  .region-column + .region-column { border-left: 1px solid #e5e7eb; }
  .region-column-header { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #666; margin-bottom: 10px; }
  .region-column-body { display: flex; flex-direction: column; gap: 8px; }
  .claim { margin-bottom: 0; padding: 8px 10px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #2563eb; }
  .claim-partial { border-left-color: #f59e0b; }
  .claim-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #666; }
  .claim-text { font-size: 12px; margin: 2px 0; }
  .claim-sups { font-size: 11px; color: #555; }
  .claim-refs { font-size: 11px; color: #777; margin-top: 2px; }
  .ref-num { display: inline-block; background: #e0e7ff; color: #3730a3; border-radius: 3px; padding: 0 4px; font-weight: 600; font-size: 10px; min-width: 16px; text-align: center; }
  .miss { color: #dc2626; font-weight: 600; }
  .annotation { margin-bottom: 0; padding: 8px 10px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #16a34a; }
  .ann-unmatched { border-left-color: #dc2626; }
  .ann-id { font-size: 10px; color: #888; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .ann-text { font-size: 12px; margin: 2px 0; }
  .ann-sups { font-size: 11px; color: #555; }
  .ann-refs { font-size: 11px; color: #777; margin-top: 2px; }
  .tag-match { background: #dcfce7; color: #166534; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .tag-nomatch { background: #fee2e2; color: #991b1b; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .tag-global { background: #e0e7ff; color: #3730a3; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .empty-block { padding: 12px; border: 1px dashed #d1d5db; border-radius: 8px; background: #fafafa; color: #9ca3af; font-style: italic; }
  .pool-details { padding: 0 14px 14px; border-top: 1px solid #eef2f7; }
  .pool-toggle { cursor: pointer; font-size: 12px; color: #2563eb; font-weight: 600; padding-top: 12px; }
  .pool { font-size: 11px; color: #777; margin-top: 8px; padding: 8px 10px; background: #fafafa; border-radius: 8px; }
  .page-gaps { padding-top: 2px; }
  .section-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #666; margin-bottom: 10px; }
  .gaps-list { display: grid; gap: 8px; }
  .gap { margin-bottom: 0; padding: 6px 8px; border-radius: 8px; font-size: 12px; }
  .gap-unresolved { background: #fee2e2; color: #991b1b; }
  .gap-partial { background: #fef3c7; color: #92400e; }
  .gap-fe-unmatched { background: #fce7f3; color: #9d174d; }
  .no-gaps { color: #16a34a; font-weight: 600; }
  .page-stats { display: flex; flex-wrap: wrap; gap: 16px; padding-top: 14px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
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
  @media (max-width: 900px) {
    .summary { flex-wrap: wrap; }
    .page-regions { grid-template-columns: 1fr; }
  }
  @media (max-width: 720px) {
    body { padding: 16px; }
    .headline { padding: 24px 18px; }
    .page-card-header { padding: 16px; }
    .page-card-body { padding: 16px; }
    .page-title { font-size: 22px; }
    .region-grid { grid-template-columns: 1fr; }
    .region-column + .region-column { border-left: 0; border-top: 1px solid #e5e7eb; }
  }
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
  <div class="page-cards">
    ${cards}
  </div>
  <div class="footer">
    ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Hedgehox" />` : '<strong>hedgehox</strong>'}
    <div class="footer-text">Generated by Hedgehox Claims Detector — Annotation Validation Pipeline</div>
  </div>
</body>
</html>`
}

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
