# POC2 Backend Architecture — Brand Repository System

**Created:** 2026-02-09  
**Sprint:** 1 of 3-week POC  
**Status:** Architecture spec (pre-implementation)

---

## Overview

POC2 adds a proper Express backend to the Claims Detector. The current app is frontend-only (direct AI API calls from browser). This backend introduces:

1. **Brand Repository** — Organize reference documents by brand/client
2. **Document Management** — Upload, store, extract text from PDFs/Word docs
3. **Claim Feedback** — Prep table for future MLR review loop (Sprint 2-3)

**Design Philosophy:** Simple, SQLite-based, file-system storage. No Docker, no ORM, no over-engineering. Production-quality patterns that scale when needed.

---

## Project Structure

```
claims_detector/
├── app/                          # Existing React frontend (Vite)
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js       # SQLite connection + init
│   │   │   └── env.js            # Environment config loader
│   │   ├── controllers/
│   │   │   ├── brandController.js
│   │   │   ├── referenceController.js
│   │   │   └── fileController.js
│   │   ├── middleware/
│   │   │   ├── errorHandler.js   # Global error handler
│   │   │   ├── upload.js         # Multer config
│   │   │   └── validate.js       # Request validation
│   │   ├── models/
│   │   │   ├── Brand.js          # Brand data access
│   │   │   ├── Reference.js      # Reference doc data access
│   │   │   └── ClaimFeedback.js  # Claim feedback data access (stub)
│   │   ├── routes/
│   │   │   ├── index.js          # Route aggregator
│   │   │   ├── brands.js         # /api/brands/*
│   │   │   ├── references.js     # /api/brands/:brandId/references/*
│   │   │   └── files.js          # /api/files/*
│   │   ├── services/
│   │   │   ├── textExtractor.js  # PDF + Word text extraction
│   │   │   └── aliasGenerator.js # Filename → display alias
│   │   └── app.js                # Express app setup
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   ├── uploads/                  # Git-ignored, created at runtime
│   │   └── references/
│   │       └── {brandId}/        # Files organized by brand
│   ├── data/                     # Git-ignored
│   │   └── claims_detector.db    # SQLite database file
│   ├── .env.example
│   ├── .env                      # Git-ignored
│   ├── package.json
│   └── server.js                 # Entry point
├── docs/
├── MKG Knowledge Base/
└── ...
```

---

## Database Schema (SQLite)

### File: `backend/migrations/001_initial_schema.sql`

```sql
-- ============================================================
-- Claims Detector POC2 — Initial Schema
-- ============================================================

-- Enable WAL mode for better concurrent read performance
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ---------------------------------------------------------
-- BRANDS
-- ---------------------------------------------------------
-- A brand represents a pharmaceutical product/drug that has
-- reference documents associated with it. Brands belong to
-- a client (the agency's customer).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,                      -- e.g. "Entresto", "Keytruda"
  client      TEXT    NOT NULL DEFAULT '',            -- e.g. "Novartis", "Merck"
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_brands_client ON brands(client);

-- ---------------------------------------------------------
-- REFERENCE DOCUMENTS
-- ---------------------------------------------------------
-- Uploaded files (PDFs, Word docs) that serve as the source
-- of truth for claim verification. Each belongs to a brand.
--
-- filename:      Original filename on disk (backend-only, never sent to frontend)
-- display_alias: Human-friendly name shown in the UI
-- file_path:     Relative path from backend root (e.g. uploads/references/3/doc.pdf)
-- doc_type:      MIME-derived type: 'pdf', 'docx', 'doc', 'txt', 'other'
-- content_text:  Extracted plaintext (for search/RAG, nullable if extraction fails)
-- notes:         User-added notes about this document
-- page_count:    Number of pages (null for non-PDF)
-- file_size_bytes: Raw file size
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS reference_documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id        INTEGER NOT NULL,
  filename        TEXT    NOT NULL,                    -- backend-only (actual file on disk)
  display_alias   TEXT    NOT NULL,                    -- shown in UI
  file_path       TEXT    NOT NULL,                    -- relative path from backend root
  doc_type        TEXT    NOT NULL DEFAULT 'pdf',      -- pdf | docx | doc | txt | other
  content_text    TEXT,                                -- extracted text (nullable)
  notes           TEXT    DEFAULT '',
  page_count      INTEGER,
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  upload_date     TEXT    NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refdocs_brand ON reference_documents(brand_id);
CREATE INDEX IF NOT EXISTS idx_refdocs_type  ON reference_documents(doc_type);

-- ---------------------------------------------------------
-- CLAIM FEEDBACK (prep for Sprint 2-3)
-- ---------------------------------------------------------
-- Records reviewer decisions on individual claims.
-- Links a claim (identified by its AI-generated ID within a
-- detection run) to a reference document that substantiates
-- or contradicts it.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_feedback (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id          TEXT    NOT NULL,                   -- AI-generated claim ID (e.g. "claim_001")
  document_id       TEXT,                               -- Source document being analyzed (nullable)
  reference_doc_id  INTEGER,                            -- Which reference doc was matched
  decision          TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | modified
  modified_text     TEXT,                               -- If reviewer modified the claim text
  reason            TEXT    DEFAULT '',                  -- Reviewer's reasoning
  confidence_score  REAL,                               -- AI confidence at time of review
  reviewer_notes    TEXT    DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (reference_doc_id) REFERENCES reference_documents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_claim    ON claim_feedback(claim_id);
CREATE INDEX IF NOT EXISTS idx_feedback_decision ON claim_feedback(decision);
```

