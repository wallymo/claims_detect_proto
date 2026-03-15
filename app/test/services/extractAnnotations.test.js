import { describe, expect, it } from 'vitest'
import { parseTextAnnotations } from '../../src/services/extractAnnotations.js'

describe('extractAnnotations parser', () => {
  it('splits inline slide footer references that share the same rendered line', () => {
    const parsed = parseTextAnnotations([
      {
        pageNum: 2,
        notesBoundaryY: 48.5,
        lines: [
          { text: '1. Leonhard SE et al. Nat Rev Neurol. 2019;15(11):671-683. 2. van den Berg B et al. Nat Rev Neurol. 2014;10(8):469-482.', y: 43.2, x: 14.2, maxX: 85, refs: [] },
          { text: '5. Data on file. Annexon Biosciences. 2024. 6. Bragazzi NL et al. J Neuroinflammation. 2021;18(1):264.', y: 44.0, x: 14.2, maxX: 85, refs: [] }
        ]
      }
    ])

    expect(parsed.slideFootnotes[2]).toMatchObject({
      1: 'Leonhard SE et al. Nat Rev Neurol. 2019;15(11):671-683.',
      2: 'van den Berg B et al. Nat Rev Neurol. 2014;10(8):469-482.',
      5: 'Data on file. Annexon Biosciences. 2024.',
      6: 'Bragazzi NL et al. J Neuroinflammation. 2021;18(1):264.'
    })
  })

  it('treats numbered doi continuation lines in notes references as part of the current reference', () => {
    const parsed = parseTextAnnotations([
      {
        pageNum: 2,
        notesBoundaryY: 48.5,
        lines: [
          { text: 'Speaker notes', y: 49.2, x: 13.2, maxX: 25, refs: [] },
          { text: 'References', y: 68.3, x: 17.2, maxX: 25, refs: [] },
          { text: '1. Leonhard SE, Mandarakas MR, Gondim FAA, et al. Diagnosis and management of Guillain – Barré syndrome in ten steps.', y: 70.0, x: 17.2, maxX: 90, refs: [] },
          { text: '2. van den Berg B, Walgaard C, Drenthen J, Fokke C, Jacobs BC, van Doorn PA. Guillain – Barré syndrome: pathogenesis, diagnosis, treatment and prognosis.', y: 73.4, x: 17.2, maxX: 90, refs: [] },
          { text: '482. doi:10.1038/nrneurol.2014.121', y: 76.6, x: 29.5, maxX: 60, refs: [] }
        ]
      }
    ])

    expect(parsed.notesReferences[2][2]).toContain('doi:10.1038/nrneurol.2014.121')
    expect(parsed.notesReferences[2][482]).toBeUndefined()
  })
})
