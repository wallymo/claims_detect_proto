import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { GoogleGenAI } from '@google/genai'
import { AppError } from '../middleware/errorHandler.js'
import { Reference } from '../models/Reference.js'
import { EvidenceSuggestion } from '../models/EvidenceSuggestion.js'
import { AcceptedEvidence } from '../models/AcceptedEvidence.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_BIN = path.join(PROJECT_ROOT, 'scripts/.venv/bin/python3')
const CANDIDATES_SCRIPT = path.join(PROJECT_ROOT, 'scripts/evidence_candidates.py')
const RENDER_SCRIPT = path.join(PROJECT_ROOT, 'scripts/render_page.py')

function getGeminiClient() {
  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) throw new AppError('VITE_GEMINI_API_KEY not set', 500)
  return new GoogleGenAI({ apiKey })
}

function stripCodeFences(text) {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
}

async function decomposeClaimWithGemini(ai, claimText) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: `You extract structured claim metadata for an evidence retrieval workflow.

Given the following claim, extract the following fields and return strict JSON only:
- drug_names[]
- endpoint_terms[]
- population_terms[]
- comparator_terms[]
- numeric_terms[]
- temporal_terms[]
- study_terms[]
- normalized_claim

Claim:
${claimText}

Return JSON only.`,
    config: { temperature: 0, topP: 0.1, topK: 1 }
  })
  return JSON.parse(stripCodeFences(response.text.trim()))
}

async function analyzePageWithVision(ai, pdfPath, pageNumber) {
  const { stdout } = await execFileAsync(
    PYTHON_BIN,
    [RENDER_SCRIPT, pdfPath, '--page', String(pageNumber)],
    { maxBuffer: 50 * 1024 * 1024, timeout: 15_000 }
  )
  const renderResult = JSON.parse(stdout)
  const pageWidth = renderResult.width
  const pageHeight = renderResult.height
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        inlineData: {
          mimeType: 'image/png',
          data: renderResult.image,
        },
      },
      `Identify all figures, charts, tables, and diagrams on this PDF page.
For each visual element, return:
- type: one of figure, chart, table, diagram
- bbox: [x0, y0, x1, y1] as percentages of page dimensions (0-100)
- description: one-sentence description of what the visual shows

Return strict JSON only:
{ "visuals": [{ "type": "chart", "bbox": [10, 20, 90, 80], "description": "..." }] }

If no visual elements found, return: { "visuals": [] }
Return JSON only.`,
    ],
    config: { temperature: 0, topP: 0.1, topK: 1 },
  })
  const parsed = JSON.parse(stripCodeFences(response.text.trim()))
  return { ...parsed, pageWidth, pageHeight }
}

async function rerankCandidatesWithGemini(ai, claimText, claimMetadata, candidates) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: `You are ranking candidate evidence regions from a source PDF for a human review workflow.
You do not invent evidence.
You only select from the candidates provided.
Return strict JSON only.

Claim:
${claimText}

Structured claim metadata:
${JSON.stringify(claimMetadata)}

Candidate regions:
${JSON.stringify(candidates)}

Task:
Select the best 6 candidate regions that could support the claim.
Prefer direct support, but include diverse useful candidates when appropriate.
Do not return 6 near-duplicates from the same paragraph.
Candidates with type 'figure', 'chart', 'structured_box', or 'table' contain visual or structured evidence. Prefer these when the claim involves quantitative data, comparisons, classifications, or diagnostic criteria.
For each selected candidate, return:
- candidate_id
- support_strength (direct_support | partial_support | weak_support)
- score (0 to 1)
- rationale (1 sentence)

Return JSON in this shape:
{
  "selected": [
    {
      "candidate_id": "cand_0001",
      "support_strength": "direct_support",
      "score": 0.93,
      "rationale": "..."
    }
  ]
}

Return JSON only.`,
    config: { temperature: 0, topP: 0.1, topK: 1 }
  })
  return JSON.parse(stripCodeFences(response.text.trim()))
}