---

## API Endpoint Specifications

**Base URL:** `http://localhost:3001/api`

### Brands

#### `POST /api/brands` — Create brand

```
Request:
{
  "name": "Entresto",
  "client": "Novartis"
}

Response (201):
{
  "id": 1,
  "name": "Entresto",
  "client": "Novartis",
  "created_at": "2026-02-09T19:21:00.000Z"
}

Errors:
  400 — { "error": "Name is required" }
```

#### `GET /api/brands` — List all brands

```
Query params: ?client=Novartis (optional filter)

Response (200):
{
  "brands": [
    {
      "id": 1,
      "name": "Entresto",
      "client": "Novartis",
      "created_at": "2026-02-09T19:21:00.000Z",
      "reference_count": 5
    }
  ]
}
```

#### `GET /api/brands/:id` — Get brand with references

```
Response (200):
{
  "id": 1,
  "name": "Entresto",
  "client": "Novartis",
  "created_at": "2026-02-09T19:21:00.000Z",
  "references": [
    {
      "id": 1,
      "display_alias": "Entresto Phase 3 Trial Results",
      "doc_type": "pdf",
      "page_count": 42,
      "file_size_bytes": 2456789,
      "upload_date": "2026-02-09T19:25:00.000Z",
      "notes": ""
    }
  ]
}

Errors:
  404 — { "error": "Brand not found" }
```

#### `DELETE /api/brands/:id` — Delete brand (cascades to references)

```
Response (200):
{ "message": "Brand deleted", "deletedReferences": 5 }

Errors:
  404 — { "error": "Brand not found" }
```

---

### Reference Documents

All reference endpoints are nested under a brand.

#### `POST /api/brands/:brandId/references` — Upload reference document

```
Request: multipart/form-data
  file: <binary>               (required — PDF or Word doc)
  display_alias: "Trial Data"  (optional — auto-generated from filename if omitted)
  notes: "Phase 3 results"     (optional)

Response (201):
{
  "id": 1,
  "brand_id": 1,
  "display_alias": "Entresto Phase 3 Trial Results",
  "doc_type": "pdf",
  "content_text": "...(first 500 chars)...",
  "notes": "Phase 3 results",
  "page_count": 42,
  "file_size_bytes": 2456789,
  "upload_date": "2026-02-09T19:25:00.000Z"
}

Notes:
  - filename is NEVER returned in any API response
  - file_path is NEVER returned in any API response
  - content_text is truncated in list views, full in detail view
  - Text extraction runs synchronously on upload (acceptable for POC file sizes)

Errors:
  400 — { "error": "No file uploaded" }
  400 — { "error": "Unsupported file type. Accepted: pdf, docx, doc" }
  404 — { "error": "Brand not found" }
  413 — { "error": "File too large. Maximum: 50MB" }
```

#### `GET /api/brands/:brandId/references` — List references for brand

```
Response (200):
{
  "references": [
    {
      "id": 1,
      "brand_id": 1,
      "display_alias": "Entresto Phase 3 Trial Results",
      "doc_type": "pdf",
      "page_count": 42,
      "file_size_bytes": 2456789,
      "upload_date": "2026-02-09T19:25:00.000Z",
      "notes": "",
      "has_content": true
    }
  ]
}

Notes:
  - has_content: boolean indicating if text extraction succeeded
  - content_text NOT included in list (too large) — fetch individual doc for full text
```

