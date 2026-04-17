# MasterPolicy GraphRAG v1

A full-stack **Retrieval-Augmented Generation (RAG)** application for querying insurance master policy documents. Upload a policy PDF, and the system parses it into a parent/child hierarchy, generates OpenAI embeddings, stores them in MongoDB Atlas with vector and text search indexes, and answers natural-language questions with GPT-4o — complete with policy citations.

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-w38whgun)

---

## Architecture

```
┌──────────────┐       /api proxy       ┌───────────────┐       ┌──────────────────┐
│  React SPA   │  ──────────────────▶   │  Express API  │  ───▶ │  MongoDB Atlas   │
│  (Vite+TS)   │  :5173                 │  :5174        │       │  (Vector + Text) │
└──────────────┘                        └───────┬───────┘       └──────────────────┘
                                                │
                                                ▼
                                        ┌───────────────┐
                                        │  OpenAI API   │
                                        │  (Embed+GPT4o)│
                                        └───────────────┘
```

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React 18, TypeScript, React Router v7, Tailwind CSS, Axios, Lucide icons |
| Backend | Node.js (ESM), Express 4, Multer, MongoDB driver v6, OpenAI SDK v4, pdf-parse |
| Database | MongoDB Atlas (`$vectorSearch` + `$search` aggregation stages) |
| AI/ML | OpenAI `text-embedding-3-small` (1536-dim), `gpt-4o` (chat completions, JSON mode) |
| Build | Vite 5, PostCSS, Autoprefixer, ESLint, TypeScript |

## Getting Started

### Prerequisites

- **Node.js** v18+
- **MongoDB Atlas** cluster with a connection URI
- **OpenAI API key**

### Installation

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd server && npm install
```

### Running

```bash
# Start the backend (port 5174)
cd server
npm run dev

# In a separate terminal — start the frontend (port 5173)
npm run dev
```

Open `http://localhost:5173/setup` in your browser.

### Setup Workflow

1. **Connect** — Enter your MongoDB Atlas URI, database name, and OpenAI API key.
2. **Seed** — Upload a Master Policy PDF (max 50 MB). The server parses it, generates embeddings, and creates Atlas search indexes.
3. **Wait** — Atlas indexes take 1–5 minutes to become READY. The status panel auto-refreshes every 3 seconds.
4. **Query** — Navigate to `/qa` and start asking questions.

## How It Works

```
PDF Upload
  → parsePdfToHierarchy()          // Regex-based Policy X.XX / X.XXa detection
  → Extract cross-references       // Inline "Policy X.XX" / "FAQ X.XXa-N" refs
  → Enrich embedding text          // Add cross-ref IDs + section summaries
  → embedTexts() for parents       // OpenAI text-embedding-3-small, batches of 96
  → embedTexts() for child sections
  → MongoDB insertMany             // policies collection (with refPolicyIds graph edges)
  → createIndex(policyId, refPolicyIds)  // Standard indexes for $graphLookup
  → ensureSearchIndexes()          // Atlas vector + text search indexes

User Question
  → expandQuery()                  // LLM generates 2-3 alternative search phrases + keywords
  → hybridSearch() × N queries     // Run in parallel across all expanded queries
      ├── vectorSearch (parent embeddings)   → matchType: 'parent'
      ├── vectorSearch (section embeddings)  → matchType: 'child'
      └── textSearch ($search compound)      → matchType: 'text'
  → $graphLookup (depth 2)         // Traverse cross-reference graph from initial hits
  → reverseGraphLookup()           // Find policies that reference our hits
  → Deduplicate + rank by score → top 12 hits
  → answerWithContext()            // GPT-4o with structured JSON output
  → { answer, references[], matches[] }
```

### Chunking & Document Hierarchy

The PDF parser uses **structure-aware hierarchical chunking**, not fixed-size splitting:

1. **Regex detection** — Lines matching `Policy X.XX` (e.g., `Policy 3.12`) are identified as **parent policies**. Lines matching `Policy X.XXa` (e.g., `Policy 3.12a`, `Policy 3.12b`) become **child sections** nested under their parent.

2. **Parent/child tree** — Each parent policy document contains its own `content` plus an array of `sections[]`, where each section has its own `sectionId`, `title`, `content`, and embedding. This preserves the original document structure rather than losing context through arbitrary chunking.

3. **Cross-reference extraction** — The parser scans all content for inline references to other policies (e.g., `"see Policy 2.71d"`, `"FAQ 2.71d-1"`). These are stored as:
   - `crossRefs` — the raw references found (e.g., `["2.71d-1", "8.49i"]`)
   - `refPolicyIds` — normalized to parent-level IDs (e.g., `["2.71", "8.49"]`) to serve as graph edges for `$graphLookup`

