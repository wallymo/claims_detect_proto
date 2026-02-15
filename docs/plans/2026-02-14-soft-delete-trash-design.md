# Soft Delete / Trash for References

**Date:** 2026-02-14
**Goal:** When a user deletes a reference, it moves to a "Trash" state instead of being permanently removed. From Trash, the user can restore to the main library or permanently delete.

## Approach

Add a `deleted_at` timestamp column to `reference_documents`. Deletion sets the timestamp; restore clears it. All existing queries filter on `deleted_at IS NULL`. A "Trash" entry in the folder tree shows soft-deleted refs.

## Database

**Migration `004_soft_delete.sql`:**
- `ALTER TABLE reference_documents ADD COLUMN deleted_at DATETIME NULL`
- `CREATE INDEX idx_reference_documents_deleted_at ON reference_documents(deleted_at)`

**Model changes (`Reference.js`):**
- `findByBrand(brandId)` — add `AND rd.deleted_at IS NULL`
- New `findDeleted(brandId)` — `WHERE rd.brand_id = ? AND rd.deleted_at IS NOT NULL`
- New `softDelete(id)` — `SET deleted_at = CURRENT_TIMESTAMP`
- New `bulkSoftDelete(ids)` — same for multiple
- New `restore(id)` — `SET deleted_at = NULL, folder_id = NULL`
- New `bulkRestore(ids)` — same for multiple
- Rename existing `delete(id)` to `permanentDelete(id)` — hard delete from DB + filesystem
- New `bulkPermanentDelete(ids)` — hard delete multiple

Restored docs go to "All Files" (`folder_id = NULL`).

## Backend API

**Updated (soft delete replaces hard delete):**
- `DELETE /api/brands/:brandId/references/:refId` — sets `deleted_at`
- `POST /api/brands/:brandId/references/bulk-delete` — sets `deleted_at` for all ids

**New endpoints:**
- `GET /api/brands/:brandId/references/trash` — returns soft-deleted refs
- `POST /api/brands/:brandId/references/restore` — body: `{ ids: [...] }`, clears `deleted_at`, sets `folder_id = NULL`
- `DELETE /api/brands/:brandId/references/permanent` — body: `{ ids: [...] }`, hard deletes from DB + filesystem

No changes to fact extraction, file serving, or feedback endpoints.

## Frontend

### API client (`api.js`)
- `fetchTrash(brandId)` — `GET /api/brands/:brandId/references/trash`
- `restoreReferences(brandId, ids)` — `POST /api/brands/:brandId/references/restore`
- `permanentDeleteReferences(brandId, ids)` — `DELETE /api/brands/:brandId/references/permanent`
- Existing `deleteReference` and `bulkDeleteReferences` unchanged (backend now soft-deletes)

### Folder tree (LibraryTab)
- **Trash** item pinned at bottom of folder tree, below user folders
- Trash icon, count badge: `Trash (3)`
- Clicking sets `activeFolderId` to `'__trash__'`
- Hidden when trash count is 0

### List view in Trash mode
- Same `ReferenceListItem` cards, read-only (no rename/edit)
- Individual actions: **Restore** (undo icon) and **Delete Forever** (trash icon)
- `Delete Forever` uses `window.confirm` with "This cannot be undone" warning

### Bulk actions in Trash mode
- Select-all checkbox works the same
- Actions: **Restore Selected** and **Delete Forever**
- "Move to..." dropdown hidden

### State (MKG2ClaimsDetector)
- New `trashDocuments` array loaded alongside `referenceDocuments`
- `loadReferences()` also fetches trash count for badge
- Restore: moves doc from `trashDocuments` to `referenceDocuments`
- Permanent delete: removes from `trashDocuments`

### No changes to
Claims tab, detection, matching, settings panel, brand modal. Trash is purely a Library tab concern.
