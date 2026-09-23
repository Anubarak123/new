# Verification — September 10, 2026

## Passed automated checks

- `npm run typecheck`: React and Express TypeScript checks.
- `npx prisma validate`: valid PostgreSQL schema.
- `npx prisma migrate deploy`: global-portal migration applied to the local database.
- `npx prisma migrate status`: both committed migrations applied; database up to date.
- `npm test`: three passing PostgreSQL integration tests using disposable schemas.
- `npm run build`: Prisma client generation, Vite production bundle, and Express TypeScript compilation.

The migration regression test creates old Teacher/Assignment/Category/Tool/Attempt records and then applies the new migration. It verifies account preservation, category deduplication/reassociation, historical scores/names, UTC semester boundaries, active-attempt snapshots, and historical survival after live records are deleted.

The workflow integration test verifies:

- Professor login and protection of management, results, and export endpoints.
- Category creation/rename, blank/duplicate rejection, and prevention of deletion while tools exist.
- Tool creation with and without a logo, editing, logo removal, and deletion.
- Actual PNG decode/re-encoding, unique safe filenames, invalid-file and size-limit rejection, and public image serving.
- Valid 5-tool/180-second settings; invalid count/time rejection.
- Trimmed Student names, server-selected unique tools, no correct-answer fields/token hashes in active payloads, and attempt-token access restrictions.
- Saved placements and unchanged expiry on reload, invalid answer rejection, four correct answers plus one unassigned = 4/5 and 80%.
- Server grading, immutable repeated/concurrent submissions, and rejection of later changes.
- Case-insensitive name filtering combined with semester filtering; all six sort options.
- Valid `.xlsx` response parsed with ExcelJS; filtered row count and score cells checked.
- Late answer rejection, server sweep of unattended attempts, and a real one-second quiz deadline.
- Complete historical detail and logo availability after library renaming/deletion.
- Old assignment API returns 404; an empty library makes the quiz unavailable.

The seed regression test verifies a fresh library gets exactly nine sample tools, three categories, six tools per quiz, and 180 seconds. Re-seeding preserves an existing Professor password and customized settings.

## Passed production-browser checks

Ran the compiled application through Express on the local API port:

- Seeded Professor login and clean navigation dashboard.
- Saved global settings to 5 tools / 3 minutes; Student start displayed those settings.
- Started `Browser Verification` and received five tools.
- Dragged Zoom into Communication.
- Refreshed: Zoom remained placed and the countdown continued from the existing deadline.
- Categorized four tools, deliberately left Microsoft Teams unanswered, and submitted.
- Result showed 4/5, 80%, four green correct cards, one red unanswered card, and elapsed time.
- Professor Results search `browser verification`, Fall 2026 filter, and high-to-low score sort produced the matching row.
- Clicked Excel export and opened the Professor result detail. Workbook contents are independently verified by the API test.
- Set a temporary 3-second time limit, started `Browser Timeout Verification`, and observed automatic redirect to an EXPIRED result with 0/5 and 00:03 time used.
- Restored the global settings to **5 tools / 3 minutes**.
- Inspected desktop quiz/dashboard and tablet-width result styling. At 768px, document scroll width equaled viewport width: no horizontal overflow.

The two clearly named browser-verification attempts remain in local Results for review. API/migration tests clean up their own schemas and upload directories. Existing local records were preserved.

## Environment notes

On Windows, a running API process locks Prisma's engine DLL. Stop it before `npm run build` (which runs `prisma generate`) and restart afterward. This workspace also required normal filesystem access for esbuild's ancestor-directory resolution; the production build itself passed.

Render upload persistence limitations and deployment configuration are documented in README. Local uploaded logos require a persistent storage solution before production use.