4. **Fallback** — If no `Policy X.XX` patterns are found, the text is split into fixed 1200-character chunks.

### Enriched Embeddings

Embedding text is enriched beyond raw content to improve semantic retrieval:

- **Parent embeddings** include the policy ID, title, content, cross-referenced policy IDs (`Related policies: 2.71, 8.49`), and a summary of child section IDs/titles.
- **Section embeddings** include the section ID, title, content, parent policy context (`parent: 8.49 ...`), and cross-referenced policy IDs.

This means a vector search for "BDIP account requirements" is more likely to also surface policies that reference BDIP-related sections, even if the word "BDIP" doesn't appear in the parent policy's own content.

### Multi-Hop Search with $graphLookup

The retrieval pipeline goes beyond single-query search:

1. **Query expansion** — An LLM call generates 2-3 alternative search phrases and extracts domain keywords. For example, `"My spouse divested securities due to non-BDIP"` might expand to `["BDIP enabled account divestiture requirement", "spousal equivalent securities compliance", "BDIP mutual fund broker"]`.

2. **Parallel hybrid search** — All expanded queries run hybrid search (vector + text) simultaneously, then results are merged and deduplicated.

3. **Graph traversal** — From the initial hit set, `$graphLookup` recursively follows `refPolicyIds → policyId` edges up to **depth 2**, discovering connected policies that weren't returned by search. For example, if Policy 8.49 references Policy 2.71, and Policy 2.71 references Policy 1.63, all three are retrieved.

4. **Reverse lookup** — Also finds policies that *reference* the initial hits (incoming edges), catching bidirectional relationships.

5. **Score decay** — Graph-discovered policies receive scores that decay with hop distance (0.7 at hop 1, 0.5 at hop 2), so direct search matches are prioritised but graph context is still included.

### Prompt Construction

The LLM prompt is built in layers to maximise answer quality:

**System prompt** instructs GPT-4o to:
- Read ALL provided context including every sub-section, FAQ, and cross-referenced policy before answering
- Synthesize information across multiple policies when they reference each other
- Read the FULL content of each sub-section/FAQ (not just cite its number)
- Check child sections for exceptions, grandfathering rules, and regional exemptions
- Return structured JSON with `answer` and `references[]`

**Context formatting** organises the retrieved policies for the LLM:
- **Sorted**: direct search matches first, then graph-connected policies
- **Labeled**: graph-connected policies are explicitly marked with `⟵ GRAPH-CONNECTED (found via cross-reference traversal — READ CAREFULLY)` so the model doesn't skip them
- **Cross-refs shown**: each policy block lists its cross-references, and sub-sections are labeled `READ ALL OF THESE`
- **Full content**: every parent policy includes its complete content plus all nested sub-sections with their full text

**Example context block sent to GPT-4o:**
```
# Context 1 (matchType=parent, score=0.842)
Policy 8.49 — BDIP Account Requirements
Cross-references: 2.71, 1.63
All mutual fund purchases by a Partner or Professional Staff member...

Sub-sections (READ ALL OF THESE):
  - Policy 8.49i — BDIP-Enabled Account Mandate
    All mutual fund purchases must be made through a BDIP-enabled account...

---

# Context 2 (matchType=graph-hop1, score=0.500) ⟵ GRAPH-CONNECTED
Policy 2.71 — Mutual Fund Holdings
Cross-references: 8.49
...

Sub-sections (READ ALL OF THESE):
  - Policy 2.71d — BDIP Transfer Requirements  [Cross-refs: 2.71d-1, 2.71d-2]
    ...
  - Policy 2.71d-1 — FAQ: Regional Exceptions
    Partners in India, Germany, or Mexico where no BDIP-participating brokers exist...
  - Policy 2.71d-2 — FAQ: Grandfathered Holdings
    Mutual funds purchased directly from a fund distributor prior to August 1, 2014...
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/setup/connect` | Connect to MongoDB Atlas and set OpenAI API key |
| `GET` | `/api/setup/status` | Full setup/connection status |
| `POST` | `/api/setup/seed` | Upload PDF — parse, embed, and index |
| `GET` | `/api/setup/indexes` | List Atlas search indexes on the policies collection |
| `GET` | `/api/setup/seed-status` | Current seeding progress |
| `POST` | `/api/qa/ask` | Ask a question against the policy knowledge base |

## Database Schema

### `policies` Collection

