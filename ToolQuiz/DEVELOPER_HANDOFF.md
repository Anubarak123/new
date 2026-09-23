# Digital Tools Quiz — Developer Handoff

Prepared on September 20, 2026 from the source files in this workspace.

## Start here

This is a working full-stack quiz application for learning how digital tools are categorized. A Professor manages a shared tool library, categories, quiz settings, and results. Students enter a name and sort randomly selected tools into categories before a timer expires. The server saves answers and calculates results.

Read this document for implementation details, `README.md` for setup and product behavior, and `VERIFICATION.md` for the earlier verification record. Suggested source reading order: `prisma/schema.prisma`, `server/src/attempts.ts`, `server/src/app.ts`, then `client/src/main.tsx`.

## Handoff package and data boundary

The accompanying source archive includes the client, server, tests, Prisma schema and both migrations, seed script, dependency lockfile, Docker Compose configuration, environment example, documentation, and the logo file currently present under `server/uploads/tools`.

It excludes `.env`, installed dependencies, generated builds, `.local` (including local PostgreSQL files), and Git metadata. Install dependencies with `npm ci`; create a new `.env` from `.env.example`. The archive is sufficient to inspect the implementation and run a fresh instance with sample data.

**The archive is not a backup of the current running instance.** Existing accounts, categories, tools, settings, and student attempts live in PostgreSQL and are not included. The seed creates sample data; it does not reproduce current records. Uploaded images alone do not recreate database records.

If the existing instance must also move, transfer a PostgreSQL logical backup and all files from the configured `UPLOAD_DIR` separately, through an appropriate private channel. Use `pg_dump` against the source database and `pg_restore` into a new empty target database, then apply any pending committed migrations. Coordinate a maintenance window so the database and image copy represent a consistent state. Configure new environment secrets at the destination. Do not copy a live PostgreSQL data directory as a portable backup. Browser-local student tokens are separate from the database and are not transferred by a database restore.

## Architecture

```text
Browser: React SPA + React Router + dnd-kit
    | fetch /api (JSON; multipart for images)
    v
Express API: authentication, validation, library management, reports
    |                         |
    v                         v
Prisma -> PostgreSQL          Sharp -> local immutable WebP images
    ^
Server timer: expire and grade overdue attempts every second
```

The root package uses npm workspaces for `client` and `server`. TypeScript and ES modules are used throughout. The main stack is React 19, React Router 7, Vite 7, Express 5, Prisma 6.19, and PostgreSQL; Docker Compose specifies PostgreSQL 17. `package-lock.json` records the resolved dependency versions.

During development, Vite proxies `/api` and `/uploads` to Express. In production, Express serves `client/dist` as well as the API and images. Run production commands from the repository root because SPA paths are resolved from the working directory. There is no separate queue service, external authentication provider, or frontend state management package.

## Source map

| File or directory | Responsibility |
| --- | --- |
| `client/src/main.tsx` | Frontend types, fetch helper, routing, forms, quiz interaction, timer, and result pages |
| `client/src/style.css` | Application styling and responsive layouts |
| `client/vite.config.ts` | React plugin and development API/image proxy |
| `server/src/index.ts` | Database connection, HTTP listener, expiry sweep, shutdown handlers |
| `server/src/app.ts` | Express middleware, authentication, API routes, input validation, Excel export, error handling, production SPA hosting |
| `server/src/attempts.ts` | Random sampling, token hashing, semester calculation, row locking, grading, response serialization, expiry processing |
| `server/src/db.ts` | Root `.env` loading and shared Prisma client |
| `server/src/storage.ts` | Image validation, conversion, and filesystem storage adapter |
| `prisma/schema.prisma` | Current database models and Prisma client configuration |
| `prisma/migrations/` | Initial schema and transition from the old assignment-based MVP |
| `prisma/seed.ts` | Optional Professor account and sample library creation |
| `server/test/` | Workflow, migration, and seed integration tests |
| `docker-compose.yml` | Local PostgreSQL service with a persistent named volume |

The frontend and API are intentionally concentrated in two large files. There are no separate controller/service or page directories yet. Frontend and server request types are maintained separately; there is no generated shared API contract.

## Database design

| Model | Meaning and relationships |
| --- | --- |
| `Professor` | Username, bcrypt password hash, display name, creation time |
| `Category` | Global category with many tools |
| `Tool` | Name, optional logo path, required category; category deletion is restricted while tools reference it |
| `QuizSettings` | Singleton row with ID 1, tools per quiz, and time limit in seconds |
| `Attempt` | Student name, hashed capability token, category snapshot, timestamps, stored semester/year, status, totals, and score |
| `AttemptTool` | One selected tool snapshot and its answer; belongs to an attempt with cascade deletion |

`AttemptTool.toolId` and the snapshot category IDs are deliberately not foreign keys to the current library. A renamed or deleted tool/category must not rewrite historical results or prevent an existing attempt from being graded. Names, logo paths, correct answers, chosen answers, and tool order are preserved on the attempt.