#### `GET /api/brands/:brandId/references/:refId` — Get reference detail

```
Response (200):
{
  "id": 1,
  "brand_id": 1,
  "display_alias": "Entresto Phase 3 Trial Results",
  "doc_type": "pdf",
  "content_text": "Full extracted text...",
  "notes": "Phase 3 results",
  "page_count": 42,
  "file_size_bytes": 2456789,
  "upload_date": "2026-02-09T19:25:00.000Z"
}

Errors:
  404 — { "error": "Reference not found" }
```

#### `PATCH /api/brands/:brandId/references/:refId` — Update reference metadata

```
Request:
{
  "display_alias": "Updated Name",    (optional)
  "notes": "Added reviewer notes"     (optional)
}

Response (200):
{
  "id": 1,
  "brand_id": 1,
  "display_alias": "Updated Name",
  "doc_type": "pdf",
  "notes": "Added reviewer notes",
  "page_count": 42,
  "file_size_bytes": 2456789,
  "upload_date": "2026-02-09T19:25:00.000Z"
}

Errors:
  400 — { "error": "No fields to update" }
  404 — { "error": "Reference not found" }
```

#### `DELETE /api/brands/:brandId/references/:refId` — Delete reference

```
Response (200):
{ "message": "Reference deleted" }

Notes:
  - Deletes file from disk
  - Deletes database record

Errors:
  404 — { "error": "Reference not found" }
```

---

### File Serving

#### `GET /api/files/references/:refId` — Serve reference file

```
Response: Binary file with correct Content-Type header

Headers:
  Content-Type: application/pdf (or application/vnd.openxmlformats-officedocument...)
  Content-Disposition: inline; filename="display_alias.pdf"

Notes:
  - Uses display_alias (not real filename) in Content-Disposition
  - Streams file, doesn't load into memory
  - Supports Range requests for PDF viewer compatibility

Errors:
  404 — { "error": "Reference not found" }
  404 — { "error": "File not found on disk" }
```

#### `GET /api/files/references/:refId/text` — Get extracted text only

```
Response (200):
{
  "id": 1,
  "display_alias": "Entresto Phase 3 Trial Results",
  "content_text": "Full extracted text...",
  "page_count": 42
}

Notes:
  - Lightweight endpoint for AI/RAG consumption
  - Returns just the text, no file streaming

Errors:
  404 — { "error": "Reference not found" }
  404 — { "error": "No extracted text available" }
```

---

## Services

### Text Extraction (`services/textExtractor.js`)

```javascript
/**
 * Extract text from uploaded files.
 * 
 * Dependencies:
 *   pdf-parse  — PDF text extraction (uses pdf.js under the hood)
 *   mammoth    — Word (.docx) to text conversion
 * 
 * Returns: { text: string, pageCount: number | null }
 * 
 * Behavior:
 *   - PDF: Extracts all text, returns page count
 *   - DOCX: Converts to plaintext via mammoth, page count = null
 *   - DOC: Falls back to mammoth (limited support for old .doc)
 *   - Other: Returns { text: null, pageCount: null }
 *   - On failure: Logs error, returns { text: null, pageCount: null }
 *     (never throws — a failed extraction shouldn't block upload)
 */

async function extractText(filePath, docType) { ... }
```

### Alias Generator (`services/aliasGenerator.js`)

Converts ugly filenames to readable display names.

```javascript
/**
 * Generate a human-friendly display alias from a filename.
 * 
 * Rules:
 *   1. Strip file extension
 *   2. Replace underscores, hyphens, dots with spaces
 *   3. Remove common prefixes: dates (2024-01-15_), version numbers (v2.1_)
 *   4. Collapse multiple spaces
 *   5. Title-case each word
 *   6. Truncate to 100 chars
 * 
 * Examples:
 *   "2024-01-15_entresto_phase3_trial_results_FINAL_v2.pdf"
 *   → "Entresto Phase3 Trial Results Final"
 * 
 *   "NVS-ENT-0847_clinical-data-summary.docx"
 *   → "Clinical Data Summary"
 *
 *   "PI_Entresto.pdf"
 *   → "PI Entresto"
 */

function generateAlias(filename) { ... }
```

---

## Middleware

### Upload (`middleware/upload.js`)

```javascript
/**
 * Multer configuration for file uploads.
 * 
 * Config:
 *   - Storage: disk (uploads/references/{brandId}/)
 *   - Filename: {timestamp}_{originalname} (for uniqueness)
 *   - File size limit: 50MB
 *   - Allowed types: .pdf, .docx, .doc
 *   - Single file per request (field name: "file")
 */
```

