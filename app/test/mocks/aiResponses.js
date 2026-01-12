/**
 * Mock AI responses for testing
 */

export const mockGeminiResponse = {
  candidates: [{
    content: {
      parts: [{
        text: JSON.stringify({
          claims: [
            {
              claim: 'Reduces cardiovascular events by 47%',
              confidence: 92,
              page: 1,
              x: 25.0,
              y: 14.5
            },
            {
              claim: 'Clinically proven efficacy',
              confidence: 85,
              page: 1,
              x: 30.0,
              y: 35.0
            }
          ]
        })
      }]
    }
  }],
  usageMetadata: {
    promptTokenCount: 1000,
    candidatesTokenCount: 200,
  }
}

export const mockOpenAIResponse = {
  output_text: JSON.stringify({
    claims: [
      {
        claim: 'Reduces cardiovascular events by 47%',
        confidence: 92,
        page: 1,
        x: 25.0,
        y: 14.5
      }
    ]
  }),
  usage: {
    prompt_tokens: 1000,
    completion_tokens: 200
  }
}

export const mockAnthropicResponse = {
  content: [{
    text: `{"claim": "Reduces cardiovascular events by 47%", "confidence": 92, "page": 1, "x": 25.0, "y": 14.5}]}`
  }],
  usage: {
    input_tokens: 1000,
    output_tokens: 200
  }
}

export const mockPDFFile = new File(
  [new ArrayBuffer(1024)],
  'test-document.pdf',
  { type: 'application/pdf' }
)

export const mockFileToBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

export const mockClaims = [
  {
    id: 'claim_001',
    text: 'Reduces cardiovascular events by 47%',
    confidence: 0.92,
    status: 'pending',
    page: 1,
    position: { x: 25.0, y: 14.5 }
  },
  {
    id: 'claim_002',
    text: 'Clinically proven efficacy',
    confidence: 0.85,
    status: 'pending',
    page: 1,
    position: { x: 30.0, y: 35.0 }
  }
]