Some database rules live in migration SQL rather than the Prisma model syntax: the unique category index uses `lower(trim(name))`, and settings have singleton and positive-value checks. Preserve these when changing migrations. Use the committed migrations for a fresh installation; do not substitute `prisma db push` for the migration history.

## Frontend implementation

`Shell` defines all routes. `Protected` checks `/api/professor/session` before rendering management pages. `Library` and `RecordForm` handle both tools and categories. `QuizSettings`, `Results`, `Join`, `Play`, and `ResultPage` implement their respective screens. `ResultDetail` is shared by Student and Professor result views.

The `api()` helper prefixes requests with `/api`, encodes JSON or accepts `FormData`, supplies authentication headers, and converts API errors into exceptions. `useLoad()` fetches data when its URL changes and prevents obsolete responses from updating state. Components use React state and refs rather than a global store.

Browser storage keys are `professor-token`, `attempt-token:<attemptId>`, and `active-attempt`. The first holds the Professor JWT, the second a Student capability token, and the third a resume pointer. Clearing storage or switching browser profiles removes access to those Student attempts. A database restore cannot reconstruct the original plain tokens from their hashes.

`Play` uses dnd-kit draggable tool cards and droppable zones, with pointer and keyboard sensors. Each card also has a category select menu. Moving to the unsorted zone sends a null category. An in-flight ref prevents overlapping writes; controls remain disabled until the save completes. The returned server state replaces local attempt state. A failed move reports an error and attempts a refresh.

## Attempt lifecycle and invariants

1. `POST /api/student/start` validates a trimmed student name and checks current settings inside the library transaction lock.
2. The server performs Fisher–Yates shuffling using Node's cryptographic `randomInt`, selects exactly the configured number of tools, and stores all category and selected-tool snapshots with a fixed deadline.
3. The response contains an attempt ID and a newly generated 32-byte capability token. Only its SHA-256 hash is stored in PostgreSQL.
4. `GET /api/attempts/:id` restores the persisted state. The serializer omits correct answers and correctness flags while the attempt is active.
5. Each move immediately updates an `AttemptTool` row. Category IDs must belong to that attempt's category snapshot.
6. Manual submission includes the current answers. The backend grades once and stores the result. Unassigned tools count as incorrect; the denominator is all selected tools.
7. A submission at or after the deadline grades the last persisted answers and produces `EXPIRED`. An earlier submission produces `SUBMITTED`. Later submissions return the stored result; answer edits after completion return HTTP 409.

`lockedAttempt()` uses a PostgreSQL `SELECT ... FOR UPDATE` transaction so answer writes and grading for the same attempt cannot race. Library edits, settings changes, and quiz creation share PostgreSQL advisory transaction lock `6332026` to ensure a consistent starting snapshot.

The browser updates its countdown every 250 ms using an offset derived from `serverNow`. It disables interaction at zero and schedules automatic submission, retrying after failures. Server time remains authoritative. The server checks expiry on attempt operations and processes up to 100 expired attempts per sweep every second; result listing/export also invokes expiry processing.

Percentage is rounded to one decimal place. Time used is rounded to whole seconds. For expired attempts, `submittedAt` is the deadline. Semester is stored from the UTC start date: January–May is SPRING, June–August SUMMER, September–December FALL.

## API reference

All paths below start with `/api`. Professor routes require `Authorization: Bearer <jwt>`. Student attempt reads/writes use `X-Attempt-Token: <token>`. A Professor may read an attempt but cannot replace the Student capability for answer writes or submission.

| Method | Path | Purpose / request |
| --- | --- | --- |
| GET | `/health` | Database-backed health check |
| POST | `/auth/login` | `{ username, password }` -> `{ token, name }` |
| GET | `/professor/session` | Validate current Professor session |
| GET / POST | `/professor/categories` | List categories / create with `{ name }` |
| PUT / DELETE | `/professor/categories/:id` | Rename with `{ name }` / delete empty category |
| GET / POST | `/professor/tools` | List tools / create tool |
| PUT / DELETE | `/professor/tools/:id` | Update / delete tool |
| GET / PUT | `/professor/settings` | Read / save `{ toolsPerQuiz, timeLimitSeconds }` |
| GET | `/student` | Public settings and availability |
| POST | `/student/start` | `{ studentName }` -> HTTP 201 `{ id, token }` |
| GET | `/attempts/:id` | Read active attempt or completed result |
| PUT | `/attempts/:id/answers` | `{ toolId, selectedCategoryId }` |
| POST | `/attempts/:id/submit` | `{ answers: [{ toolId, selectedCategoryId }] }` |
| GET | `/professor/results` | Filtered rows and available semester values |
| GET | `/professor/results/export` | Filtered `.xlsx` workbook |
| GET | `/professor/results/:id` | Historical attempt detail |

**In answer payloads, `toolId` is the attempt-tool ID returned by the attempt response, not the live library Tool ID.** `selectedCategoryId` is a snapshot category ID or null.

