# ERP Translation App — Backend

## Overview

Node.js/Express REST API for managing multilingual ERP translations (FR → EN/AR/ES). Provides endpoints for CRUD operations on translations, AI-powered batch translation via Claude or GLM-4.7, validation workflows, and XML export. Backed by PostgreSQL.

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** Express 4.x
- **Database:** PostgreSQL 16 (via `pg` connection pool)
- **AI Services:** Anthropic Claude SDK, Z.AI GLM-4.7 (via OpenAI SDK)
- **Build:** TypeScript → `dist/` (ES2020, CommonJS)
- **Containerization:** Docker + docker-compose (at project root)

## Project Structure

```
backend/
├── src/
│   ├── index.ts              # Express server entry point (port 3000)
│   ├── db.ts                 # PostgreSQL connection pool
│   ├── routes/
│   │   └── translations.ts   # All REST API endpoints under /api
│   └── services/
│       ├── claude.ts          # Anthropic Claude translation service
│       └── glm.ts            # Z.AI GLM-4.7 translation service (currently active)
├── database/
│   └── schema.sql            # PostgreSQL schema (tables, indexes, triggers)
├── public/                   # Output directory for generated XML files
├── dist/                     # Compiled JS output
├── package.json
├── tsconfig.json
├── Dockerfile
├── .env / .env.example
```

## Commands

```bash
npm run dev      # Dev server with hot-reload (ts-node-dev)
npm run build    # Compile TypeScript to dist/
npm start        # Build + run compiled JS
```

## Environment Variables

```
PORT=3000
DATABASE_URL=postgresql://user:pass@host:port/erp_i18n
ANTHROPIC_API_KEY=sk-ant-...
ZAI_API_KEY=...
ZAI_BASE_URL=https://api.z.ai/api/paas/v4
```

## API Endpoints

All routes are prefixed with `/api`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/translations` | List translations (paginated, filterable by status/context/search/validation) |
| GET | `/translations/stats` | Aggregate statistics (counts by status and validation) |
| GET | `/translations/contexts` | List all unique ERP contexts |
| GET | `/translations/:id/:filename` | Get a single translation |
| PUT | `/translations/:id/:filename` | Update translation fields |
| POST | `/translations/ai-translate` | Batch AI translation (20 items/batch) |
| POST | `/translations/bulk-validate` | Bulk mark translations as validated |
| POST | `/translations/translation` | Create a new translation entry |
| POST | `/translations/generate-xml-files` | Export validated translations to XML |
| GET | `/health` | Health check |

## Database

**Primary table:** `translations`
- Composite primary key: `(id, filename)`
- Fields: `fr`, `en`, `ar`, `es` (translation texts)
- Status enum: `pending | ai_translated | human_reviewed | approved | needs_review`
- Per-language validation booleans: `en_validated`, `ar_validated`, `es_validated`
- `context` field stores the ERP module (accounting, inventory, etc.)
- Entries with `link IS NOT NULL` are filtered out (treated as references)

**History table:** `translation_history` — tracks all changes per translation/language with cascade delete.

**Triggers:** Auto-updates `updated_at` on row modification.

Schema is auto-loaded into PostgreSQL via docker-compose init script.

## AI Translation Services

Two interchangeable services with identical interfaces (`translateText()`, `translateBatch()`):

- **`services/claude.ts`** — Uses Anthropic SDK, model `claude-sonnet-4-20250514`. Currently commented out in routes.
- **`services/glm.ts`** — Uses OpenAI SDK pointed at Z.AI, model `glm-4.7`. Currently active.

To switch providers: change the import on line ~4 of `routes/translations.ts`.

Both services accept French text + optional ERP context and return `{ en, ar, es }` translations. Batch mode processes up to 20 items per API call. Temperature is set to 0.1 for deterministic output.

## Key Conventions

- All route handlers use async/await with try-catch, returning 500 on errors.
- Pagination defaults: page=1, limit=50.
- The XML export writes files to `public/` and groups translations by filename.
- CORS is enabled globally.
- No authentication layer — intended for internal use.