| Field | Type | Description |
|---|---|---|
| `policyId` | string | e.g., `3.12` |
| `title` | string | Policy title |
| `content` | string | Full text of the parent policy |
| `embedding` | number[] | 1536-dim vector (enriched with cross-refs + section summaries) |
| `sections` | array | Child sections, each with `sectionId`, `title`, `content`, `embedding`, `crossRefs` |
| `crossRefs` | string[] | Raw cross-references found in content (e.g., `["2.71d-1", "8.49i"]`) |
| `refPolicyIds` | string[] | Normalized parent-level IDs for `$graphLookup` edges (e.g., `["2.71", "8.49"]`) |
| `createdAt` | date | Insertion timestamp |

### Standard Indexes (for `$graphLookup`)

| Index | Fields |
|---|---|
| Unique policy lookup | `policyId: 1` |
| Graph edge traversal | `refPolicyIds: 1` |
| Section lookup | `sections.sectionId: 1` |

### Atlas Search Indexes

| Index Name | Type | Indexed Paths |
|---|---|---|
| `policy_vector_idx` | vectorSearch | `embedding`, `sections.embedding` (1536-dim, cosine) |
| `policy_text_idx` | search | `content`, `title`, `policyId`, `sections.content`, `sections.title`, `sections.sectionId` |

## Frontend Pages

### Setup Page (`/setup`)

Two-step wizard for connecting to MongoDB Atlas and uploading a policy PDF. Includes a real-time status sidebar showing connection state, seed progress, index build status, and a "How it works" explainer.

### Q&A Chat (`/qa`)

Chat interface with:
- Suggested starter questions for empty state
- Warning banner if setup is incomplete
- Assistant responses with **citation badges** (emerald pills showing `Policy X.XX`)
- Expandable **context details** showing each retrieved match with type and relevance score
- Auto-scrolling message list

## Key Features

- **Hierarchical PDF parsing** — Parent/child policy structure with cross-reference extraction, not flat chunking
- **Cross-reference graph** — Policies store `refPolicyIds` edges enabling recursive `$graphLookup` traversal
- **Enriched embeddings** — Embedding text includes cross-ref IDs, section summaries, and parent context for better semantic retrieval
- **LLM query expansion** — User questions are expanded into multiple search phrases and domain keywords before retrieval
- **Multi-hop `$graphLookup`** — After initial search, MongoDB graph traversal (depth 2) discovers connected policies through cross-reference chains
- **Reverse graph lookup** — Also finds policies that reference initial hits (bidirectional graph edges)
- **Dual-level vector search** — Independent embedding search at both parent and section levels
- **Hybrid retrieval** — Semantic vector search + keyword text search for higher recall
- **Graph-aware prompting** — LLM context sorts direct matches first, labels graph-connected policies, and instructs GPT-4o to read all sub-sections/FAQs
- **Structured citations** — GPT-4o returns policy references rendered as UI badges
- **Transparency** — Every answer shows the underlying search matches with type (parent/child/text/graph-hop) and scores
- **Programmatic index management** — Atlas search indexes + standard indexes for `$graphLookup` created via the MongoDB driver
- **Runtime configuration** — No `.env` files needed; credentials entered through the UI
- **Batched embeddings** — Up to 96 texts per OpenAI API call
- **Graceful degradation** — If vector search, text search, or graph traversal fails, the remaining methods still return results

## Project Structure

```
├── server/
│   ├── server.js              # Express entry point (port 5174)
│   ├── db.js                  # MongoDB connection & state singleton
│   ├── routes/
│   │   ├── qa.js              # POST /api/qa/ask
│   │   └── setup.js           # Connect, seed, index management
│   └── services/
│       ├── embeddingService.js # OpenAI embedding (text-embedding-3-small)
│       ├── llmService.js      # GPT-4o answer generation
│       ├── pdfParser.js       # PDF → policy hierarchy + cross-refs
│       └── searchService.js   # Multi-hop hybrid search + $graphLookup
├── src/
│   ├── App.tsx                # React Router setup
│   ├── main.tsx               # Entry point
│   ├── index.css              # Tailwind + component classes
│   ├── components/
│   │   ├── ChatMessage.tsx    # Chat bubble with citations
│   │   ├── QAChat.tsx         # Q&A chat page
│   │   └── SetupPage.tsx      # Config & seed wizard
│   └── lib/
│       └── api.ts             # Axios API client
├── package.json               # Frontend dependencies
├── vite.config.ts             # Vite + API proxy config
└── tailwind.config.js
```

## License

Private — internal use only.
