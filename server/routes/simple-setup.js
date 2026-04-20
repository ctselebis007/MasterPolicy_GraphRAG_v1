import { Router } from 'express';
import multer from 'multer';
import { connectDb, getDb, setOpenAIKey, getSimpleStatus, updateSimpleSeedStatus, getSimpleSeedStatus } from '../db.js';
import { parsePdfToHierarchy } from '../services/pdfParser.js';
import { embedTexts, EMBED_DIMS } from '../services/embeddingService.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const router = Router();

const COLLECTION = 'policies_simple';
const VECTOR_INDEX = 'simple_vector_idx';

router.post('/connect', async (req, res) => {
  try {
    const { uri, dbName, openaiKey } = req.body;
    if (openaiKey) setOpenAIKey(openaiKey);
    await connectDb({ uri, dbName });
    res.json({ ok: true, status: getSimpleStatus() });
  } catch (err) {
    console.error('simple connect error', err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/status', (_req, res) => {
  try {
    const status = getSimpleStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/seed', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file required (field: pdf)' });
  try {
    updateSimpleSeedStatus({ seeding: true, lastError: null, progress: 'Parsing PDF...' });
    const db = getDb();
    const parents = await parsePdfToHierarchy(req.file.buffer);
    updateSimpleSeedStatus({ progress: `Parsed ${parents.length} policies. Embedding (plain text, no enrichment)...` });

    // Plain embeddings — NO enrichment with cross-refs, summaries, or parent context
    const parentTexts = parents.map((p) => {
      return `Policy ${p.policyId} ${p.title}\n${p.content}`.trim();
    });
    const parentVecs = await embedTexts(parentTexts);

    const allSections = [];
    parents.forEach((p, pi) => {
      (p.sections || []).forEach((s, si) => {
        allSections.push({
          pi, si,
          text: `Policy ${s.sectionId} ${s.title}\n${s.content}`.trim(),
        });
      });
    });
    const sectionVecs = await embedTexts(allSections.map((x) => x.text));
    allSections.forEach((ref, idx) => {
      parents[ref.pi].sections[ref.si].embedding = sectionVecs[idx];
    });

    const docs = parents.map((p, i) => ({
      policyId: p.policyId,
      title: p.title,
      content: p.content,
      sections: p.sections.map((s) => ({
        sectionId: s.sectionId,
        title: s.title,
        content: s.content,
        embedding: s.embedding,
      })),
      embedding: parentVecs[i],
      createdAt: new Date(),
    }));

    const col = db.collection(COLLECTION);
    await col.deleteMany({});
    if (docs.length) await col.insertMany(docs);

    await col.createIndex({ policyId: 1 }, { unique: true });

    updateSimpleSeedStatus({ progress: `Inserted ${docs.length} documents. Creating Atlas vector index...` });

    const indexStatus = await ensureSearchIndexes(col);

    updateSimpleSeedStatus({
      seeding: false,
      seeded: true,
      documentCount: docs.length,
      indexes: indexStatus,
      progress: 'Seed complete. Atlas vector index may take 1-5 minutes to become READY.',
    });
    res.json({ ok: true, documentCount: docs.length, indexes: indexStatus });
  } catch (err) {
    console.error('simple seed error', err);
    updateSimpleSeedStatus({ seeding: false, lastError: err.message, progress: `Failed: ${err.message}` });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/indexes', async (_req, res) => {
  try {
    const db = getDb();
    const col = db.collection(COLLECTION);
    const list = await col.listSearchIndexes().toArray().catch((e) => {
      throw new Error(`listSearchIndexes failed: ${e.message}`);
    });
    res.json({ indexes: list });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function ensureSearchIndexes(col) {
  const status = { vector: 'creating' };
  let existing = [];
  try { existing = await col.listSearchIndexes().toArray(); } catch (_) { existing = []; }
  const names = new Set(existing.map((i) => i.name));

  if (!names.has(VECTOR_INDEX)) {
    try {
      await col.createSearchIndex({
        name: VECTOR_INDEX,
        type: 'vectorSearch',
        definition: {
          fields: [
            { type: 'vector', path: 'embedding', numDimensions: EMBED_DIMS, similarity: 'cosine' },
            { type: 'vector', path: 'sections.embedding', numDimensions: EMBED_DIMS, similarity: 'cosine' },
          ],
        },
      });
      status.vector = 'created';
    } catch (e) {
      status.vector = `error: ${e.message}`;
    }
  } else {
    status.vector = 'exists';
  }

  return status;
}

router.get('/seed-status', (_req, res) => {
  res.json(getSimpleSeedStatus());
});

export default router;
