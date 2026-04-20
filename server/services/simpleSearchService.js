import { getDb } from '../db.js';
import { embedOne } from './embeddingService.js';

const COLLECTION = 'policies_simple';
const VECTOR_INDEX = 'simple_vector_idx';

function dedupe(hits) {
  const map = new Map();
  for (const h of hits) {
    const key = String(h._id);
    const existing = map.get(key);
    if (!existing || (h.score || 0) > (existing.score || 0)) {
      map.set(key, h);
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.score || 0) - (a.score || 0));
}

function buildVectorSearchPipeline(queryText, path, limit, numCandidates) {
  return [
    {
      $vectorSearch: {
        index: VECTOR_INDEX,
        path,
        queryVector: `<embed("${queryText.slice(0, 60)}${queryText.length > 60 ? '...' : ''}")>`,
        numCandidates,
        limit,
      },
    },
    {
      $project: {
        policyId: 1, title: 1, content: 1, sections: 1,
        score: { $meta: 'vectorSearchScore' },
        matchType: { $literal: path === 'embedding' ? 'parent' : 'child' },
      },
    },
  ];
}

export async function simpleVectorSearch(queryText, { limit = 8, numCandidates = 150 } = {}) {
  const db = getDb();
  const queryVec = await embedOne(queryText);
  const col = db.collection(COLLECTION);

  const parentHits = await col.aggregate([
    {
      $vectorSearch: {
        index: VECTOR_INDEX,
        path: 'embedding',
        queryVector: queryVec,
        numCandidates,
        limit,
      },
    },
    {
      $project: {
        policyId: 1,
        title: 1,
        content: 1,
        sections: 1,
        score: { $meta: 'vectorSearchScore' },
        matchType: { $literal: 'parent' },
      },
    },
  ]).toArray();

  const childHits = await col.aggregate([
    {
      $vectorSearch: {
        index: VECTOR_INDEX,
        path: 'sections.embedding',
        queryVector: queryVec,
        numCandidates,
        limit,
      },
    },
    {
      $project: {
        policyId: 1,
        title: 1,
        content: 1,
        sections: 1,
        score: { $meta: 'vectorSearchScore' },
        matchType: { $literal: 'child' },
      },
    },
  ]).toArray();

  return dedupe([...parentHits, ...childHits]);
}

/**
 * Simple RAG search:
 * 1. Run vector search on parent + child embeddings (no query expansion)
 * 2. Deduplicate and return top results (no text search, no graph traversal)
 *
 * Returns { hits, pipeline } where pipeline is an array of step timing info.
 */
export async function simpleSearch(queryText, { limit = 10 } = {}) {
  const pipeline = [];
  const t0 = Date.now();

  // Step 1: Vector search only — no query expansion, no text search, no graph traversal
  const step1Start = Date.now();
  let hits = [];
  try {
    hits = await simpleVectorSearch(queryText, { limit });
  } catch (e) {
    console.warn('simple vector search failed:', e.message);
  }
  pipeline.push({
    step: 'Vector Search',
    description: `Parent + child vector search → ${hits.length} unique policies`,
    detail: { policiesFound: hits.map((h) => h.policyId) },
    pipelines: {
      'Parent Vector Search': buildVectorSearchPipeline(queryText, 'embedding', limit, 150),
      'Child Vector Search': buildVectorSearchPipeline(queryText, 'sections.embedding', limit, 150),
    },
    durationMs: Date.now() - step1Start,
  });

  console.log(`[simpleSearch] found ${hits.length} policies:`, hits.map((h) => h.policyId));

  // Step 2: Rank (already sorted by score from dedupe)
  const finalHits = hits.slice(0, limit);
  pipeline.push({
    step: 'Rank',
    description: `Top ${finalHits.length} policies by vector similarity score`,
    detail: { policies: finalHits.map((h) => ({ id: h.policyId, type: h.matchType, score: +(h.score || 0).toFixed(3) })) },
    durationMs: 0,
    totalSearchMs: Date.now() - t0,
  });

  pipeline.push({
    step: 'Total',
    description: 'End-to-end pipeline complete',
    durationMs: Date.now() - t0,
  });

  return { hits: finalHits, pipeline };
}
