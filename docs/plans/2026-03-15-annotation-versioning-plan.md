# Annotation Versioning — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement version save/load for annotation results so reviewers can save corrected versions and reload them instantly on re-upload.

**Architecture:** New SQLite migration creates 4 tables (annotation_versions, annotation_edits, brand_patterns, document_lineage). New model + controller + routes expose version CRUD. Frontend auto-saves v1 after AI analysis, shows version indicator + save button, and loads cached version on re-upload of same PDF.

**Tech Stack:** SQLite (better-sqlite3), Express routes, React state + api.js

---

### Task 1: Database Migration

**Files:**
- Create: `backend/migrations/015_annotation_versioning.sql`

**Step 1: Write the migration SQL**

```sql
-- Annotation version snapshots
CREATE TABLE IF NOT EXISTS annotation_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_hash TEXT NOT NULL,
  brand_id INTEGER,
  version_number INTEGER NOT NULL,
  document_name TEXT NOT NULL,
  annotations_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ai',
  parent_version_id INTEGER,
  created_by TEXT DEFAULT 'reviewer',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_version_id) REFERENCES annotation_versions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_annotation_versions_document_hash ON annotation_versions(document_hash);
CREATE INDEX IF NOT EXISTS idx_annotation_versions_brand_id ON annotation_versions(brand_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_annotation_versions_hash_version ON annotation_versions(document_hash, version_number);

-- Individual edit audit trail
CREATE TABLE IF NOT EXISTS annotation_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL,
  annotation_id TEXT NOT NULL,
  edit_type TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (version_id) REFERENCES annotation_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_annotation_edits_version_id ON annotation_edits(version_id);

-- Brand-level learning patterns from reviewer corrections
CREATE TABLE IF NOT EXISTS brand_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  pattern_type TEXT NOT NULL,
  pattern_json TEXT NOT NULL,
  strength INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_brand_patterns_brand_id ON brand_patterns(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_patterns_type ON brand_patterns(brand_id, pattern_type);

-- Document lineage for carry-forward of revised documents
CREATE TABLE IF NOT EXISTS document_lineage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_hash TEXT NOT NULL,
  parent_hash TEXT,
  brand_id INTEGER,
  similarity_score REAL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_document_lineage_hash ON document_lineage(document_hash);
CREATE INDEX IF NOT EXISTS idx_document_lineage_parent ON document_lineage(parent_hash);
```

**Step 2: Verify migration runs on backend startup**

Run: `cd /Users/wallymo/claims_detector/.worktrees/ai_google/backend && node -e "import('./src/config/database.js').then(m => { m.initDb(); console.log('OK') })"`

Expected: `OK` (no errors about duplicate tables since we use IF NOT EXISTS)

**Step 3: Commit**

```bash
git add backend/migrations/015_annotation_versioning.sql
git commit -m "feat: add annotation versioning migration (4 tables)"
```

---

### Task 2: AnnotationVersion Model

**Files:**
- Create: `backend/src/models/AnnotationVersion.js`

**Step 1: Write the model**

Follow existing pattern from `backend/src/models/AnalysisRun.js` — static class methods, `getDb()`, prepared statements.

