# Digital Tools Quiz

A local-first role-based quiz portal built with React, TypeScript, Express, PostgreSQL, Prisma, and @dnd-kit. One global tool library, one category library, and one quiz configuration serve every student.

For a code walkthrough, API reference, and transfer instructions, see [Developer Handoff](DEVELOPER_HANDOFF.md).

## Local setup

Requirements: Node.js 22.12+ and PostgreSQL (or Docker Desktop).

Run from the repository root:

```sh
npm ci
# Copy .env.example to .env and set your own JWT_SECRET (32+ characters).
docker compose up -d
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Open the Vite URL shown in the terminal (normally http://localhost:5173). Vite forwards `/api` and `/uploads` to the API port configured in `.env`. An existing PostgreSQL installation also works: set `DATABASE_URL` and skip Docker. Database data persists in the Compose volume; stopping the database does not erase it.

The optional, idempotent seed creates:

- **Development only:** username `professor`, password `professor123`.
- Communication: Zoom, Microsoft Teams, Google Meet.
- Storage: OneDrive, Dropbox, Google Drive.
- Learning Management: Blackboard, Canvas, Moodle.
- Six tools per quiz and 180 seconds when the library is initially empty or no settings exist.

Seeding preserves existing records and passwords, and preserves settings when the library already contains tools. Set `PROFESSOR_USERNAME`, `PROFESSOR_PASSWORD`, and `PROFESSOR_NAME` to customize the account. Production seeding requires an explicit non-default password. Do not deploy the development account/password.

## Product flow

The home page links to Professor and Student flows.

Professor signs in at `/professor/login`, then uses `/professor` for navigation:

- `/professor/tools` and `/professor/tools/new`: list, add, edit, delete tools; optional logo uploads.
- `/professor/tools/:id/edit`: replace or remove a logo and change the tool's category.
- `/professor/categories`, `/professor/categories/new`, `/professor/categories/:id/edit`: manage category names. Names are unique ignoring case and surrounding whitespace. Categories containing tools cannot be deleted.
- `/professor/settings`: tool count and time in minutes; seconds are persisted. The count cannot exceed the available library. Deleting tools may make existing settings unplayable; the Student page clearly disables Start until the Professor adjusts them.
- `/professor/results`: all attempts, case-insensitive student search, stored semester filter, six sort options, and filtered Excel export.
- `/professor/results/:attemptId`: snapshot-based historical detail. In-progress attempts show their status until graded.

Students enter a trimmed, nonempty name at `/student`. The server randomly selects exactly the configured tool count, saves the selection/order, and redirects to `/student/quiz/:attemptId`. Tools can be dragged or assigned with accessible category menus, including returning to the unassigned area. Submit redirects to `/student/results/:attemptId`, showing correct/incorrect answers, score, percentage, and elapsed time.

Every unassigned tool is incorrect: the denominator is the complete selected tool count.

## Timing, grading, and integrity

- Random selection uses cryptographic Fisher–Yates shuffling on the server. Active payloads contain neither correct category IDs/names nor correctness flags.
- Every move is immediately saved to PostgreSQL. The UI disables interaction during saves, reports errors, and restores server state. Manual submission also sends the current selections.
- Persisted `startedAt` and `expiresAt` drive the countdown, with a server-clock offset. Refresh restores the same attempt, selections, and deadline. A resume link is available on the Student page.
- At zero, the UI disables changes and submits. The backend rejects changes received after the deadline and grades the last persisted answers. Unsaved network requests cannot be accepted after expiry.
- Expired attempts use **EXPIRED**, with a complete stored score and `submittedAt` equal to `expiresAt`. Normal attempts use **SUBMITTED**. Both have the same result format.
- A one-second server sweep grades expired attempts even when the browser is closed. Reads, answer writes, and submission also check expiry. Row locks serialize grading and answer changes; repeated submission is idempotent.
- The global library lock serializes management changes with quiz creation. Each attempt snapshots the category list and each tool's name, logo path, correct category ID/name, selected category ID/name, and display order. These snapshots are independent of live tool/category foreign keys.
- Semester and year are calculated once using the **UTC attempt start date**: January–May SPRING, June–August SUMMER, September–December FALL. Historical display and filtering use these stored values.
- Professor management and result/export endpoints require an eight-hour JWT and an existing Professor account. Passwords are bcrypt-hashed. Students receive a random 256-bit attempt capability; only its SHA-256 hash is stored. Knowing an attempt ID grants no access.
- Student capability tokens and the Professor JWT are stored in browser local storage. Recovery requires the same browser profile; clearing storage removes Student access. No Student account, name verification, or retake restriction is included.

## Logo storage

Uploads accept PNG, JPEG, or WebP, up to 2 MB and 20 megapixels. The server checks MIME type and decoded image format, strips metadata by re-encoding, resizes to at most 512×512, and stores WebP under a random UUID filename. Original filenames are never used.

`server/src/storage.ts` is the storage adapter. Local files default to `server/uploads/tools/`, independent of whether the server starts from the root or server workspace. Set `UPLOAD_DIR` to use a different directory. Express serves the returned `/uploads/tools/...` paths; Vite proxies those paths in development.

Files are immutable and deliberately retained after logo replacement, removal, or tool deletion so old attempt snapshots keep working. A future cleanup job must check snapshot references before deleting images. Failed database writes may leave an unused image file.

**Render free service filesystems are ephemeral. Local uploaded logos may disappear on restart/redeploy and are not a long-term production storage solution. Use persistent object storage or a persistent disk before production use.** Replacing the adapter with external storage does not require rewriting tool business logic. Back up both PostgreSQL and logo storage.

## Migration from the previous MVP

`20260910010000_global_portal` removes the assignment data model and routes after migrating data:

- Existing Teacher accounts become Professors; their existing email becomes the username, and passwords remain valid.
- All tools enter the global library. Duplicate category names (case-insensitive, trimmed) merge, and live tools are associated with the retained category.
- Existing attempts retain their tokens, scores, selected tools, and answers. The migration populates historical tool/category snapshots and stores the original category list before removing foreign keys. In-progress migrated attempts remain gradable from their snapshots.
- A singleton configuration is initialized to up to six available tools (one if empty, which remains unavailable) and 180 seconds.
- Assignment titles/codes and publishing state are removed. Old assignment/play routes are no longer available. Migrated Student attempts use the new `/student/quiz/:attemptId` route and existing stored attempt tokens.

Back up a database before applying structural migrations in a deployed environment. The committed initial migration remains as migration history for clean installations.

## Configuration

See `.env.example`. Existing environment variables override `.env`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL |
| `PORT` | API listening port, default 3001; Render supplies its own |
| `JWT_SECRET` | Required signing secret, at least 32 characters |
| `CLIENT_URL` | Allowed browser origin |
| `NODE_ENV` | `production` enables serving the compiled React SPA |
| `PROFESSOR_USERNAME`, `PROFESSOR_PASSWORD`, `PROFESSOR_NAME` | Optional seed account configuration |
| `UPLOAD_DIR` | Optional logo storage directory |
| `API_PROXY_TARGET` | Optional custom Vite development API target |
| `TRUST_PROXY_HOPS` | Trusted reverse proxy count; set 1 for Render, leave unset locally |

## Verification

```sh
npm run typecheck
npx prisma validate
npx prisma migrate deploy
npm test
npm run build
```

The integration suite uses a randomly named temporary schema in the configured PostgreSQL database, applies committed migrations, and removes only that schema and its test upload directory afterward. The database role must be allowed to create schemas. Tests cover login/authorization, CRUD, upload validation, settings, answer secrecy, exact selection count, saved-answer recovery, grading with unanswered tools, concurrent submission, filtering, Excel parsing, expiry, and historical integrity after library deletion. See `VERIFICATION.md` for the latest checks.

## Render deployment

Deploy the repository as one Node Web Service backed by PostgreSQL:

- Build: `npm ci && npm run build`
- Start: `npx prisma migrate deploy && npm start`
- Set `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `CLIENT_URL` to the service origin, and `TRUST_PROXY_HOPS=1`.
- Health check: `/api/health`.
- Run the seed only if desired, with a strong configured Professor password. The development defaults are not production credentials.

Express binds to `0.0.0.0`, honors the platform's port, serves the REST API and `client/dist`, and falls back to the SPA for deep links. No separate frontend hosting is required. Resolve the upload persistence limitation above before relying on deployed logos.

