import { describe, expect, it } from 'vitest'
import { matchCitationToLibrary } from '../../src/utils/citationLibraryMatcher.js'

const referenceDocuments = [
  {
    id: 22,
    name: 'Harms M Neurohospitalist 2011',
    originalName: '1770740809740_harms_m_neurohospitalist_2011',
    citationMetadata: {
      first_author: 'harms',
      year: '2011',
      doi: '10.1177/1941875210396379',
      author_tokens: ['matthew', 'harms', 'md'],
      title_tokens: ['inpatient', 'management', 'guillain', 'barre'],
      journal_tokens: ['neurohospitalist']
    }
  },
  {
    id: 11,
    name: 'Leonhard SE Nat Rev Neurol 2019',
    originalName: '1770740809550_leonhard_se_nat_rev_neurol_2019',
    citationMetadata: {
      first_author: 'leonhard',
      year: '2019',
      doi: '10.1038/s41582-019-0250-9',
      author_tokens: ['leonhard', 'mandarakas', 'gondim'],
      title_tokens: ['diagnosis', 'management', 'guillain', 'barre', 'syndrome', 'ten', 'steps'],
      journal_tokens: ['nat', 'rev', 'neurol']
    }
  },
  {
    id: 54,
    name: 'van den Berg B Nat Rev Neurol 2014',
    originalName: '1771115684615_van_doorn_pa_eur_j_neurol_2023',
    citationMetadata: {
      first_author: 'van',
      year: '2014',
      doi: '10.1038/nrneurol.2014.121',
      author_tokens: ['berg', 'walgaard', 'drenthen', 'fokke', 'jacobs', 'doorn'],
      title_tokens: ['guillain', 'barre', 'syndrome', 'pathogenesis', 'diagnosis', 'treatment', 'prognosis'],
      journal_tokens: ['nat', 'rev', 'neurol']
    }
  }
]

describe('citationLibraryMatcher', () => {
  it('matches wrapped notes citations when author and title prefix are present', () => {
    const match = matchCitationToLibrary('1. Harms M. Inpatient management of', referenceDocuments)
    expect(match?.id).toBe(22)
  })

  it('matches truncated full citations before the year line appears', () => {
    const match = matchCitationToLibrary(
      '1. Leonhard SE, Mandarakas MR, Gondim FAA, et al. Diagnosis and management of Guillain',
      referenceDocuments
    )
    expect(match?.id).toBe(11)
  })

  it('matches extracted author lists even when the leading surname is split oddly', () => {
    const match = matchCitationToLibrary(
      '2. v an den Berg B, Walgaard C, Drenthen J, Fokke C, Jacobs BC, van Doorn PA',
      referenceDocuments
    )
    expect(match?.id).toBe(54)
  })

  it('still matches short slide footnotes with author, journal, and year', () => {
    const match = matchCitationToLibrary('1. Harms M. Neurohospitalist. 2011;1(2):78-84.', referenceDocuments)
    expect(match?.id).toBe(22)
  })

  it('does not force a match for data-on-file citations', () => {
    const match = matchCitationToLibrary('5. Data on file. Annexon Biosciences. 2024.', referenceDocuments)
    expect(match).toBeNull()
  })
})
