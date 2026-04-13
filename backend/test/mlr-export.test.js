import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildApprovedExportClaims, determineGutterSide, resolveReferenceNotationLines } from '../src/services/mlrExport.js'

describe('mlr export helpers', () => {
  it('resolves accepted evidence notation before locator or citation fallback', () => {
    const lines = resolveReferenceNotationLines(
      {
        number: 1,
        text: 'Fallback Citation',
        locator: { location_annotation: 'Locator/Override' }
      },
      [
        { location_annotation: 'Accepted/Line 1' },
        { location_annotation: 'Accepted/Line 1' },
        { location_annotation: 'Accepted/Line 2' }
      ]
    )

    assert.deepEqual(lines, ['Accepted/Line 1', 'Accepted/Line 2'])
  })

  it('builds export claims from approved claims only and skips approved claims without notation lines', () => {
    const claims = [
      {
        id: 'claim-approved',
        page: 2,
        status: 'approved',
        text: 'Approved claim',
        position: { x: 22, y: 36 },
        references: [
          { id: 11, number: 1, text: 'Fallback Citation' }
        ]
      },
      {
        id: 'claim-pending',
        page: 2,
        status: 'pending',
        text: 'Pending claim',
        position: { x: 80, y: 44 },
        references: [
          { id: 12, number: 2, text: 'Should not export' }
        ]
      },
      {
        id: 'claim-empty',
        page: 3,
        status: 'approved',
        text: 'Approved but empty',
        position: { x: 80, y: 52 },
        references: []
      }
    ]

    const exportClaims = buildApprovedExportClaims(claims, {
      getAcceptedEvidenceForPair: (claimId, referenceId) => (
        claimId === 'claim-approved' && referenceId === 11
          ? [{ location_annotation: 'Accepted/Locator' }]
          : []
      )
    })

    assert.equal(exportClaims.length, 1)
    assert.deepEqual(exportClaims[0], {
      claim_id: 'claim-approved',
      page: 2,
      global_spot: false,
      target_side: 'left',
      target_y_pct: 36,
      notation_lines: ['Accepted/Locator'],
      claim_text: 'Approved claim',
    })
  })

  it('prefixes notation lines with reference numbers when a claim has multiple references', () => {
    const exportClaims = buildApprovedExportClaims([
      {
        id: 'claim-2',
        page: 4,
        status: 'approved',
        text: 'Multi reference claim',
        position: { x: 78, y: 40 },
        references: [
          { id: 21, number: 1, text: 'Citation One' },
          { id: 22, number: 2, text: 'Citation Two' }
        ]
      }
    ])

    assert.deepEqual(exportClaims[0].notation_lines, [
      '1. Citation One',
      '2. Citation Two'
    ])
  })

  it('uses global and position-aware gutter side rules', () => {
    assert.equal(determineGutterSide({ globalSpot: true, position: { x: 3 } }), 'right')
    assert.equal(determineGutterSide({ position: { x: 12 } }), 'left')
    assert.equal(determineGutterSide({ position: { x: 72 } }), 'right')
    assert.equal(determineGutterSide({}), 'right')
  })
})