### Error Handler (`middleware/errorHandler.js`)

```javascript
/**
 * Global error handler.
 * 
 * Pattern:
 *   - Operational errors (AppError class) → return error.statusCode + message
 *   - Multer errors → translate to 400/413
 *   - Unknown errors → 500 + generic message (log full error)
 *   - Always return JSON: { error: "message" }
 * 
 * AppError class:
 *   class AppError extends Error {
 *     constructor(message, statusCode = 500) { ... }
 *   }
 */
```

### Validation (`middleware/validate.js`)

```javascript
/**
 * Lightweight request validation (no external library for POC).
 * 
 * Exports:
 *   validateBrandCreate(req, res, next)
 *     - name: required, string, 1-200 chars
 *     - client: optional, string, max 200 chars
 * 
 *   validateReferenceUpdate(req, res, next)
 *     - display_alias: optional, string, 1-100 chars
 *     - notes: optional, string, max 2000 chars
 *     - At least one field required
 * 
 *   validateIdParam(req, res, next)
 *     - Checks :id or :brandId or :refId is a positive integer
 */
```

---

## Configuration

### `backend/.env.example`

```env
# ===========================================
# Claims Detector POC2 — Backend Config
# ===========================================

# Server
PORT=3001
NODE_ENV=development

# Database
DB_PATH=./data/claims_detector.db

# File uploads
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=50

# CORS (frontend URL)
CORS_ORIGIN=http://localhost:5173

# Logging
LOG_LEVEL=info
```

### `backend/package.json`

```json
{
  "name": "claims-detector-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "db:init": "node src/config/database.js --init",
    "db:reset": "node src/config/database.js --reset"
  },
  "dependencies": {
    "better-sqlite3": "^11.x",
    "cors": "^2.x",
    "dotenv": "^16.x",
    "express": "^4.x",
    "mammoth": "^1.x",
    "multer": "^1.x",
    "pdf-parse": "^1.x"
  },
  "devDependencies": {}
}
```

**Why better-sqlite3 over sqlite3:**
- Synchronous API = simpler code (no callback/promise wrapping)
- 2-5x faster for reads
- WAL mode works properly
- Perfect for single-server POC

---

## Database Initialization (`src/config/database.js`)

```javascript
/**
 * SQLite database setup using better-sqlite3.
 * 
 * Behavior:
 *   - Creates data/ directory if missing
 *   - Creates database file if missing
 *   - Runs migrations on startup (idempotent via CREATE IF NOT EXISTS)
 *   - Enables WAL mode and foreign keys
 * 
 * Exports:
 *   db          — better-sqlite3 instance (singleton)
 *   initDb()    — Run migrations, ensure tables exist
 *   resetDb()   — Drop all tables and re-init (dev only)
 * 
 * CLI usage:
 *   node src/config/database.js --init   # Initialize DB
 *   node src/config/database.js --reset  # Reset DB (destructive!)
 */
```

---

## Model Layer (Data Access Pattern)

No ORM. Each model is a plain object with static methods wrapping SQL queries.

### `models/Brand.js`

```javascript
/**
 * Brand data access.
 * 
 * Methods:
 *   Brand.create({ name, client })
 *     → { id, name, client, created_at }
 * 
 *   Brand.findAll({ client? })
 *     → [{ id, name, client, created_at, reference_count }]
 *     Uses LEFT JOIN to count references per brand
 * 
 *   Brand.findById(id)
 *     → { id, name, client, created_at } | null
 * 
 *   Brand.delete(id)
 *     → { deletedReferences: number }
 *     Cascades to reference_documents (FK ON DELETE CASCADE)
 *     Also deletes files from disk (uploads/references/{id}/)
 */
```

### `models/Reference.js`

```javascript
/**
 * Reference document data access.
 * 
 * Methods:
 *   Reference.create({ brand_id, filename, display_alias, file_path, doc_type, content_text, notes, page_count, file_size_bytes })
 *     → { id, brand_id, display_alias, doc_type, notes, page_count, file_size_bytes, upload_date }
 *     NOTE: Never returns filename or file_path
 * 
 *   Reference.findByBrand(brandId)
 *     → [{ id, brand_id, display_alias, doc_type, page_count, file_size_bytes, upload_date, notes, has_content }]
 *     has_content = content_text IS NOT NULL
 * 
 *   Reference.findById(refId)
 *     → Full record including content_text (but NOT filename/file_path)
 *     Internal variant: Reference._findByIdFull(refId) → includes filename + file_path (for file serving)
 * 
 *   Reference.update(refId, { display_alias?, notes? })
 *     → Updated record (same shape as findById)
 * 
 *   Reference.delete(refId)
 *     → { filePath } (caller handles disk deletion)
 */
```

