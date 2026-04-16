import { Router } from 'express';
import { hybridSearch } from '../services/searchService.js';
import { answerWithContext } from '../services/llmService.js';

const router = Router();

router.post('/ask', async (req, res) => {
  try {
    const { question } = req.body || {};
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'question required' });
    }
    const hits = await hybridSearch(question, { limit: 6 });
    if (!hits.length) {
      return res.json({
        answer: 'No matching policy content was found. Have you seeded the database and waited for Atlas indexes to become READY?',
        references: [],
        contextCount: 0,
      });
    }
    const result = await answerWithContext(question, hits);
    res.json({
      ...result,
      matches: hits.map((h) => ({
        policyId: h.policyId,
        title: h.title,
        score: h.score,
        matchType: h.matchType,
        sections: (h.sections || []).map((s) => ({ sectionId: s.sectionId, title: s.title })),
      })),
    });
  } catch (err) {
    console.error('qa error', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
