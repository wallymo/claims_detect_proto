/**
 * API Response Type Definitions
 *
 * Defines response shapes from AI services (Gemini, OpenAI, Anthropic)
 * and the normalizer service.
 */

import { Claim } from './claims';

/**
 * Token usage information for cost tracking
 */
export interface TokenUsage {
  model: string;
  modelDisplayName: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;          // Total cost in USD
  inputRate: number;     // $/1M tokens
  outputRate: number;    // $/1M tokens
}

/**
 * Successful AI analysis response
 */
export interface AnalysisSuccessResponse {
  success: true;
  claims: Claim[];
  usage: TokenUsage;
}

/**
 * Failed AI analysis response
 */
export interface AnalysisErrorResponse {
  success: false;
  error: string;
  claims?: never;
  usage?: never;
}

/**
 * Union type for AI analysis responses
 */
export type AnalysisResponse = AnalysisSuccessResponse | AnalysisErrorResponse;

/**
 * Progress callback for AI analysis
 */
export type ProgressCallback = (progress: number, message: string) => void;

/**
 * Options for AI analysis
 */
export interface AnalysisOptions {
  onProgress?: ProgressCallback;
  customPrompt?: string;
  promptKey?: 'all' | 'drug' | 'disease';
}

/**
 * Normalizer service response for document conversion
 */
export interface NormalizerResponse {
  success: boolean;
  pdfBase64?: string;      // Base64-encoded PDF
  pageImages?: string[];   // Base64-encoded PNGs for each page
  error?: string;
}

/**
 * Raw claim data from AI response (before transformation)
 */
export interface RawAIClaim {
  claim: string;
  confidence: number;      // May be 0-100 or 0-1 depending on AI
  page?: number;
  x?: number;              // Position as % of page width
  y?: number;              // Position as % of page height
}

/**
 * Raw AI response structure
 */
export interface RawAIResponse {
  claims: RawAIClaim[];
}

/**
 * AI Provider types
 */
export type AIProvider = 'gemini' | 'openai' | 'anthropic';

/**
 * API proxy request for AI analysis
 */
export interface AIProxyRequest {
  pdfBase64?: string;
  pageImages?: Array<{ page: number; base64: string }>;
  prompt: string;
  promptKey?: 'all' | 'drug' | 'disease';
  customPrompt?: string;
}

/**
 * API proxy response
 */
export interface AIProxyResponse {
  success: boolean;
  claims?: Claim[];
  usage?: TokenUsage;
  error?: string;
}
