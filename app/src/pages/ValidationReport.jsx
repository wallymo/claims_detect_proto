import { useMemo, useRef, useState } from 'react'
import '../App.css'
import styles from './ValidationReport.module.css'
import { ThemeToggle } from '@/components/theme'
import { addGlobalIndices } from '@/utils/textMatcher.js'
import { matchCitationToLibrary } from '@/utils/citationLibraryMatcher.js'
import { logger } from '@/utils/logger'

const REPORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA')
const LAST_UPDATED_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})
const STATUS_ICON_PASS = '\u2713'
const STATUS_ICON_FAIL = '\u2717'
const REPORT_SEPARATOR = '\u2014'
const REGION_SEPARATOR = '\u00b7'

function joinClasses(...values) {
  return values.filter(Boolean).join(' ')
}

function truncateText(text, limit) {
  const value = String(text || '')
  return value.length > limit ? `${value.slice(0, limit)}...` : value
}

function extractErrorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error || 'Unknown error')
}

async function extractWithPyMuPDF(file) {
  const formData = new FormData()
  formData.append('pdf', file)

  const response = await fetch('/api/pymupdf-extract', {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || `API error: ${response.status}`)
  }

  return response.json()
}

function formatReportDate(date) {
  return REPORT_DATE_FORMATTER.format(date)
}

function formatLastUpdated(date) {
  return LAST_UPDATED_FORMATTER.format(date)
}

function getHeadlineTone(rate) {
  if (rate === null) return styles.headlineNumberBad
  if (rate >= 95) return styles.headlineNumberGood
  if (rate >= 80) return styles.headlineNumberWarn
  return styles.headlineNumberBad
}

function getStatusTone(type, value) {
  switch (type) {
    case 'pass':
      return styles.statValuePass
    case 'fail':
      return styles.statValueFail
    case 'missing':
      return value > 0 ? styles.statValueFail : styles.statValuePass
    case 'gaps':
      return value > 0 ? styles.statValueFail : styles.statValuePass
    default:
      return styles.statValueNeutral
  }
}

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
    // but not surfaced as annotations - they have no matched reference.
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

function ReferenceLines({ references }) {
  if (!references?.length) return null

  return (
    <div className={styles.claimRefs}>
      {references.map((reference) => (
        <div key={`${reference.number}-${reference.text}`} className={styles.referenceRow}>
          <span className={styles.refNum}>{reference.number}</span>
          <span>{truncateText(reference.text, 80)}</span>
        </div>
      ))}
    </div>
  )
}

function RawClaimCard({ claim, label }) {
  const unresolvedSups = (claim.superscripts || []).filter(
    (superscript) => !(claim.references || []).some((reference) => reference.number === superscript)
  )

  return (
    <div className={joinClasses(styles.claim, unresolvedSups.length > 0 && styles.claimPartial)}>
      <div className={styles.claimLabel}>{label}</div>
      <div className={styles.claimText}>{truncateText(claim.text, 120)}</div>
      <div className={styles.claimSups}>
        Superscripts: [{(claim.superscripts || []).join(', ')}]
        {unresolvedSups.length > 0 ? (
          <span className={styles.miss}>missing: {unresolvedSups.join(', ')}</span>
        ) : null}
      </div>
      <ReferenceLines references={claim.references || []} />
    </div>
  )
}

function FrontendAnnotationCard({ annotation }) {
  return (
    <div className={joinClasses(styles.annotation, !annotation.matched && styles.annUnmatched)}>
      <div className={styles.annId}>
        <span>{annotation.id}</span>
        <span className={annotation.matched ? styles.tagMatch : styles.tagNomatch}>
          {annotation.matched ? 'matched' : 'unmatched'}
        </span>
        {annotation.globalSpot ? <span className={styles.tagGlobal}>global</span> : null}
      </div>
      <div className={styles.annText}>{truncateText(annotation.text, 120)}</div>
      <div className={styles.annSups}>
        [{(annotation.superscripts || []).join(', ')}] -&gt; {(annotation.references || []).length} refs
      </div>
      <ReferenceLines references={annotation.references || []} />
    </div>
  )
}

