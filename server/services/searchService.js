import { getDb } from '../db.js';
import { embedOne, getOpenAIClient } from './embeddingService.js';

const COLLECTION = 'policies';
const VECTOR_INDEX = 'policy_vector_idx';
const TEXT_INDEX = 'policy_text_idx';

// Match policy references like "8.49i", "2.71d-1", "2.71d", "3.12"
const POLICYID_RE = /(\d+\.\d+[a-zA-Z]?(?:-\d+)?)/g;

/* ── Query expansion via LLM ── */
async function expandQuery(question) {
  try {
    const client = getOpenAIClient();
    const resp = await client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You help expand user questions about corporate compliance policies into better search queries.
Given a question, return a JSON object with:
- "queries": an array of 2-3 short search phrases (different angles/synonyms) that would help find relevant policy sections.
- "keywords": an array of 3-5 key domain terms extracted from the question.
Focus on compliance, securities, investment, BDIP, divestiture, mutual fund, broker, and similar policy domain terms.`,
        },
        { role: 'user', content: question },
      ],
    });
    const parsed = JSON.parse(resp.choices[0]?.message?.content || '{}');
    return {
      queries: Array.isArray(parsed.queries) ? parsed.queries : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch (e) {
    console.warn('query expansion failed:', e.message);
    return { queries: [], keywords: [] };
  }
}

/* ── Graph traversal via $graphLookup (depth up to 2) ── */
async function graphTraversal(seedPolicyIds, { maxDepth = 2 } = {}) {
  if (!seedPolicyIds.length) return [];
  const db = getDb();
  const col = db.collection(COLLECTION);

  const results = await col.aggregate([
    // Start from the seed policies
    { $match: { policyId: { $in: seedPolicyIds } } },
    // Recursively follow refPolicyIds → policyId up to maxDepth hops
    {
      $graphLookup: {
        from: COLLECTION,
        startWith: '$refPolicyIds',
        connectFromField: 'refPolicyIds',
        connectToField: 'policyId',
        as: 'graphConnected',
        maxDepth,
        depthField: 'hopDepth',
      },
    },
    // Unwind the connected policies into individual documents
    { $unwind: { path: '$graphConnected', preserveNullAndEmptyArrays: false } },
    { $replaceRoot: { newRoot: '$graphConnected' } },
    // Remove duplicates
    { $group: { _id: '$_id', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
  ]).toArray();

  // Filter out policies already in the seed set
  const seedSet = new Set(seedPolicyIds);
  return results
    .filter((r) => !seedSet.has(r.policyId))
    .map((r) => ({
      ...r,
      score: Math.max(0.3, 0.7 - (r.hopDepth || 0) * 0.2), // Score decays with hop depth
      matchType: `graph-hop${r.hopDepth ?? '?'}`,
    }));
}

/* ── Also fetch policies that REFERENCE our seed policies (reverse links) ── */
async function reverseGraphLookup(seedPolicyIds) {
  if (!seedPolicyIds.length) return [];
  const db = getDb();
  const col = db.collection(COLLECTION);

  const results = await col.find({
    refPolicyIds: { $in: seedPolicyIds },
    policyId: { $nin: seedPolicyIds },
  }).toArray();

  return results.map((r) => ({ ...r, score: 0.6, matchType: 'graph-reverse' }));
}

/* ── Extract cross-referenced policy IDs from search hits ── */
function extractCrossRefIds(hits) {
  const ids = new Set();
  const hitIds = new Set(hits.map((h) => h.policyId));
  for (const hit of hits) {
    if (Array.isArray(hit.crossRefs)) {
      hit.crossRefs.forEach((r) => ids.add(r));
    }
    if (Array.isArray(hit.refPolicyIds)) {
      hit.refPolicyIds.forEach((r) => ids.add(r));
    }
    for (const s of hit.sections || []) {
      if (Array.isArray(s.crossRefs)) {
        s.crossRefs.forEach((r) => ids.add(r));
      }
    }
    // Scan content for inline references
    const allText = [hit.content || '', ...(hit.sections || []).map((s) => s.content || '')].join(' ');
    let m;
    while ((m = POLICYID_RE.exec(allText)) !== null) {
      // Normalize to parent ID
      const parentMatch = m[1].match(/^(\d+\.\d+)/);
      if (parentMatch) ids.add(parentMatch[1]);
    }
  }
  for (const id of hitIds) ids.delete(id);
  return [...ids];
}

/* ── Build pipeline syntax objects for transparency ── */
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
        policyId: 1, title: 1, content: 1, sections: 1, crossRefs: 1,
        score: { $meta: 'vectorSearchScore' },
        matchType: { $literal: path === 'embedding' ? 'parent' : 'child' },
      },
    },
  ];
}

function buildTextSearchPipeline(queryText, limit) {
  return [
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
        policyId: 1, title: 1, content: 1, sections: 1, crossRefs: 1,
        score: { $meta: 'searchScore' },
        matchType: { $literal: 'text' },
      },
    },
  ];
}

function buildGraphLookupPipeline(seedPolicyIds, maxDepth) {
  return [
    { $match: { policyId: { $in: seedPolicyIds } } },
    {
      $graphLookup: {
        from: COLLECTION,
        startWith: '$refPolicyIds',
        connectFromField: 'refPolicyIds',
        connectToField: 'policyId',
        as: 'graphConnected',
        maxDepth,
        depthField: 'hopDepth',
      },
    },
    { $unwind: { path: '$graphConnected', preserveNullAndEmptyArrays: false } },
    { $replaceRoot: { newRoot: '$graphConnected' } },
    { $group: { _id: '$_id', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
  ];
}

function buildReverseLookupFilter(seedPolicyIds) {
  return {
    refPolicyIds: { $in: seedPolicyIds },
    policyId: { $nin: seedPolicyIds },
  };
}

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
        crossRefs: 1,
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
        crossRefs: 1,
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
        crossRefs: 1,
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

/**
 * Multi-hop hybrid search with $graphLookup:
 * 1. Expand the query with LLM-generated search phrases
 * 2. Run hybrid search on original + expanded queries
 * 3. Use $graphLookup to traverse the policy cross-reference graph (depth 2)
 * 4. Also find policies that reference our results (reverse links)
 * 5. Deduplicate and return top results
 *
 * Returns { hits, pipeline } where pipeline is an array of step timing info.
 */
export async function multiHopSearch(queryText, { limit = 12 } = {}) {
  const pipeline = [];
  const t0 = Date.now();

  // Step 1: Expand query
  const step1Start = Date.now();
  const expansion = await expandQuery(queryText);
  const allQueries = [queryText, ...expansion.queries];
  const keywordQuery = expansion.keywords.join(' ');
  if (keywordQuery) allQueries.push(keywordQuery);
  pipeline.push({
    step: 'Query Expansion',
    description: `LLM generated ${expansion.queries.length} alternative queries + ${expansion.keywords.length} keywords`,
    detail: { queries: allQueries, keywords: expansion.keywords },
    durationMs: Date.now() - step1Start,
  });

  console.log(`[multiHop] expanded to ${allQueries.length} queries:`, allQueries);

  // Step 2: Run hybrid search on each query in parallel
  const step2Start = Date.now();
  const searchPromises = allQueries.map((q) =>
    hybridSearch(q, { limit: 8 }).catch((e) => {
      console.warn(`search for "${q}" failed:`, e.message);
      return [];
    })
  );
  const searchResults = await Promise.all(searchPromises);

  // Merge all results
  let allHits = dedupe(searchResults.flat());
  pipeline.push({
    step: 'Hybrid Search',
    description: `Ran ${allQueries.length} parallel searches (vector + text) → ${allHits.length} unique policies`,
    detail: { policiesFound: allHits.map((h) => h.policyId) },
    pipelines: {
      'Parent Vector Search': buildVectorSearchPipeline(queryText, 'embedding', 8, 150),
      'Child Vector Search': buildVectorSearchPipeline(queryText, 'sections.embedding', 8, 150),
      'Text Search': buildTextSearchPipeline(queryText, 8),
    },
    durationMs: Date.now() - step2Start,
  });
  console.log(`[multiHop] initial hits: ${allHits.length} policies:`, allHits.map((h) => h.policyId));

  // Step 3: $graphLookup — forward traversal from initial hits
  const step3Start = Date.now();
  const seedIds = [...new Set(allHits.map((h) => h.policyId))];
  const crossRefIds = extractCrossRefIds(allHits);
  const graphSeedIds = [...new Set([...seedIds, ...crossRefIds])];
  let graphForwardCount = 0;
  let graphReverseCount = 0;

  if (graphSeedIds.length > 0) {
    console.log(`[multiHop] $graphLookup seeds:`, graphSeedIds);
    try {
      const [graphHits, reverseHits] = await Promise.all([
        graphTraversal(graphSeedIds, { maxDepth: 2 }),
        reverseGraphLookup(seedIds),
      ]);
      graphForwardCount = graphHits.length;
      graphReverseCount = reverseHits.length;
      console.log(`[multiHop] graph forward: ${graphHits.length}, reverse: ${reverseHits.length}`);
      allHits = dedupe([...allHits, ...graphHits, ...reverseHits]);
    } catch (e) {
      console.warn('graph traversal failed:', e.message);
    }
  }
  pipeline.push({
    step: 'Graph Traversal',
    description: `$graphLookup (depth 2) from ${graphSeedIds.length} seeds → ${graphForwardCount} forward + ${graphReverseCount} reverse`,
    detail: { seeds: graphSeedIds, forward: graphForwardCount, reverse: graphReverseCount },
    pipelines: {
      '$graphLookup (forward)': buildGraphLookupPipeline(graphSeedIds, 2),
      'Reverse Lookup (find)': buildReverseLookupFilter(seedIds),
    },
    durationMs: Date.now() - step3Start,
  });

  // Step 4: Final dedup & ranking
  const finalHits = allHits.slice(0, limit);
  pipeline.push({
    step: 'Dedup & Rank',
    description: `Merged to ${finalHits.length} top policies by score`,
    detail: { policies: finalHits.map((h) => ({ id: h.policyId, type: h.matchType, score: +(h.score || 0).toFixed(3) })) },
    durationMs: 0,
    totalSearchMs: Date.now() - t0,
  });

  console.log(`[multiHop] final: ${finalHits.length} policies:`, finalHits.map((h) => `${h.policyId}(${h.matchType})`));
  return { hits: finalHits, pipeline };
}