Tool create/update accepts multipart fields `name`, `categoryId`, optional `logo`, and optional `removeLogo` (string `"true"` or `"false"`). A new uploaded logo takes precedence over removal. Without a new logo or removal request, updates retain the existing image.

Result query parameters are `search`, `semester` (for example `FALL-2026`), and `sort` (`newest`, `oldest`, `high`, `low`, `az`, `za`). Listing and export share the same query builder. The export uses ExcelJS and includes student, semester/year, score, total, percentage, dates, and elapsed time.

Most application errors are JSON `{ error: string }`: 400 for invalid input, 401 for failed Professor authentication, 403 for denied Student writes, 404 for missing records, and 409 for state conflicts. Login and start endpoints also use rate limiting.

## Authentication and image handling

Professor passwords use bcrypt; login issues an eight-hour HS256 JWT. Requests also check that the Professor still exists. `JWT_SECRET` must have at least 32 characters. Helmet adds security headers, CORS uses `CLIENT_URL`, JSON bodies are limited to 100 KB, and API responses use `Cache-Control: no-store`.

Multer accepts one in-memory logo up to 2 MB. Sharp verifies the decoded format against the declared PNG/JPEG/WebP MIME type, limits input to 20 megapixels, resizes within 512 by 512 pixels, and re-encodes to WebP. Random UUID filenames avoid using user-provided paths. Images are publicly served with immutable caching.

Old images remain after replacements and deletion because historical attempts reference them. A future cleanup operation must inspect snapshot references. Failed database writes can leave orphan images. Replace `logoStorage.save()` and adjust serving as needed to adopt object storage.

## Running and validating a fresh copy

Use Node.js 22.12+ and PostgreSQL, or Docker Desktop for the included database service. Run from the extracted project root:

```sh
npm ci
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, or `cp .env.example .env` in a POSIX shell). Set a new `JWT_SECRET`; adjust `DATABASE_URL` and ports if needed. Then run:

```sh
docker compose up -d
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Skip Docker if using an existing PostgreSQL server. The optional seed defaults to the development account `professor` / `professor123`, nine tools, three categories, six tools per quiz, and 180 seconds on a fresh database. Set custom seed account variables before seeding. Re-seeding does not reset an existing Professor password and preserves settings for a nonempty library, but can add missing sample tools/categories.

Open the Vite URL, normally `http://localhost:5173`. Use the Professor area to inspect the library/settings, then start a Student attempt, assign tools, refresh, and submit. Verify the result in the Professor area and export Excel.

```sh
npm run typecheck
npx prisma validate
npm test
npm run build
```

Tests use Node's built-in test runner through tsx and require a reachable PostgreSQL database with permission to create schemas. They create randomly named disposable schemas, apply migrations, and clean up their own data. The workflow test covers authentication, CRUD, image uploads, answer secrecy, recovery, grading, concurrency, expiry, filtering, export, and snapshot integrity. Other tests cover migration compatibility and seed idempotency.

The earlier automated and browser checks are recorded in `VERIFICATION.md` dated September 10, 2026. For this documentation handoff, TypeScript checks were rerun; integration, production-build, and browser checks were not rerun. No application behavior was changed.

## Deployment and maintenance

The repository documents a single Node service deployment on Render. Build with `npm ci && npm run build`; start with `npx prisma migrate deploy && npm start`. Set `NODE_ENV=production`, `DATABASE_URL`, a new `JWT_SECRET`, and `CLIENT_URL` to the service origin. Set `TRUST_PROXY_HOPS` for the actual proxy arrangement (the documented Render setup uses 1). The health endpoint is `/api/health`.

Provide persistent logo storage in deployment. The default local filesystem is unsuitable on an ephemeral service. Backups must cover both the database and referenced images. On Windows, stop an API process before Prisma client regeneration if its engine DLL is locked.

There is one global library and one global quiz configuration. The current application has no assignments, course isolation, Student accounts, identity verification, retake restrictions, password-reset UI, result pagination, or image garbage collection. Results are fetched in full, and exports are built in memory; consider pagination and export limits if the dataset grows. Local browser tokens mean access recovery and XSS prevention matter when extending the frontend.

The second migration converts old Teachers to Professors, merges equivalent categories, snapshots historical attempts, and removes assignments. Preserve both migrations and the migration regression test; old assignment routes no longer exist.

## Guidance for the next developer

For UI changes, start with `client/src/main.tsx` and `style.css`. For grading or timing changes, start with `attempts.ts` and the workflow test. For new fields, change the Prisma model, add a new migration, update API validation/serialization, then update frontend types and forms. For report changes, update the shared query builder and Excel export together.

Preserve these core guarantees: active responses must not reveal correct answers, grading must use snapshots, a refresh must not reset the deadline or selection, completed attempts must remain immutable, and concurrent writes/submission must remain serialized. Any refactor into smaller modules should retain those behaviors and the integration coverage.