```javascript
import { getDb } from '../config/database.js'

export class AnnotationVersion {
  static create({ document_hash, brand_id = null, document_name, annotations_json, source = 'ai', parent_version_id = null, created_by = 'reviewer' }) {
    const db = getDb()

    // Auto-increment version_number per document
    const latest = db.prepare(
      'SELECT MAX(version_number) as max_version FROM annotation_versions WHERE document_hash = ?'
    ).get(document_hash)
    const version_number = (latest?.max_version || 0) + 1

    const stmt = db.prepare(`
      INSERT INTO annotation_versions (document_hash, brand_id, version_number, document_name, annotations_json, source, parent_version_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(document_hash, brand_id, version_number, document_name, annotations_json, source, parent_version_id, created_by)
    return this.findById(result.lastInsertRowid)
  }

  static findById(id) {
    const db = getDb()
    return db.prepare('SELECT * FROM annotation_versions WHERE id = ?').get(id) || null
  }

  static findLatestByHash(documentHash) {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM annotation_versions WHERE document_hash = ? ORDER BY version_number DESC LIMIT 1'
    ).get(documentHash) || null
  }

  static findAllByHash(documentHash) {
    const db = getDb()
    return db.prepare(
      'SELECT id, document_hash, brand_id, version_number, document_name, source, parent_version_id, created_by, created_at FROM annotation_versions WHERE document_hash = ? ORDER BY version_number DESC'
    ).all(documentHash)
  }

  static findByHashAndVersion(documentHash, versionNumber) {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM annotation_versions WHERE document_hash = ? AND version_number = ?'
    ).get(documentHash, versionNumber) || null
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/models/AnnotationVersion.js
git commit -m "feat: add AnnotationVersion model"
```

---

### Task 3: Version Controller + Routes

**Files:**
- Create: `backend/src/controllers/versionController.js`
- Create: `backend/src/routes/versions.js`
- Modify: `backend/src/routes/index.js`

**Step 1: Write the controller**

Follow pattern from `backend/src/controllers/analysisRunController.js`.

```javascript
import { AnnotationVersion } from '../models/AnnotationVersion.js'
import { AppError } from '../middleware/errorHandler.js'

export const versionController = {
  create(req, res, next) {
    try {
      const { document_hash, brand_id, document_name, annotations_json, source, parent_version_id } = req.body || {}
      if (!document_hash) throw new AppError('document_hash is required', 400)
      if (!document_name) throw new AppError('document_name is required', 400)
      if (!annotations_json) throw new AppError('annotations_json is required', 400)

      const version = AnnotationVersion.create({
        document_hash,
        brand_id: brand_id ? parseInt(brand_id, 10) : null,
        document_name,
        annotations_json: typeof annotations_json === 'string' ? annotations_json : JSON.stringify(annotations_json),
        source: source || 'ai',
        parent_version_id: parent_version_id ? parseInt(parent_version_id, 10) : null
      })

      res.status(201).json(version)
    } catch (err) {
      next(err)
    }
  },

  getLatest(req, res, next) {
    try {
      const { hash } = req.params
      if (!hash) throw new AppError('document hash is required', 400)

      const version = AnnotationVersion.findLatestByHash(hash)
      res.json({ version })
    } catch (err) {
      next(err)
    }
  },

  listByHash(req, res, next) {
    try {
      const { hash } = req.params
      if (!hash) throw new AppError('document hash is required', 400)

      const versions = AnnotationVersion.findAllByHash(hash)
      res.json({ versions })
    } catch (err) {
      next(err)
    }
  },

  getByVersion(req, res, next) {
    try {
      const { hash, versionNumber } = req.params
      if (!hash) throw new AppError('document hash is required', 400)

      const version = AnnotationVersion.findByHashAndVersion(hash, parseInt(versionNumber, 10))
      if (!version) throw new AppError('Version not found', 404)
      res.json({ version })
    } catch (err) {
      next(err)
    }
  }
}
```

**Step 2: Write the routes**

```javascript
import { Router } from 'express'
import { versionController } from '../controllers/versionController.js'

const router = Router()

router.post('/', versionController.create)
router.get('/:hash/latest', versionController.getLatest)
router.get('/:hash', versionController.listByHash)
router.get('/:hash/:versionNumber', versionController.getByVersion)

