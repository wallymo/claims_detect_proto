import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-detector-evidence-'))
const dbPath = path.join(tempDir, 'evidence-location.db')

let initDb
let closeDb
let getDb
let EvidenceSuggestion
let AcceptedEvidence
let evidenceController

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}

before(async () => {
  process.env.DB_PATH = dbPath

  const databaseModule = await import('../src/config/database.js')
  initDb = databaseModule.initDb
  closeDb = databaseModule.closeDb
  getDb = databaseModule.getDb

  ;({ EvidenceSuggestion } = await import('../src/models/EvidenceSuggestion.js'))
  ;({ AcceptedEvidence } = await import('../src/models/AcceptedEvidence.js'))
  ;({ evidenceController } = await import('../src/controllers/evidenceController.js'))

  initDb()
})

beforeEach(() => {
  const db = getDb()
  db.exec(`
    DELETE FROM accepted_evidence;
    DELETE FROM evidence_suggestions;
    DELETE FROM reference_documents;
    DELETE FROM brands;
  `)

  db.prepare(`
    INSERT INTO brands (id, name, client)
    VALUES (1, 'Test Brand', 'Client')
  `).run()

  db.prepare(`
    INSERT INTO reference_documents
      (id, brand_id, filename, display_alias, file_path, doc_type, file_size_bytes)
    VALUES
      (1, 1, 'ref.pdf', 'Ref Citation', '/tmp/ref.pdf', 'pdf', 100)
  `).run()
})

after(() => {
  closeDb()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('evidence location updates', () => {
  it('updates suggestion location and keeps rects hydrated', () => {
    EvidenceSuggestion.bulkCreate([{
      suggestion_id: 's1',
      claim_id: 'claim-1',
      reference_id: 1,
      page_number: 2,
      type: 'text',
      rects: [{ x0: 1, y0: 2, x1: 3, y1: 4 }],
      text: 'Evidence snippet',
      score: 0.91,
      support_strength: 'direct_support',
      rationale: 'Matches the claim',
      location_annotation: 'Ref Citation/ln1-40',
    }])

    const updated = EvidenceSuggestion.update('s1', {
      location_annotation: 'Ref Citation/ln17-40',
    })

    assert.equal(updated.location_annotation, 'Ref Citation/ln17-40')
    assert.deepEqual(updated.rects, [{ x0: 1, y0: 2, x1: 3, y1: 4 }])
  })

  it('rejects empty location updates for suggestions', async () => {
    EvidenceSuggestion.bulkCreate([{
      suggestion_id: 's2',
      claim_id: 'claim-2',
      reference_id: 1,
      page_number: 1,
      type: 'text',
      rects: [{ x0: 10, y0: 20, x1: 30, y1: 40 }],
      text: 'Evidence snippet',
      score: 0.77,
      support_strength: 'partial_support',
      rationale: 'Maybe relevant',
      location_annotation: 'Ref Citation/ln1-20',
    }])

    const req = {
      params: { suggestionId: 's2' },
      body: { location_annotation: '   ' },
    }
    const res = createMockRes()
    let forwardedError = null

    await evidenceController.updateSuggestionStatus(req, res, (err) => {
      forwardedError = err
    })

    assert.equal(res.body, null)
    assert.equal(forwardedError?.message, 'location_annotation cannot be empty')
  })

  it('accepts a suggestion with corrected location and persists it to accepted evidence', async () => {
    EvidenceSuggestion.bulkCreate([{
      suggestion_id: 's3',
      claim_id: 'claim-3',
      reference_id: 1,
      page_number: 4,
      type: 'text',
      rects: [{ x0: 5, y0: 6, x1: 20, y1: 24 }],
      text: 'Evidence snippet',
      score: 0.95,
      support_strength: 'direct_support',
      rationale: 'Exact support',
      location_annotation: 'Ref Citation/ln1-40',
    }])

    const req = {
      params: { suggestionId: 's3' },
      body: {
        status: 'accepted',
        location_annotation: 'Ref Citation/ln17-40',
      },
    }
    const res = createMockRes()

    await evidenceController.updateSuggestionStatus(req, res, (err) => {
      throw err
    })

    assert.equal(res.body.suggestion.location_annotation, 'Ref Citation/ln17-40')
    assert.equal(res.body.accepted_evidence.location_annotation, 'Ref Citation/ln17-40')

    const savedEvidence = AcceptedEvidence.findByClaimAndRef('claim-3', 1)
    assert.equal(savedEvidence.length, 1)
    assert.equal(savedEvidence[0].location_annotation, 'Ref Citation/ln17-40')
  })

  it('updates accepted evidence location through the controller', async () => {
    AcceptedEvidence.create({
      evidence_id: 'ae_1',
      claim_id: 'claim-4',
      reference_id: 1,
      page_number: 2,
      type: 'text',
      rects: [{ x0: 1, y0: 1, x1: 10, y1: 10 }],
      text: 'Accepted evidence',
      origin: 'suggestion_accepted',
      suggestion_id: 's4',
      location_annotation: 'Ref Citation/ln5-12',
    })

    const req = {
      params: { evidenceId: 'ae_1' },
      body: { location_annotation: 'Ref Citation/ln8-12' },
    }
    const res = createMockRes()

    await evidenceController.updateAcceptedEvidence(req, res, (err) => {
      throw err
    })

    assert.equal(res.body.evidence.location_annotation, 'Ref Citation/ln8-12')
    assert.deepEqual(res.body.evidence.rects, [{ x0: 1, y0: 1, x1: 10, y1: 10 }])
  })
})
