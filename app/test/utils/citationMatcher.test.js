import { describe, expect, it } from 'vitest'
import { matchCitationToLibrary } from '../../src/utils/citationLibraryMatcher.js'

// Reference documents fixture — simulates what loadBrandReferences() returns
// with citationMetadata extracted from actual uploaded PDFs
const referenceDocuments = [
  {
    id: 11,
    name: 'Leonhard SE Nat Rev Neurol 2019',
    originalName: 'Leonhard 2019 Nat Rev Neurology',
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
    originalName: 'van den Berg B  Nat Rev Neurol 2014',
    citationMetadata: {
      first_author: 'van',
      year: '2014',
      doi: '10.1038/nrneurol.2014.121',
      author_tokens: ['berg', 'walgaard', 'drenthen', 'fokke', 'jacobs', 'doorn'],
      title_tokens: ['guillain', 'barre', 'syndrome', 'pathogenesis', 'diagnosis', 'treatment', 'prognosis'],
      journal_tokens: ['nat', 'rev', 'neurol']
    }
  },
  {
    id: 30,
    name: 'Bragazzi NL J Neuroinflammation 2021',
    originalName: 'Bragazzi NL J Neuroinflammation 2021',
    citationMetadata: {
      first_author: 'bragazzi',
      year: '2021',
      author_tokens: ['bragazzi', 'kolahi'],
      title_tokens: ['epidemiology', 'guillain', 'barre', 'syndrome'],
      journal_tokens: ['neuroinflammation']
    }
  },
  {
    id: 31,
    name: 'Doets AY Brain 2018',
    originalName: 'Doets AY Brain 2018',
    citationMetadata: {
      first_author: 'doets',
      year: '2018',
      author_tokens: ['doets', 'verboon', 'lingsma'],
      title_tokens: ['regional', 'variation', 'guillain', 'barre', 'syndrome'],
      journal_tokens: ['brain']
    }
  },
  {
    id: 32,
    name: 'Fletcher DD Neurology 2000',
    originalName: 'Fletcher DD Neurology 2000',
    citationMetadata: {
      first_author: 'fletcher',
      year: '2000',
      author_tokens: ['fletcher', 'lawn', 'wolfe'],
      title_tokens: ['long', 'term', 'outcome', 'patients', 'guillain', 'barre'],
      journal_tokens: ['neurology']
    }
  },
  {
    id: 33,
    name: 'Doets AY Ann Neurol 2022',
    originalName: 'Doets AY Ann Neurol 2022',
    citationMetadata: {
      first_author: 'doets',
      year: '2022',
      author_tokens: ['doets'],
      title_tokens: [],
      journal_tokens: ['ann', 'neurol']
    }
  }
]

describe('citationMatcher — PyMuPDF citation strings', () => {
  it('matches "Leonhard SE et al. Nat Rev Neurol . 2019;15(11):671-683."', () => {
    const match = matchCitationToLibrary(
      'Leonhard SE et al. Nat Rev Neurol . 2019;15(11):671-683.',
      referenceDocuments
    )
    expect(match?.id).toBe(11)
  })

  it('matches "van den Berg B et al. Nat Rev Neurol . 2014;10(8):469-482."', () => {
    const match = matchCitationToLibrary(
      'van den Berg B et al. Nat Rev Neurol . 2014;10(8):469-482.',
      referenceDocuments
    )
    expect(match?.id).toBe(54)
  })

  it('matches "Bragazzi NL et al. J Neuroinflammation. 2021;18(1):264."', () => {
    const match = matchCitationToLibrary(
      'Bragazzi NL et al. J Neuroinflammation. 2021;18(1):264.',
      referenceDocuments
    )
    expect(match?.id).toBe(30)
  })

  it('matches "Doets AY et al. Brain . 2018;141(10):2866-2877."', () => {
    const match = matchCitationToLibrary(
      'Doets AY et al. Brain . 2018;141(10):2866-2877.',
      referenceDocuments
    )
    expect(match?.id).toBe(31)
  })

  it('returns null for "Data on file. Annexon Biosciences. 2024."', () => {
    const match = matchCitationToLibrary(
      'Data on file. Annexon Biosciences. 2024.',
      referenceDocuments
    )
    expect(match).toBeNull()
  })

  it('matches "Fletcher DD et al. Neurology . 2000;54:2311-2315."', () => {
    const match = matchCitationToLibrary(
      'Fletcher DD et al. Neurology . 2000;54:2311-2315.',
      referenceDocuments
    )
    expect(match?.id).toBe(32)
  })

  it('disambiguates Doets 2018 (Brain) from Doets 2022 (Ann Neurol) by year', () => {
    const match = matchCitationToLibrary(
      'Doets AY et al. Ann Neurol . 2022;91(1):76-91.',
      referenceDocuments
    )
    expect(match?.id).toBe(33)
  })

  it('handles numbered citation prefix from PyMuPDF notes references', () => {
    const match = matchCitationToLibrary(
      '1. Leonhard SE et al. Nat Rev Neurol . 2019;15(11):671-683.',
      referenceDocuments
    )
    expect(match?.id).toBe(11)
  })

  it('returns null for empty citation text', () => {
    expect(matchCitationToLibrary('', referenceDocuments)).toBeNull()
    expect(matchCitationToLibrary(null, referenceDocuments)).toBeNull()
  })

  it('returns null when reference library is empty', () => {
    const match = matchCitationToLibrary(
      'Leonhard SE et al. Nat Rev Neurol . 2019;15(11):671-683.',
      []
    )
    expect(match).toBeNull()
  })
})
