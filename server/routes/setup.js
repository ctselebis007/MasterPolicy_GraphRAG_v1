import { Router } from 'express';
import multer from 'multer';
import { connectDb, getDb, setOpenAIKey, getStatus, updateSeedStatus, getSeedStatus } from '../db.js';
import { parsePdfToHierarchy } from '../services/pdfParser.js';
import { embedTexts, EMBED_DIMS } from '../services/embeddingService.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const router = Router();

const COLLECTION = 'policies';
const VECTOR_INDEX = 'policy_vector_idx';
const TEXT_INDEX = 'policy_text_idx';

router.post('/connect', async (req, res) => {
  try {
    const { uri, dbName, openaiKey } = req.body;
    if (openaiKey) setOpenAIKey(openaiKey);
    await connectDb({ uri, dbName });
    res.json({ ok: true, status: getStatus() });
  } catch (err) {
    console.error('connect error', err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/status', (_req, res) => {
  try {
    const status = getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/seed', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file required (field: pdf)' });
  try {
    updateSeedStatus({ seeding: true, lastError: null, progress: 'Parsing PDF...' });
    const db = getDb();
    const parents = await parsePdfToHierarchy(req.file.buffer);
    updateSeedStatus({ progress: `Parsed ${parents.length} policies. Embedding...` });

    const parentTexts = parents.map((p) => `Policy ${p.policyId} ${p.title}\n${p.content}`.trim());
    const parentVecs = await embedTexts(parentTexts);

    const allSections = [];
    parents.forEach((p, pi) => {
      (p.sections || []).forEach((s, si) => {
        allSections.push({ pi, si, text: `Policy ${s.sectionId} ${s.title}\n${s.content}`.trim() });
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
      sections: p.sections,
      embedding: parentVecs[i],
      createdAt: new Date(),
    }));

    const col = db.collection(COLLECTION);
    await col.deleteMany({});
    if (docs.length) await col.insertMany(docs);

    updateSeedStatus({ progress: `Inserted ${docs.length} documents. Creating Atlas indexes...` });

    const indexStatus = await ensureSearchIndexes(col);

    updateSeedStatus({
      seeding: false,
      seeded: true,
      documentCount: docs.length,
      indexes: indexStatus,
      progress: 'Seed complete. Atlas indexes may take 1-5 minutes to become READY.',
    });
    res.json({ ok: true, documentCount: docs.length, indexes: indexStatus });
  } catch (err) {
    console.error('seed error', err);
    updateSeedStatus({ seeding: false, lastError: err.message, progress: `Failed: ${err.message}` });
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
  const status = { vector: 'creating', text: 'creating' };
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

  if (!names.has(TEXT_INDEX)) {
    try {
      await col.createSearchIndex({
        name: TEXT_INDEX,
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              content: { type: 'string' },
              title: { type: 'string' },
              policyId: { type: 'string' },
              sections: {
                type: 'embeddedDocuments',
                dynamic: false,
                fields: {
                  content: { type: 'string' },
                  title: { type: 'string' },
                  sectionId: { type: 'string' },
                },
              },
            },
          },
        },
      });
      status.text = 'created';
    } catch (e) {
      status.text = `error: ${e.message}`;
    }
  } else {
    status.text = 'exists';
  }
  return status;
}

router.get('/seed-status', (_req, res) => {
  res.json(getSeedStatus());
});

export default router;