function Pool({ entries, title }) {
  const items = Object.entries(entries || {})
  if (items.length === 0) return null

  return (
    <details className={styles.poolDetails}>
      <summary className={styles.poolToggle}>
        {title} ({items.length})
      </summary>
      <div className={styles.pool}>
        {items.map(([key, value]) => (
          <div key={key} className={styles.referenceRow}>
            <span className={styles.refNum}>{key}</span>
            <span>{truncateText(value, 80)}</span>
          </div>
        ))}
      </div>
    </details>
  )
}

function RegionBlock({
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
  return (
    <section className={joinClasses(styles.regionBlock, styles[`region${theme}`])}>
      <div className={styles.regionHeader}>
        <div className={styles.regionTitle}>{title}</div>
        <div className={styles.regionMeta}>{rawClaims.length} raw {REGION_SEPARATOR} {frontendAnnotations.length} frontend</div>
      </div>
      <div className={styles.regionGrid}>
        <div className={styles.regionColumn}>
          <div className={styles.regionColumnHeader}>Raw Extraction</div>
          <div className={styles.regionColumnBody}>
            {rawClaims.length > 0
              ? rawClaims.map((claim, index) => (
                <RawClaimCard
                  key={`${title}-raw-${index}-${claim.text}`}
                  claim={claim}
                  label={rawLabel}
                />
              ))
              : <div className={styles.emptyBlock}>{rawEmptyText}</div>}
          </div>
        </div>
        <div className={styles.regionColumn}>
          <div className={styles.regionColumnHeader}>Frontend</div>
          <div className={styles.regionColumnBody}>
            {frontendAnnotations.length > 0
              ? frontendAnnotations.map((annotation) => (
                <FrontendAnnotationCard key={annotation.id} annotation={annotation} />
              ))
              : <div className={styles.emptyBlock}>{frontendEmptyText}</div>}
          </div>
        </div>
      </div>
      {poolTitle ? <Pool entries={poolEntries} title={poolTitle} /> : null}
    </section>
  )
}

function GapCard({ gap }) {
  if (gap.type === 'unresolved-superscript') {
    return (
      <div className={joinClasses(styles.gap, styles.gapUnresolved)}>
        Superscript <strong>{gap.superscript}</strong> unresolved in {gap.region}
        <small>{gap.claimText}</small>
      </div>
    )
  }

  if (gap.type === 'partial-resolution') {
    return (
      <div className={joinClasses(styles.gap, styles.gapPartial)}>
        Superscript <strong>{gap.superscript}</strong> not in ref pool
        <small>{gap.claimText}</small>
      </div>
    )
  }

  if (gap.type === 'frontend-unmatched') {
    return (
      <div className={joinClasses(styles.gap, styles.gapFrontendUnmatched)}>
        Frontend card unmatched: {gap.text}
        <small>sups: [{(gap.superscripts || []).join(', ')}]</small>
      </div>
    )
  }

  return (
    <div className={styles.gap}>
      <code>{JSON.stringify(gap)}</code>
    </div>
  )
}

function PageCard({ comparison }) {
  const statusIcon = comparison.pass ? STATUS_ICON_PASS : STATUS_ICON_FAIL
  const slideFrontend = comparison.frontend.regular.filter((annotation) => annotation.region === 'slide')
  const notesFrontend = comparison.frontend.regular.filter((annotation) => annotation.region === 'notes')
  const hasAnyClaims = comparison.raw.slideClaims.length > 0
    || comparison.raw.notesClaims.length > 0
    || comparison.raw.globals.length > 0
    || comparison.frontend.annotations.length > 0

  if (!hasAnyClaims) {
    return (
      <article className={joinClasses(styles.pageCard, styles.pageCardEmpty, comparison.pass ? styles.pageCardPass : styles.pageCardFail)}>
        <div className={joinClasses(styles.pageCardHeader, comparison.pass ? styles.pageHeaderPass : styles.pageHeaderFail)}>
          <div className={styles.pageHeading}>
            <div className={styles.pageTitle}>Page {comparison.page}</div>
            <div className={styles.pageSubtitle}>No claims detected</div>
          </div>
          <div
            className={joinClasses(styles.pageStatus, comparison.pass ? styles.pageStatusPass : styles.pageStatusFail)}
            aria-label={comparison.pass ? 'Pass' : 'Fail'}
            role="img"
          >
            {statusIcon}
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className={joinClasses(styles.pageCard, comparison.pass ? styles.pageCardPass : styles.pageCardFail)}>
      <div className={joinClasses(styles.pageCardHeader, comparison.pass ? styles.pageHeaderPass : styles.pageHeaderFail)}>
        <div className={styles.pageHeading}>
          <div className={styles.pageTitle}>Page {comparison.page}</div>
          <div className={styles.pageSubtitle}>
            {comparison.pass
              ? 'All claims aligned across extraction and frontend'
              : `${comparison.gaps.length} gap${comparison.gaps.length === 1 ? '' : 's'} detected`}
          </div>
        </div>
        <div
          className={joinClasses(styles.pageStatus, comparison.pass ? styles.pageStatusPass : styles.pageStatusFail)}
          aria-label={comparison.pass ? 'Pass' : 'Fail'}
          role="img"
        >
          {statusIcon}
        </div>
      </div>
      <div className={styles.pageCardBody}>
        <div className={styles.pageRegions}>
          <RegionBlock
            title="Slide Region"
            theme="Slide"
            rawClaims={comparison.raw.slideClaims}
            rawLabel="slide claim"
            frontendAnnotations={slideFrontend}
            rawEmptyText="No slide claims extracted for this page."
            frontendEmptyText="No frontend annotations for the slide region."
            poolTitle="Slide footnote pool"
            poolEntries={comparison.raw.slideFootnotes}
          />
          <RegionBlock
            title="Notes Region"
            theme="Notes"
            rawClaims={comparison.raw.notesClaims}
            rawLabel="notes claim"
            frontendAnnotations={notesFrontend}
            rawEmptyText="No notes claims extracted for this page."
            frontendEmptyText="No frontend annotations for the notes region."
            poolTitle="Notes reference pool"
            poolEntries={comparison.raw.notesRefs}
          />
        </div>

        {(comparison.raw.globals.length > 0 || comparison.frontend.globals.length > 0) ? (
          <RegionBlock
            title="Global Annotations"
            theme="Global"
            rawClaims={comparison.raw.globals}
            rawLabel="orphan ref"
            frontendAnnotations={comparison.frontend.globals}
            rawEmptyText="No orphan references in raw extraction."
            frontendEmptyText="No orphan references in frontend annotations."
          />
        ) : null}

        {comparison.gaps.length > 0 ? (
          <section className={styles.pageGaps}>
            <div className={styles.sectionLabel}>Gaps</div>
            <div className={styles.gapsList}>
              {comparison.gaps.map((gap, index) => (
                <GapCard key={`${comparison.page}-${gap.type}-${index}`} gap={gap} />
              ))}
            </div>
          </section>
        ) : null}

        <div className={styles.pageStats}>
          <span>
            Raw: {comparison.raw.slideClaims.length + comparison.raw.notesClaims.length} claims, {comparison.raw.totalSups} superscripts, {comparison.raw.resolvedRefs} resolved, {comparison.raw.missing} missing
            {comparison.raw.globals.length > 0 ? `, ${comparison.raw.globals.length} orphan refs` : ''}
          </span>
          <span>
            Frontend: {comparison.frontend.regular.length} annotations ({comparison.frontend.matched.length} matched, {comparison.frontend.unmatched.length} unmatched)
            {comparison.frontend.globals.length > 0 ? `, ${comparison.frontend.globals.length} global` : ''}
          </span>
        </div>
      </div>
    </article>
  )
}

export default function ValidationReport() {
  const fileInputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadedFile, setUploadedFile] = useState(null)
  const [rawPyMuPDFData, setRawPyMuPDFData] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const report = useMemo(() => {
    if (!rawPyMuPDFData?.pages) {
      return {
        comparisons: [],
        indexedAnnotations: [],
        totalAnnotations: 0,
        passCount: 0,
        failCount: 0,
        totalGaps: 0,
        totalRawSups: 0,
        totalRawResolved: 0,
        resolutionRate: null,
      }
    }

    const transformed = transformPyMuPDFResults(rawPyMuPDFData, [])
    const indexedAnnotations = addGlobalIndices(transformed)
    const comparisons = rawPyMuPDFData.pages.map((page) => comparePage(page, indexedAnnotations))
    const passCount = comparisons.filter((comparison) => comparison.pass).length
    const failCount = comparisons.filter((comparison) => !comparison.pass).length
    const totalGaps = comparisons.reduce((sum, comparison) => sum + comparison.gaps.length, 0)
    const totalRawSups = comparisons.reduce((sum, comparison) => sum + comparison.raw.totalSups, 0)
    const totalRawResolved = comparisons.reduce((sum, comparison) => sum + comparison.raw.resolvedRefs, 0)
    const resolutionRate = totalRawSups > 0
      ? Number(((totalRawResolved / totalRawSups) * 100).toFixed(1))
      : null

    return {
      comparisons,
      indexedAnnotations,
      totalAnnotations: indexedAnnotations.length,
      passCount,
      failCount,
      totalGaps,
      totalRawSups,
      totalRawResolved,
      resolutionRate,
    }
  }, [rawPyMuPDFData])

  const reportFileName = rawPyMuPDFData?.file || uploadedFile?.name || 'Validation Report'
  const summaryStats = [
    { label: 'Annotations', value: report.totalAnnotations, tone: 'neutral' },
    { label: 'Pages', value: report.comparisons.length, tone: 'neutral' },
    { label: 'Pass', value: report.passCount, tone: 'pass' },
    { label: 'Fail', value: report.failCount, tone: 'fail' },
    { label: 'Superscripts', value: report.totalRawSups, tone: 'neutral' },
    { label: 'Resolved', value: report.totalRawResolved, tone: 'neutral' },
    { label: 'Missing', value: report.totalRawSups - report.totalRawResolved, tone: 'missing' },
    { label: 'Resolution', value: report.resolutionRate === null ? 'N/A' : `${report.resolutionRate}%`, tone: 'neutral' },
    { label: 'Total Gaps', value: report.totalGaps, tone: 'gaps' },
  ]

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const processFile = async (file) => {
    if (!file) return

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      setUploadError('Please upload a PDF file.')
      return
    }

    setUploadError('')
    setUploadedFile(file)
    setIsUploading(true)

    try {
      logger.info({ event: 'validation_report_upload_started', fileName: file.name, size: file.size })
      const rawData = await extractWithPyMuPDF(file)
      const transformed = transformPyMuPDFResults(rawData, [])
      const indexed = addGlobalIndices(transformed)
      logger.info({
        event: 'validation_report_upload_completed',
        fileName: file.name,
        pages: rawData?.pages?.length || 0,
        annotations: indexed.length
      })
      setRawPyMuPDFData(rawData)
      setLastUpdated(new Date())
    } catch (error) {
      const message = extractErrorMessage(error)
      logger.error({ event: 'validation_report_upload_failed', fileName: file.name, error: message })
      setRawPyMuPDFData(null)
      setUploadError(message)
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileInputChange = async (event) => {
    const [file] = event.target.files || []
    await processFile(file)
    event.target.value = ''
  }

  const handleDrop = async (event) => {
    event.preventDefault()
    setIsDragging(false)
    const [file] = event.dataTransfer.files || []
    await processFile(file)
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    if (!isDragging) setIsDragging(true)
  }

  const handleDragLeave = (event) => {
    event.preventDefault()
    if (event.currentTarget.contains(event.relatedTarget)) return
    setIsDragging(false)
  }

  return (
    <main className={styles.page}>
      <div className={styles.topBar}>
        <div>
          <h1 className={styles.title}>Validation Report</h1>
          <p className={styles.meta}>
            {reportFileName} {lastUpdated ? `${REPORT_SEPARATOR} ${formatReportDate(lastUpdated)}` : ''}
          </p>
        </div>
        <ThemeToggle />
      </div>

      <section className={styles.uploadCard}>
        <div className={styles.uploadHeader}>
          <div>
            <h2 className={styles.uploadTitle}>Upload a PDF</h2>
            <p className={styles.uploadSubtitle}>
              Sends the file to <code>/api/pymupdf-extract</code>, stores the raw PyMuPDF JSON response, and compares it to the frontend transform.
            </p>
          </div>
          {(uploadedFile && !isUploading) ? (
            <div className={styles.uploadMeta}>
              <span>{uploadedFile.name}</span>
              {lastUpdated ? <span>Updated {formatLastUpdated(lastUpdated)}</span> : null}
            </div>
          ) : null}
        </div>

        <div
          className={joinClasses('dropZone', isDragging && 'dropZoneActive', styles.uploadZone, isUploading && styles.uploadZoneBusy)}
          onClick={isUploading ? undefined : handleUploadClick}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onKeyDown={(event) => {
            if (isUploading) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              handleUploadClick()
            }
          }}
          role="button"
          tabIndex={isUploading ? -1 : 0}
        >
          <div className="dropZoneIcon" aria-hidden="true">
            {isUploading ? '...' : 'PDF'}
          </div>
          <p className="dropZoneText">
            <strong>{isUploading ? 'Processing validation report...' : 'Drop a PDF here or click to upload'}</strong>
          </p>
          <p className="dropZoneHint">
            {isUploading
              ? 'PyMuPDF extraction and comparison in progress'
              : 'PDF only'}
          </p>
        </div>

        <input
          ref={fileInputRef}
          accept="application/pdf,.pdf"
          className={styles.hiddenInput}
          onChange={handleFileInputChange}
          type="file"
        />

        {uploadError ? <div className={styles.uploadError}>{uploadError}</div> : null}
        {rawPyMuPDFData ? (
          <div className={styles.uploadMetaRow}>
            <span>{rawPyMuPDFData.pages?.length || 0} pages extracted</span>
            <span>{report.indexedAnnotations.length} frontend annotations after transform</span>
            <span>Raw response stored in component state</span>
          </div>
        ) : null}
      </section>

      {rawPyMuPDFData ? (
        <>
          <section className={styles.headline}>
            <div className={joinClasses(styles.headlineNumber, getHeadlineTone(report.resolutionRate))}>
              {report.totalAnnotations} Annotations
            </div>
            <div className={styles.headlineLabel}>{report.totalRawResolved} / {report.totalRawSups} superscripts resolved to reference</div>
            <div className={styles.headlineSub}>
              {report.passCount} of {report.comparisons.length} pages fully correct
            </div>
          </section>

          <section className={styles.summary} aria-label="Validation summary statistics">
            {summaryStats.map((stat) => (
              <div key={stat.label} className={styles.stat}>
                <div className={joinClasses(styles.statValue, getStatusTone(stat.tone, typeof stat.value === 'number' ? stat.value : null))}>
                  {stat.value}
                </div>
                <div className={styles.statLabel}>{stat.label}</div>
              </div>
            ))}
          </section>

          <section className={styles.pageCards}>
            {report.comparisons.map((comparison) => (
              <PageCard key={comparison.page} comparison={comparison} />
            ))}
          </section>

          <footer className={styles.footer}>
            <img alt="Hedgehox" className={styles.footerLogo} src="/assets/hedgehox-logo.png" />
            <div className={styles.footerText}>
              Generated by Hedgehox Claims Detector {REPORT_SEPARATOR} Annotation Validation Pipeline
            </div>
          </footer>
        </>
      ) : (
        <section className={styles.emptyState}>
          Upload a PDF to generate the live validation report for superscript-to-reference resolution.
        </section>
      )}
    </main>
  )
}