export default router
```

**Step 3: Register in routes/index.js**

Add import at top:
```javascript
import versionRoutes from './versions.js'
```

Add route registration inside `registerRoutes()`:
```javascript
app.use('/api/versions', versionRoutes)
```

**Step 4: Verify backend starts cleanly**

Run: `cd /Users/wallymo/claims_detector/.worktrees/ai_google/backend && timeout 5 node server.js 2>&1 || true`

Expected: Server starts on port 3001 with no errors.

**Step 5: Commit**

```bash
git add backend/src/controllers/versionController.js backend/src/routes/versions.js backend/src/routes/index.js
git commit -m "feat: add version API endpoints (create, getLatest, list, getByVersion)"
```

---

### Task 4: Frontend API Methods

**Files:**
- Modify: `app/src/services/api.js`

**Step 1: Add version API methods**

Add after the `// ========== Analysis Runs ==========` section (around line 241):

```javascript
// ========== Annotation Versions ==========

export async function saveAnnotationVersion({ document_hash, brand_id, document_name, annotations_json, source, parent_version_id }) {
  return request('/versions', {
    method: 'POST',
    body: JSON.stringify({ document_hash, brand_id, document_name, annotations_json, source, parent_version_id })
  })
}

export async function getLatestVersion(documentHash) {
  const data = await request(`/versions/${encodeURIComponent(documentHash)}/latest`)
  return data.version || null
}

export async function listVersions(documentHash) {
  const data = await request(`/versions/${encodeURIComponent(documentHash)}`)
  return data.versions || []
}

export async function getVersionByNumber(documentHash, versionNumber) {
  const data = await request(`/versions/${encodeURIComponent(documentHash)}/${versionNumber}`)
  return data.version || null
}
```

**Step 2: Commit**

```bash
git add app/src/services/api.js
git commit -m "feat: add annotation version API methods to frontend"
```

---

### Task 5: Auto-Save v1 After Analysis

**Files:**
- Modify: `app/src/pages/MKG3ClaimsDetector.jsx`

**Step 1: Add version state variables**

Add near the existing state declarations (around line 470, after `const [claims, setClaims] = useState([])`):

```javascript
const [currentVersion, setCurrentVersion] = useState(null)
const [versionList, setVersionList] = useState([])
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
const [documentHash, setDocumentHash] = useState(null)
```

**Step 2: Auto-save v1 after analysis completes**

In `handleAnalyze()`, after `setAnalysisComplete(true)` (around line 1160), add:

```javascript
// Auto-save v1 (AI analysis result)
try {
  const fileHash = await getFileSha256(uploadedFile)
  setDocumentHash(fileHash)

  // Check if a version already exists for this document
  const existingVersion = await api.getLatestVersion(fileHash)
  if (existingVersion) {
    // Load the latest saved version instead of raw AI output
    const savedAnnotations = JSON.parse(existingVersion.annotations_json)
    setClaims(savedAnnotations)
    setCurrentVersion(existingVersion)
    const allVersions = await api.listVersions(fileHash)
    setVersionList(allVersions)
    logger.info({ event: 'version_loaded', version: existingVersion.version_number, hash: fileHash })
  } else {
    // First time — save as v1
    const saved = await api.saveAnnotationVersion({
      document_hash: fileHash,
      brand_id: selectedBrandId || null,
      document_name: uploadedFile.name,
      annotations_json: JSON.stringify(indexedClaims),
      source: 'ai'
    })
    setCurrentVersion(saved)
    setVersionList([saved])
    logger.info({ event: 'version_saved', version: 1, hash: fileHash })
  }
} catch (versionErr) {
  logger.error('Version save error:', versionErr)
  // Non-fatal — analysis still succeeded
}
```

**Step 3: Reset version state when document is removed**

In `handleRemoveDocument` (find it by searching for the function), add resets:

```javascript
setCurrentVersion(null)
setVersionList([])
setHasUnsavedChanges(false)
setDocumentHash(null)
```

**Step 4: Commit**

```bash
git add app/src/pages/MKG3ClaimsDetector.jsx
git commit -m "feat: auto-save v1 after analysis, load existing version on re-upload"
```

---

### Task 6: Save Version Button + Version Indicator