---

## Express App Setup (`src/app.js`)

```javascript
/**
 * Express application factory.
 * 
 * Setup order:
 *   1. JSON body parser (10MB limit for future direct-text endpoints)
 *   2. CORS (allow CORS_ORIGIN, credentials: true)
 *   3. Request logging (simple: method + url + status + time)
 *   4. Routes (/api/brands, /api/files)
 *   5. 404 handler (unknown routes → { error: "Not found" })
 *   6. Global error handler
 * 
 * Does NOT call listen() — that's server.js's job
 */
```

### `server.js` (Entry Point)

```javascript
/**
 * Server entry point.
 * 
 * Steps:
 *   1. Load .env
 *   2. Initialize database (run migrations)
 *   3. Ensure upload directories exist
 *   4. Create app
 *   5. Listen on PORT
 *   6. Graceful shutdown handler (close DB on SIGINT/SIGTERM)
 */
```

---

## Route Wiring

### `routes/index.js`

```javascript
import brandRoutes from './brands.js';
import referenceRoutes from './references.js';
import fileRoutes from './files.js';

export default function registerRoutes(app) {
  app.use('/api/brands', brandRoutes);
  app.use('/api/brands/:brandId/references', referenceRoutes);
  app.use('/api/files', fileRoutes);
}
```

### `routes/brands.js`

```
POST   /                → brandController.create
GET    /                → brandController.list
GET    /:id             → brandController.get
DELETE /:id             → brandController.delete
```

### `routes/references.js`

```
POST   /                → upload.single('file'), referenceController.upload
GET    /                → referenceController.list
GET    /:refId          → referenceController.get
PATCH  /:refId          → referenceController.update
DELETE /:refId          → referenceController.delete
```

Note: Uses `{ mergeParams: true }` on Router to access `:brandId` from parent.

### `routes/files.js`

```
GET    /references/:refId       → fileController.serve
GET    /references/:refId/text  → fileController.getText
```

---

## Error Handling Patterns

### AppError Class

```javascript
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}
```

### Controller Pattern

```javascript
// Every controller method follows this shape:
async function create(req, res, next) {
  try {
    // validate → execute → respond
    const brand = Brand.create({ name, client });
    res.status(201).json(brand);
  } catch (err) {
    next(err); // → global error handler
  }
}
```

### Global Error Handler

```javascript
function errorHandler(err, req, res, next) {
  // Multer file-too-large
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large. Maximum: ${MAX_MB}MB` });
  }
  
  // Operational error (we threw it intentionally)
  if (err.isOperational) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  
  // Unexpected error
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
```

---

## File Upload Flow

```
Client                        Server
  │                              │
  │  POST /api/brands/1/refs     │
  │  multipart/form-data         │
  │  { file, display_alias? }    │
  │─────────────────────────────▶│
  │                              │
  │                    ┌─────────┴──────────┐
  │                    │ 1. Multer saves to  │
  │                    │    uploads/refs/1/  │
  │                    │    {ts}_{original}  │
  │                    │                     │
  │                    │ 2. Detect doc_type  │
  │                    │    from extension   │
  │                    │                     │
  │                    │ 3. Generate alias   │
  │                    │    (if not provided)│
  │                    │                     │
  │                    │ 4. Extract text     │
  │                    │    pdf-parse/mammoth│
  │                    │                     │
  │                    │ 5. Get file stats   │
  │                    │    (size, pages)    │
  │                    │                     │
  │                    │ 6. INSERT into DB   │
  │                    │                     │
  │                    │ 7. Return record    │
  │                    │    (no filename/    │
  │                    │     file_path)      │
  │                    └─────────┬──────────┘
  │                              │
  │◀─────────────────────────────│
  │  201 { id, display_alias,   │
  │        doc_type, ... }       │
```

### File Storage Convention

```
uploads/
└── references/
    ├── 1/                              # brandId = 1
    │   ├── 1739134200_trial_data.pdf
    │   └── 1739134500_prescribing_info.pdf
    └── 2/                              # brandId = 2
        └── 1739135000_safety_review.docx
