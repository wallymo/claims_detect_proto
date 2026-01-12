/**
 * Type definitions for Claims Detector
 *
 * This file defines the core claim schema used throughout the application.
 */

/**
 * Claim types based on regulatory categories
 */
export type ClaimType =
  | 'efficacy'      // Therapeutic efficacy assertions
  | 'safety'        // Safety and side effect statements
  | 'regulatory'    // FDA approval, regulatory status
  | 'comparative'   // Comparisons to competitors/alternatives
  | 'dosage'        // Dosing and administration
  | 'ingredient'    // Active ingredients and formulation
  | 'testimonial'   // Patient/doctor testimonials
  | 'pricing';      // Cost and pricing claims

/**
 * Claim review status
 */
export type ClaimStatus = 'pending' | 'approved' | 'rejected';

/**
 * Source of claim detection
 */
export type ClaimSource = 'core' | 'ai_discovered';

/**
 * Position of claim on page (x/y as percentage 0-100)
 */
export interface ClaimPosition {
  x: number;  // Horizontal position as % of page width
  y: number;  // Vertical position as % of page height
}

/**
 * Location information for a claim
 */
export interface ClaimLocation {
  paragraph?: number;
}

/**
 * Core claim schema
 */
export interface Claim {
  id: string;
  text: string;
  confidence: number;        // 0.0 to 1.0
  type?: ClaimType;
  status: ClaimStatus;
  source?: ClaimSource;
  page?: number;             // Page number (1-indexed)
  position?: ClaimPosition;  // Position on page (null if unavailable)
  location?: ClaimLocation;  // Legacy paragraph-based location
}

/**
 * Claim type metadata for UI display
 */
export interface ClaimTypeMetadata {
  label: string;
  color: string;
  icon: string;
}

/**
 * Map of claim types to their display metadata
 */
export type ClaimTypeMap = Record<ClaimType, ClaimTypeMetadata>;
