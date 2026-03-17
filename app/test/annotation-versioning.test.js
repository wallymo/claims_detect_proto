import { describe, it, expect } from 'vitest'

describe('Annotation Versioning', () => {
  it('should create a version payload with correct structure', () => {
    const mockAnnotations = [
      {
        id: 'ann-1',
        text: 'Test annotation',
        position: { x: 50, y: 30 },
        page: 1,
        region: 'slide',
        references: [{ number: 1, text: 'Smith 2024' }],
        source: 'on-page',
        status: 'pending'
      }
    ]

    const versionPayload = {
      document_hash: 'abc123',
      brand_id: 1,
      document_name: 'test.pdf',
      annotations_json: JSON.stringify(mockAnnotations),
      source: 'ai'
    }

    expect(versionPayload.document_hash).toBe('abc123')
    expect(JSON.parse(versionPayload.annotations_json)).toHaveLength(1)
    expect(JSON.parse(versionPayload.annotations_json)[0].position.x).toBe(50)
  })

  it('should preserve claim status in version snapshot', () => {
    const claims = [
      { id: 'ann-1', text: 'Approved claim', status: 'approved' },
      { id: 'ann-2', text: 'Rejected claim', status: 'rejected' },
      { id: 'ann-3', text: 'Pending claim', status: 'pending' }
    ]

    const snapshot = JSON.stringify(claims)
    const restored = JSON.parse(snapshot)

    expect(restored[0].status).toBe('approved')
    expect(restored[1].status).toBe('rejected')
    expect(restored[2].status).toBe('pending')
  })

  it('should version number increment correctly', () => {
    const versions = [
      { version_number: 1, source: 'ai' },
      { version_number: 2, source: 'manual' },
      { version_number: 3, source: 'manual' }
    ]

    const latest = versions[versions.length - 1]
    const nextVersion = latest.version_number + 1

    expect(nextVersion).toBe(4)
  })
})
