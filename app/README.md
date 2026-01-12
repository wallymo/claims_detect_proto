# Claims Detector App

## Overview
- Front-end application for detecting promotional claims in pharmaceutical documents.
- Built with React + Vite and multiple AI providers (Gemini, OpenAI, Anthropic).
- Two main routes:
  - `/` Demo UI that uses mock documents/claims.
  - `/mkg` Live analysis flow (PDF/DOCX/PPTX) with AI provider selection.

## Architecture
- UI: `src/pages` and `src/components` (atoms/molecules + feature components).
- AI providers: `src/services` (Gemini, OpenAI, Anthropic) with shared prompt definitions.
- Document normalization: `src/services/normalizer` (requires the sibling `normalizer-service`).
- PDF utilities: `src/utils` (text extraction, image conversion, matching).
- Demo data: `src/mocks` (used by the Home demo page only).

## Setup
- Prerequisites:
  - Node.js 20.x
  - npm 9+
- Environment:
  - Copy `../.env.example` to `./.env.local` and fill in API keys.
  - `VITE_NORMALIZER_URL` should point to the normalizer service (default: http://localhost:3001).

## Run
- `npm install`
- `npm run dev` (runs the Vite app and the normalizer service from `../normalizer-service`)
- `npm run dev:app` (runs the Vite app only)

## Test
- `npm test` (Node test runner for core utilities).

## Build
- `npm run build`
- `npm run preview`

## Security and Operations
- AI provider API keys are currently used in the browser. For production, move provider calls to a backend proxy and remove keys from client-side code.
- Use `VITE_LOG_LEVEL` to control client logging (`error`, `warn`, `info`, `debug`).

## Contributing
See CONTRIBUTING.md.