export const evidenceController = {
  async generateSuggestions(req, res, next) {
    try {
      const { claim_text, claim_id, reference_id } = req.body
      if (!claim_text || !claim_id || !reference_id) {
        throw new AppError('claim_text, claim_id, and reference_id are required', 400)
      }

      // Return cached suggestions if they already exist for this claim+reference
      const existing = EvidenceSuggestion.findByClaimAndRef(claim_id, reference_id)
      if (existing.length > 0) {
        return res.json({ suggestions: existing })
      }

      const ref = Reference._findByIdFull(reference_id)
      if (!ref) throw new AppError('Reference document not found', 404)
      const shortCitation = ref.display_alias
        || ref.filename?.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
        || 'Reference'
      if (!ref.file_path || !fs.existsSync(ref.file_path)) {
        throw new AppError('Reference PDF file not found on disk', 404)
      }

      if (!fs.existsSync(PYTHON_BIN)) {
        throw new AppError('Python venv not found. Run: python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt', 500)
      }

      const { stdout, stderr } = await execFileAsync(
        PYTHON_BIN,
        [CANDIDATES_SCRIPT, ref.file_path, '--claim', claim_text, '--top-k', '30'],
        { maxBuffer: 50 * 1024 * 1024, timeout: 30_000 }
      )

      const candidateResult = JSON.parse(stdout)
      const candidates = candidateResult.candidates

      if (!candidates || candidates.length === 0) {
        return res.json({ suggestions: [] })
      }

      const ai = getGeminiClient()

      // Vision lane: analyze flagged pages for charts/figures
      const visionPages = candidateResult.vision_pages || []
      if (visionPages.length > 0) {
        let visIdx = 0
        for (const vp of visionPages.slice(0, 3)) {
          try {
            const visionResult = await analyzePageWithVision(ai, ref.file_path, vp)
            const vpWidth = visionResult.pageWidth || 612
            const vpHeight = visionResult.pageHeight || 792
            for (const visual of (visionResult.visuals || [])) {
              const [bx0, by0, bx1, by1] = visual.bbox || [0, 0, 100, 100]
              candidates.push({
                candidate_id: `vis_p${vp}_${visIdx}`,
                page_number: vp,
                type: visual.type || 'figure',
                rects: [{
                  x0: Math.round(bx0 * vpWidth / 100),
                  y0: Math.round(by0 * vpHeight / 100),
                  x1: Math.round(bx1 * vpWidth / 100),
                  y1: Math.round(by1 * vpHeight / 100),
                }],
                text: visual.description || null,
                pre_score: 0.5,
                location_annotation: `/p${vp}/${visual.type || 'fig'}`,
              })
              visIdx++
            }
          } catch (visionErr) {
            console.error(`Vision analysis failed for page ${vp}:`, visionErr.message || visionErr)
          }
        }
      }

      let claimMetadata
      try {
        claimMetadata = await decomposeClaimWithGemini(ai, claim_text)
      } catch (err) {
        claimMetadata = { normalized_claim: claim_text }
      }

      const rerankResult = await rerankCandidatesWithGemini(ai, claim_text, claimMetadata, candidates)
      const selected = rerankResult.selected || []

      const candidateMap = new Map(candidates.map(c => [c.candidate_id, c]))
      const suggestions = selected.slice(0, 6).map((sel, idx) => {
        const cand = candidateMap.get(sel.candidate_id) || {}
        return {
          suggestion_id: `es_${reference_id}_${claim_id}_${idx + 1}`,
          claim_id,
          reference_id,
          page_number: cand.page_number || 1,
          type: cand.type || 'text',
          rects: cand.rects || [],
          text: cand.text || null,
          score: sel.score || 0,
          support_strength: sel.support_strength || 'weak_support',
          rationale: sel.rationale || null,
          status: 'suggested',
          origin: 'rules_plus_ai',
          location_annotation: `${shortCitation}${cand.location_annotation || ''}`,
        }
      })

      EvidenceSuggestion.bulkCreate(suggestions, {
        raw_shortlist: candidateResult,
        raw_gemini_response: rerankResult,
      })

      res.json({ suggestions })
    } catch (err) {
      if (err.killed) return next(new AppError('Evidence candidate extraction timed out', 504))
      if (err instanceof SyntaxError) return next(new AppError('Invalid JSON from pipeline', 500))
      next(err)
    }
  },

  async getAccepted(req, res, next) {
    try {
      const { claim_id, reference_id } = req.query
      if (!claim_id || !reference_id) {
        throw new AppError('claim_id and reference_id query params required', 400)
      }
      const evidence = AcceptedEvidence.findByClaimAndRef(claim_id, Number(reference_id))
      res.json({ evidence })
    } catch (err) {
      next(err)
    }
  },

  async updateSuggestionStatus(req, res, next) {
    try {
      const { suggestionId } = req.params
      const { status } = req.body
      if (!['accepted', 'rejected', 'suggested'].includes(status)) {
        throw new AppError('status must be "accepted", "rejected", or "suggested"', 400)
      }

      const updated = EvidenceSuggestion.updateStatus(suggestionId, status)
      if (!updated) throw new AppError('Suggestion not found', 404)

      if (status === 'accepted') {
        AcceptedEvidence.create({
          evidence_id: `ae_${suggestionId}`,
          claim_id: updated.claim_id,
          reference_id: updated.reference_id,
          page_number: updated.page_number,
          type: updated.type,
          rects: JSON.parse(updated.rects),
          text: updated.text,
          origin: 'suggestion_accepted',
          suggestion_id: suggestionId,
          location_annotation: updated.location_annotation || null,
        })
      }

      res.json({ suggestion: updated })
    } catch (err) {
      next(err)
    }
  },

  async createManualEvidence(req, res, next) {
    try {
      const { claim_id, reference_id, page_number, rects, text } = req.body
      if (!claim_id || !reference_id || !page_number || !rects) {
        throw new AppError('claim_id, reference_id, page_number, and rects are required', 400)
      }

      const evidence_id = `ae_manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const created = AcceptedEvidence.create({
        evidence_id,
        claim_id,
        reference_id,
        page_number,
        type: 'manual_box',
        rects,
        text: text || null,
        origin: 'manual_user_box',
      })

      res.status(201).json({ evidence: created })
    } catch (err) {
      next(err)
    }
  },

  async clearSuggestions(req, res, next) {
    try {
      const { claim_id, reference_id } = req.query
      if (!claim_id || !reference_id) {
        throw new AppError('claim_id and reference_id query params required', 400)
      }
      EvidenceSuggestion.deleteByClaimAndRef(claim_id, Number(reference_id))
      res.json({ cleared: true })
    } catch (err) {
      next(err)
    }
  },

  async deleteAcceptedEvidence(req, res, next) {
    try {
      const { evidenceId } = req.params
      AcceptedEvidence.delete(evidenceId)
      res.json({ deleted: true })
    } catch (err) {
      next(err)
    }
  },
}
