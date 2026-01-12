import test from 'node:test'
import assert from 'node:assert/strict'
import { addGlobalIndices, enrichClaimsWithPositions } from '../../src/utils/textMatcher.js'

test('addGlobalIndices preserves original order and assigns global indices by page', () => {
  const claims = [
    { id: 'a', page: 2 },
    { id: 'b', page: 1 },
    { id: 'c', page: 2 }
  ]

  const result = addGlobalIndices(claims)

  assert.equal(result.length, 3)
  assert.equal(result[0].id, 'a')
  assert.equal(result[1].id, 'b')
  assert.equal(result[2].id, 'c')

  assert.equal(result[0].globalIndex, 2)
  assert.equal(result[1].globalIndex, 1)
  assert.equal(result[2].globalIndex, 3)
})

test('enrichClaimsWithPositions falls back when no extracted pages exist', () => {
  const claims = [
    { id: 'c1', text: 'Example claim', page: 1 },
    { id: 'c2', text: 'Another claim', page: 2 }
  ]

  const result = enrichClaimsWithPositions(claims, [])

  assert.equal(result.length, 2)
  assert.equal(result[0].position.source, 'fallback')
  assert.equal(result[1].position.source, 'fallback')
  assert.equal(result[0].position.x, 12)
  assert.equal(result[0].position.y, 12)
  assert.equal(result[1].position.y, 21)
})