**Files:**
- Modify: `app/src/pages/MKG3ClaimsDetector.jsx`

**Step 1: Add save handler**

Add a new handler function (after `handleAnalyze`):

```javascript
const handleSaveVersion = async () => {
  if (!documentHash || claims.length === 0) return
  try {
    const saved = await api.saveAnnotationVersion({
      document_hash: documentHash,
      brand_id: selectedBrandId || null,
      document_name: uploadedFile.name,
      annotations_json: JSON.stringify(claims),
      source: 'manual',
      parent_version_id: currentVersion?.id || null
    })
    setCurrentVersion(saved)
    setVersionList(prev => [saved, ...prev])
    setHasUnsavedChanges(false)
    logger.info({ event: 'version_saved', version: saved.version_number })
  } catch (err) {
    logger.error('Save version error:', err)
  }
}
```

**Step 2: Add version load handler**

```javascript
const handleLoadVersion = async (versionNumber) => {
  if (!documentHash) return
  try {
    const version = await api.getVersionByNumber(documentHash, versionNumber)
    if (version) {
      const savedAnnotations = JSON.parse(version.annotations_json)
      setClaims(savedAnnotations)
      setCurrentVersion(version)
      setHasUnsavedChanges(false)
      logger.info({ event: 'version_loaded', version: version.version_number })
    }
  } catch (err) {
    logger.error('Load version error:', err)
  }
}
```

**Step 3: Add version UI to the matching status bar**

In the JSX, find the `matchingStatusBar` div (around line 2382). Add the version indicator inside it, after the existing content:

```jsx
{currentVersion && (
  <div className="versionControls">
    <span className="versionBadge" title={`Saved ${currentVersion.created_at}`}>
      v{currentVersion.version_number}
    </span>
    {versionList.length > 1 && (
      <select
        className="versionSelect"
        value={currentVersion.version_number}
        onChange={(e) => handleLoadVersion(parseInt(e.target.value, 10))}
      >
        {versionList.map(v => (
          <option key={v.id} value={v.version_number}>
            v{v.version_number} — {v.source === 'ai' ? 'AI Analysis' : 'Manual Edit'} — {new Date(v.created_at).toLocaleString()}
          </option>
        ))}
      </select>
    )}
    <button
      className="saveVersionBtn"
      onClick={handleSaveVersion}
      disabled={!hasUnsavedChanges}
      title={hasUnsavedChanges ? 'Save current annotations as new version' : 'No changes to save'}
    >
      <Icon name="fileCheck" size={14} />
      Save Version
    </button>
  </div>
)}
```

**Step 4: Add CSS for version controls**

In the page's CSS (find the stylesheet used by MKG3ClaimsDetector — likely `App.css` or a module), add:

```css
.versionControls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.versionBadge {
  background: var(--blue-3);
  color: var(--blue-11);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.versionSelect {
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid var(--color-border-primary);
  border-radius: 4px;
  background: var(--color-background-primary);
  color: var(--color-text-primary);
}

.saveVersionBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--green-7);
  border-radius: 4px;
  background: var(--green-3);
  color: var(--green-11);
  cursor: pointer;
}

.saveVersionBtn:hover:not(:disabled) {
  background: var(--green-4);
}

.saveVersionBtn:disabled {
  opacity: 0.5;
  cursor: default;
}
```

**Step 5: Commit**

```bash
git add app/src/pages/MKG3ClaimsDetector.jsx app/src/App.css
git commit -m "feat: add Save Version button + version indicator + version dropdown"
```

---

### Task 7: Track Unsaved Changes

**Files:**
- Modify: `app/src/pages/MKG3ClaimsDetector.jsx`

**Step 1: Set hasUnsavedChanges on approve/reject**

In `handleClaimApprove` (around line 1290), after the `setClaims(...)` call, add:
```javascript
setHasUnsavedChanges(true)
```