```

Filename on disk: `{Date.now()}_{sanitizedOriginalName}`

Sanitization: strip non-alphanumeric (except `-`, `_`, `.`), lowercase, truncate to 200 chars.

---

## CORS Setup

```javascript
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));
```

---

## Startup Sequence

```
server.js
  │
  ├── Load dotenv
  ├── Import app.js
  │
  ├── initDb()
  │   ├── Create data/ dir
  │   ├── Open SQLite connection
  │   ├── PRAGMA journal_mode=WAL
  │   ├── PRAGMA foreign_keys=ON
  │   └── Run 001_initial_schema.sql
  │
  ├── Ensure uploads/references/ exists
  │
  ├── app.listen(PORT)
  │   └── "Server running on http://localhost:3001"
  │
  └── process.on('SIGINT', () => db.close())
```

---

## Frontend Integration Notes

### Proxy Setup (Vite)

Add to `app/vite.config.js`:

```javascript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true
    }
  }
}
```

This lets the React app call `/api/brands` without specifying the backend port. In production, a reverse proxy (nginx) would handle this.

### What Frontend Sees vs. Backend Stores

| Field | Stored in DB | Returned in API |
|-------|-------------|-----------------|
| `id` | ✅ | ✅ |
| `brand_id` | ✅ | ✅ |
| `filename` | ✅ | ❌ **Never** |
| `display_alias` | ✅ | ✅ |
| `file_path` | ✅ | ❌ **Never** |
| `doc_type` | ✅ | ✅ |
| `content_text` | ✅ | ✅ (detail only) |
| `notes` | ✅ | ✅ |
| `page_count` | ✅ | ✅ |
| `file_size_bytes` | ✅ | ✅ |
| `upload_date` | ✅ | ✅ |

Frontend accesses files via `/api/files/references/:refId` — it never knows the real path.

---

## Dependencies Summary

| Package | Version | Purpose |
|---------|---------|---------|
| express | ^4.x | HTTP server + routing |
| better-sqlite3 | ^11.x | SQLite driver (sync, fast) |
| cors | ^2.x | CORS middleware |
| dotenv | ^16.x | Environment variables |
| multer | ^1.x | File upload handling |
| pdf-parse | ^1.x | PDF text extraction |
| mammoth | ^1.x | Word doc text extraction |

**Total deps: 7** — intentionally minimal for a POC.

No dev dependencies for Sprint 1 (testing comes Sprint 2).

---

## Security Notes (POC Scope)

These are intentional trade-offs for a 3-week POC:

- **No auth** — Single-user, internal tool
- **No rate limiting** — Not exposed to internet
- **No input sanitization beyond basic validation** — SQLite parameterized queries handle injection
- **No HTTPS** — Localhost only
- **File type validation by extension only** — No MIME sniffing (acceptable for internal uploads)

### What IS handled:

- ✅ Parameterized SQL queries (no injection)
- ✅ File size limits (50MB)
- ✅ File type whitelist (.pdf, .docx, .doc)
- ✅ `filename` and `file_path` never exposed to frontend
- ✅ Graceful error handling (no stack traces to client)
- ✅ Foreign key cascades (no orphaned records)

---

## Sprint Implementation Order

### Sprint 1 (This Week): Foundation
1. Scaffold `backend/` directory
2. `package.json` + install deps
3. Database config + migration
4. Brand model + routes + controller
5. Test with curl/Postman
6. Reference upload (multer + text extraction)
7. Reference CRUD endpoints
8. File serving

### Sprint 2: Integration
- Connect frontend brand selector to backend
- Reference document picker in analysis view
- Claim feedback table endpoints

### Sprint 3: Polish
- Error states in UI
- Feedback loop (approve/reject claims against references)
- Basic search across extracted text

---

## Quick Test Commands

```bash
# Start backend
cd backend && npm run dev

# Create a brand
curl -X POST http://localhost:3001/api/brands \
  -H "Content-Type: application/json" \
  -d '{"name": "Entresto", "client": "Novartis"}'

# List brands
curl http://localhost:3001/api/brands

# Upload a reference
curl -X POST http://localhost:3001/api/brands/1/references \
  -F "file=@/path/to/document.pdf" \
  -F "notes=Phase 3 trial data"

# List references for brand
curl http://localhost:3001/api/brands/1/references

# Serve file
curl http://localhost:3001/api/files/references/1 --output test.pdf

# Get extracted text
curl http://localhost:3001/api/files/references/1/text
```

---

*Architecture by Claims Detector POC2 Team — Sprint 1, Feb 2026*
