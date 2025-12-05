export const CLAIM_TYPES = {
  efficacy: { label: 'Efficacy', color: '#2196F3', icon: 'activity' },
  safety: { label: 'Safety', color: '#D32F2F', icon: 'shield' },
  regulatory: { label: 'Regulatory', color: '#F57C00', icon: 'fileCheck' },
  comparative: { label: 'Comparative', color: '#7B1FA2', icon: 'gitCompare' },
  dosage: { label: 'Dosage', color: '#00897B', icon: 'pill' },
  ingredient: { label: 'Ingredient', color: '#388E3C', icon: 'flask' },
  testimonial: { label: 'Testimonial', color: '#C2185B', icon: 'quote' },
  pricing: { label: 'Pricing', color: '#616161', icon: 'dollarSign' }
}

export const MOCK_CLAIMS_BY_DOCUMENT = {
  doc_001: [
    {
      id: 'claim_001',
      text: 'Reduces cardiovascular events by 47% in clinical trials conducted over 24 weeks with 2,500 participants',
      confidence: 0.94,
      type: 'efficacy',
      source: 'core',
      status: 'pending',
      location: { paragraph: 3 }
    },
    {
      id: 'claim_002',
      text: 'FDA approved for adults 18 and older with established cardiovascular disease',
      confidence: 0.91,
      type: 'regulatory',
      source: 'core',
      status: 'pending',
      location: { paragraph: 4 }
    },
    {
      id: 'claim_003',
      text: 'The recommended dosage is 10mg once daily with food',
      confidence: 0.88,
      type: 'dosage',
      source: 'core',
      status: 'pending',
      location: { paragraph: 5 }
    },
    {
      id: 'claim_004',
      text: 'Each tablet contains 10mg of CardioMax active compound (cardiomaxinil)',
      confidence: 0.85,
      type: 'ingredient',
      source: 'core',
      status: 'pending',
      location: { paragraph: 6 }
    },
    {
      id: 'claim_005',
      text: 'Outperforms Lipitor by 23% in LDL reduction measures',
      confidence: 0.76,
      type: 'comparative',
      source: 'core',
      status: 'pending',
      location: { paragraph: 7 }
    },
    {
      id: 'claim_006',
      text: 'May cause mild side effects in approximately 8% of patients',
      confidence: 0.82,
      type: 'safety',
      source: 'core',
      status: 'pending',
      location: { paragraph: 9 }
    },
    {
      id: 'claim_007',
      text: '9 out of 10 of her patients showed improvement within 8 weeks',
      confidence: 0.58,
      type: 'testimonial',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 11 }
    },
    {
      id: 'claim_008',
      text: 'Clinically proven to improve cardiovascular health scores',
      confidence: 0.71,
      type: 'efficacy',
      source: 'core',
      status: 'pending',
      location: { paragraph: 12 }
    },
    {
      id: 'claim_009',
      text: 'CardioMax is priced competitively at $45 per month',
      confidence: 0.89,
      type: 'pricing',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 14 }
    },
    {
      id: 'claim_010',
      text: 'the most affordable branded cardiovascular treatment in its class',
      confidence: 0.67,
      type: 'pricing',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 14 }
    },
    {
      id: 'claim_011',
      text: '84% of participants reporting positive outcomes compared to 61% in the control group',
      confidence: 0.79,
      type: 'efficacy',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 8 }
    },
    {
      id: 'claim_012',
      text: 'No serious adverse events were attributed to the treatment',
      confidence: 0.86,
      type: 'safety',
      source: 'core',
      status: 'pending',
      location: { paragraph: 10 }
    }
  ],
  doc_002: [
    {
      id: 'claim_101',
      text: 'reduced anxiety symptoms by 62% compared to placebo',
      confidence: 0.92,
      type: 'efficacy',
      source: 'core',
      status: 'pending',
      location: { paragraph: 3 }
    },
    {
      id: 'claim_102',
      text: 'provides 24-hour anxiety relief with once-daily dosing',
      confidence: 0.87,
      type: 'efficacy',
      source: 'core',
      status: 'pending',
      location: { paragraph: 4 }
    },
    {
      id: 'claim_103',
      text: 'FDA approval in March 2024 for generalized anxiety disorder in adults',
      confidence: 0.95,
      type: 'regulatory',
      source: 'core',
      status: 'pending',
      location: { paragraph: 5 }
    },
    {
      id: 'claim_104',
      text: 'Less than 3% of patients experienced drowsiness',
      confidence: 0.84,
      type: 'safety',
      source: 'core',
      status: 'pending',
      location: { paragraph: 6 }
    },
    {
      id: 'claim_105',
      text: 'Start with 5mg daily for the first week, then increase to 10mg daily',
      confidence: 0.91,
      type: 'dosage',
      source: 'core',
      status: 'pending',
      location: { paragraph: 7 }
    },
    {
      id: 'claim_106',
      text: 'Contains no gluten, lactose, or artificial colors',
      confidence: 0.78,
      type: 'ingredient',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 8 }
    },
    {
      id: 'claim_107',
      text: 'works faster than leading competitors, with onset of action within 30 minutes',
      confidence: 0.73,
      type: 'comparative',
      source: 'core',
      status: 'pending',
      location: { paragraph: 9 }
    },
    {
      id: 'claim_108',
      text: '78% chose NeuroCalm over their previous anxiety medication',
      confidence: 0.69,
      type: 'comparative',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 9 }
    },
    {
      id: 'claim_109',
      text: 'Leading psychiatrists recommend NeuroCalm as a first-line treatment option',
      confidence: 0.55,
      type: 'testimonial',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 10 }
    },
    {
      id: 'claim_110',
      text: 'Available for $89 per month',
      confidence: 0.88,
      type: 'pricing',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 11 }
    }
  ]
}

export const getClaimsForDocument = (docId) => MOCK_CLAIMS_BY_DOCUMENT[docId] || []

export const getCoreClaimsCount = (docId) => {
  const claims = getClaimsForDocument(docId)
  return claims.filter(c => c.source === 'core').length
}

export const getAIDiscoveredCount = (docId) => {
  const claims = getClaimsForDocument(docId)
  return claims.filter(c => c.source === 'ai_discovered').length
}
