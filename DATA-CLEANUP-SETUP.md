# Data Cleanup — separate database setup (v694)

## What changed & why
The month-long 90k-row upload crashed because every batch stored all numbers as
one giant JSON blob, and History loaded them all at once → MySQL "Out of sort
memory" + Node out-of-memory. It also shared the CRM/HRMS database, so heavy
cleanup queries could slow everything down.

Fixed by:
1. **Numbers are now individual rows** in a `cleanup_numbers` table (not JSON).
   The detail view is **paginated** (100/page) and filtered/searched in SQL.
2. **Separate database** for all Data Cleanup tables, so CRM/HRMS is never touched.
3. **Chunked inserts** (1,000 at a time) so large uploads keep memory flat.
4. **6-month retention**: per-number detail auto-prunes after 6 months; the
   dedupe cache (phone_checks) and batch summaries are kept forever.

## One-time setup on Railway (to activate the separate DB)

1. In your MySQL service, create the database (runs once):
   ```sql
   CREATE DATABASE qtonix_cleanup CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
   (Use the same MySQL instance your CRM uses — same host/user/pass.)

2. Add ONE environment variable to the app service:
   ```
   CLEANUP_DB_NAME=qtonix_cleanup
   ```
   Optional overrides (default to the main DB's values, so usually not needed):
   `CLEANUP_DB_HOST`, `CLEANUP_DB_USER`, `CLEANUP_DB_PASS`, `CLEANUP_DB_PORT`,
   `CLEANUP_DB_POOL_MAX` (default 6).

3. Redeploy. On boot the app creates `phone_checks`, `cleanup_batches`,
   `cleanup_numbers` in that database automatically. The logs will show
   `[schema] cleanup DB connected: qtonix_cleanup`.

## If you DON'T set CLEANUP_DB_NAME
Everything still works — the cleanup tables are created in the main database
instead (no isolation, but the memory crash is still fixed by the new schema +
pagination). Set the env var whenever you're ready for full isolation.

## Notes
- The old `cleanup_batches` from v691–v693 (with JSON blobs) are in the MAIN DB.
  After moving to the separate DB they won't appear in History (new DB starts
  empty). That's fine — new uploads populate the new DB. The old JSON rows can be
  dropped later: `DROP TABLE` the old `cleanup_batches`/`phone_checks` in the main
  DB once you've confirmed the separate DB is working.
