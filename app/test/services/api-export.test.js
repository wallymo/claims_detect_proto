import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportMlrAnnotations } from '../../src/services/api.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('exportMlrAnnotations', () => {
  it('posts the active file and current claims snapshot to the MLR export endpoint', async () => {
    const pdfBlob = new Blob(['pdf-output'], { type: 'application/pdf' })
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: () => 'application/pdf'
      },
      blob: vi.fn().mockResolvedValue(pdfBlob)
    })

    global.fetch = mockFetch

    const file = new File(['source-pdf'], 'deck.pdf', { type: 'application/pdf' })
    const claims = [
      { id: 'claim-1', status: 'approved', references: [{ id: 7, number: 1, text: 'Citation' }] }
    ]

    const response = await exportMlrAnnotations({
      file,
      claims,
      documentName: 'deck.pdf',
      brandId: 9,
      documentHash: 'hash-123'
    })

    expect(response).toBe(pdfBlob)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/exports/mlr')
    expect(options.method).toBe('POST')
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('pdf')).toBe(file)
    expect(JSON.parse(options.body.get('claims_json'))).toEqual(claims)
    expect(options.body.get('document_name')).toBe('deck.pdf')
    expect(options.body.get('brand_id')).toBe('9')
    expect(options.body.get('document_hash')).toBe('hash-123')
  })
})