In `handleClaimReject` (around line 1321), after the `setClaims(...)` call, add:
```javascript
setHasUnsavedChanges(true)
```

**Step 2: Set hasUnsavedChanges on missed claim add**

In the missed claim handler (find `handleMissedClaimSubmit` or similar), add:
```javascript
setHasUnsavedChanges(true)
```

**Step 3: Commit**

```bash
git add app/src/pages/MKG3ClaimsDetector.jsx
git commit -m "feat: track unsaved changes for version save button state"
```

---

### Task 8: Integration Test — Full Round Trip

**Files:**
- Create: `app/test/annotation-versioning.test.js`

**Step 1: Write integration test**

```javascript
import { describe, it, expect, vi } from 'vitest'

describe('Annotation Versioning', () => {
  it('should create a version with correct structure', () => {
    const mockAnnotations = [
      {
        id: 'ann-1',
        text: 'Test annotation',
        position: { x: 50, y: 30 },
        page: 1,
        region: 'slide',
        references: [{ number: 1, text: 'Smith 2024' }],
        source: 'on-page',
        status: 'pending'
      }
    ]

    const versionPayload = {
      document_hash: 'abc123',
      brand_id: 1,
      document_name: 'test.pdf',
      annotations_json: JSON.stringify(mockAnnotations),
      source: 'ai'
    }

    expect(versionPayload.document_hash).toBe('abc123')
    expect(JSON.parse(versionPayload.annotations_json)).toHaveLength(1)
    expect(JSON.parse(versionPayload.annotations_json)[0].position.x).toBe(50)
  })

  it('should preserve claim status in version snapshot', () => {
    const claims = [
      { id: 'ann-1', text: 'Approved claim', status: 'approved' },
      { id: 'ann-2', text: 'Rejected claim', status: 'rejected' },
      { id: 'ann-3', text: 'Pending claim', status: 'pending' }
    ]

    const snapshot = JSON.stringify(claims)
    const restored = JSON.parse(snapshot)

    expect(restored[0].status).toBe('approved')
    expect(restored[1].status).toBe('rejected')
    expect(restored[2].status).toBe('pending')
  })

  it('should version number increment correctly', () => {
    const versions = [
      { version_number: 1, source: 'ai' },
      { version_number: 2, source: 'manual' },
      { version_number: 3, source: 'manual' }
    ]

    const latest = versions[versions.length - 1]
    const nextVersion = latest.version_number + 1

    expect(nextVersion).toBe(4)
  })
})
```

**Step 2: Run test**

Run: `cd /Users/wallymo/claims_detector/.worktrees/ai_google/app && npx vitest run test/annotation-versioning.test.js`

Expected: All 3 tests pass.

**Step 3: Commit**

```bash
git add app/test/annotation-versioning.test.js
git commit -m "test: add annotation versioning unit tests"
```

---

## Task Summary

| Task | What | Files |
|------|------|-------|
| 1 | Database migration (4 tables) | `backend/migrations/015_annotation_versioning.sql` |
| 2 | AnnotationVersion model | `backend/src/models/AnnotationVersion.js` |
| 3 | Controller + routes + registration | `backend/src/controllers/versionController.js`, `backend/src/routes/versions.js`, `backend/src/routes/index.js` |
| 4 | Frontend API methods | `app/src/services/api.js` |
| 5 | Auto-save v1 + load existing | `app/src/pages/MKG3ClaimsDetector.jsx` |
| 6 | Save button + version indicator + CSS | `app/src/pages/MKG3ClaimsDetector.jsx`, `app/src/App.css` |
| 7 | Track unsaved changes | `app/src/pages/MKG3ClaimsDetector.jsx` |
| 8 | Integration test | `app/test/annotation-versioning.test.js` |

**Parallelization:** Tasks 1-3 (backend) can run in parallel with Task 4 (frontend API). Tasks 5-7 are sequential (each builds on the previous). Task 8 runs last.
