import { getDb } from '../db.js';
import { embedOne } from './embeddingService.js';

const COLLECTION = 'policies';
const VECTOR_INDEX = 'policy_vector_idx';
const TEXT_INDEX = 'policy_text_idx';

export async function vectorSearch(queryText, { limit = 6, numCandidates = 150 } = {}) {
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

export async function textSearch(queryText, { limit = 6 } = {}) {
  const db = getDb();
  const col = db.collection(COLLECTION);
  const hits = await col.aggregate([
    {
      $search: {
        index: TEXT_INDEX,
        compound: {
          should: [
            { text: { query: queryText, path: 'content' } },
            { text: { query: queryText, path: 'title' } },
            { text: { query: queryText, path: 'sections.content' } },
            { text: { query: queryText, path: 'sections.title' } },
          ],
        },
      },
    },
    { $limit: limit },
    {
      $project: {
        policyId: 1,
        title: 1,
        content: 1,
        sections: 1,
        score: { $meta: 'searchScore' },
        matchType: { $literal: 'text' },
      },
    },
  ]).toArray();
  return hits;
}

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

export async function hybridSearch(queryText, { limit = 6 } = {}) {
  let vector = [];
  let text = [];
  try { vector = await vectorSearch(queryText, { limit }); } catch (e) { console.warn('vectorSearch failed:', e.message); }
  try { text = await textSearch(queryText, { limit }); } catch (e) { console.warn('textSearch failed:', e.message); }
  const merged = dedupe([...vector, ...text]);
  return merged.slice(0, limit);
}
