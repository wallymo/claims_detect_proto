import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'
import { GoogleGenAI } from '@google/genai'
import { Reference } from '../models/Reference.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_BIN = path.join(PROJECT_ROOT, 'scripts/.venv/bin/python3')
const CANDIDATES_SCRIPT = path.join(PROJECT_ROOT, 'scripts/evidence_candidates.py')

const FLASH_LITE_MODEL = 'gemini-2.5-flash-lite-preview-06-27'
const PRO_MODEL = 'gemini-2.5-pro-preview-06-05'

async function discoverClaims(slideText, notesText, orphanReferences) {
  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) return []

  const ai = new GoogleGenAI({ apiKey })
  const refsBlock = orphanReferences.map((r, i) =>
    `Reference ${i}: ${r.text}`
  ).join('\n')

  const prompt = `You are analyzing a pharma slide deck page. Some references appear as footnotes but have no superscript citations in the text.

SLIDE CONTENT:
${slideText || '(none)'}

SPEAKER NOTES:
${notesText || '(none)'}

ORPHAN REFERENCES (no superscript points to them):
${refsBlock}

Task: Identify specific statements in the slide content or speaker notes that these orphan references likely support. Look for:
- Quantitative claims (percentages, hazard ratios, p-values, incidence rates)
- Mechanism of action statements
- Safety/tolerability findings
- Efficacy endpoints
- Comparative claims (superior, improved, favorable)
- Epidemiological facts (incidence, prevalence)

For each discovered claim, return:
- text: exact statement from the slide
- position_hint: approximate { x, y } as percentage of page (your best estimate)
- reference_index: which orphan reference (0-indexed) supports this claim
- evidence_type_expected: "statistical" | "mechanism" | "safety" | "epidemiological" | "general"
- confidence: 0-1 how certain you are this reference supports this claim

Return strict JSON only: { "discovered_claims": [...] }
If no claims match, return { "discovered_claims": [] }`

  const response = await ai.models.generateContent({
    model: FLASH_LITE_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' }
  })

  const text = response.text || ''
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed.discovered_claims) ? parsed.discovered_claims : []
  } catch {
    console.warn('[GlobalLinker] Pass 1 parse failed:', text.slice(0, 200))
    return []
  }
}

async function locateEvidence(claimText, referencePdfPath) {
  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) return null

  let candidates = []
  try {
    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      [CANDIDATES_SCRIPT, referencePdfPath, '--claim', claimText, '--top-k', '15'],
      { cwd: PROJECT_ROOT, maxBuffer: 50 * 1024 * 1024, timeout: 60_000 }
    )
    const payload = JSON.parse(stdout)
    candidates = payload.candidates || []
  } catch (err) {
    console.warn('[GlobalLinker] evidence_candidates.py failed:', err.message)
    return null
  }

  if (candidates.length === 0) return null

  const ai = new GoogleGenAI({ apiKey })
  const candidatesBlock = candidates.slice(0, 15).map((c, i) =>
    `[${i}] Page ${c.page_number}, type=${c.type}, score=${c.score?.toFixed(2)}: "${c.text?.slice(0, 200)}"`
  ).join('\n')

  const prompt = `Given this claim and candidate evidence regions from a reference PDF, select the BEST 1-2 regions that directly support the claim.

CLAIM: "${claimText}"

CANDIDATES:
${candidatesBlock}

For each selected region, return:
- candidate_index: index from the list above
- support_strength: "direct_support" | "partial_support" | "weak_support"
- rationale: one sentence explaining why this evidence supports the claim

Return strict JSON: { "evidence": [{ "candidate_index": N, "support_strength": "...", "rationale": "..." }] }`

  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' }
  })

  const text = response.text || ''
  try {
    const parsed = JSON.parse(text)
    const selected = Array.isArray(parsed.evidence) ? parsed.evidence : []

    return selected.map(sel => {
      const cand = candidates[sel.candidate_index]
      if (!cand) return null
      return {
        page_number: cand.page_number,
        type: cand.type,
        rects: cand.rects,
        snippet: cand.text?.slice(0, 300),
        rationale: sel.rationale,
        support_strength: sel.support_strength
      }
    }).filter(Boolean)
  } catch {
    console.warn('[GlobalLinker] Pass 2 parse failed:', text.slice(0, 200))
    return null
  }
}

export async function enrichGlobalAnnotations(pymupdfResult, brandId) {
  if (!process.env.VITE_GEMINI_API_KEY) {
    console.info('[GlobalLinker] No Gemini key — skipping global annotation enrichment')
    return pymupdfResult
  }

  const pagesWithGlobals = (pymupdfResult.pages || []).filter(p =>
    Array.isArray(p.global_annotations) && p.global_annotations.length > 0
  )

  if (pagesWithGlobals.length === 0) return pymupdfResult

  console.info(`[GlobalLinker] Enriching ${pagesWithGlobals.length} pages with global annotations`)

  let referenceMap = {}
  if (brandId) {
    try {
      const refs = await Reference.findByBrand(brandId)
      referenceMap = Object.fromEntries(refs.map(r => [r.id, r]))
    } catch {
      console.warn('[GlobalLinker] Could not load reference paths for brand')
    }
  }

  for (const page of pagesWithGlobals) {
    const slideText = (page.slide_claims || []).map(c => c.text).join('\n')
    const notesText = (page.notes_claims || []).map(c => c.text).join('\n')

    for (const globalAnno of page.global_annotations) {
      const orphanRefs = globalAnno.references || []

      if (orphanRefs.length === 0) continue

      const discovered = await discoverClaims(slideText, notesText, orphanRefs)

      if (discovered.length === 0) continue

      const evidencePromises = discovered.map(async (disc, claimIdx) => {
        const ref = orphanRefs[disc.reference_index]
        if (!ref) return null

        const refId = ref.id
        const refDoc = refId ? referenceMap[refId] : null
        if (!refDoc?.file_path) return {
          id: `pymupdf-gc-${page.page}-${page.global_annotations.indexOf(globalAnno)}-${claimIdx}`,
          text: disc.text,
          position: disc.position_hint,
          source: 'global-deep-link',
          confidence: disc.confidence,
          reference_id: refId,
          evidence: null
        }

        const evidence = await locateEvidence(disc.text, refDoc.file_path)

        return {
          id: `pymupdf-gc-${page.page}-${page.global_annotations.indexOf(globalAnno)}-${claimIdx}`,
          text: disc.text,
          position: disc.position_hint,
          source: 'global-deep-link',
          confidence: disc.confidence,
          reference_id: refId,
          evidence: Array.isArray(evidence) ? evidence[0] : evidence
        }
      })

      const results = await Promise.all(evidencePromises)
      globalAnno.childClaims = results.filter(Boolean)

      console.info(`[GlobalLinker] Page ${page.page}: found ${globalAnno.childClaims.length} child claims for global annotation`)
    }
  }

  return pymupdfResult
}
