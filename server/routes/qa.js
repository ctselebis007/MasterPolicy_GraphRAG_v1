import { Router } from 'express';
import { multiHopSearch } from '../services/searchService.js';
import { answerWithContext } from '../services/llmService.js';

const router = Router();

router.post('/ask', async (req, res) => {
  try {
    const { question } = req.body || {};
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'question required' });
    }
    const totalStart = Date.now();
    const { hits, pipeline } = await multiHopSearch(question, { limit: 10 });
    if (!hits.length) {
      return res.json({
        answer: 'No matching policy content was found. Have you seeded the database and waited for Atlas indexes to become READY?',
        references: [],
        contextCount: 0,
        pipeline,
      });
    }
    const llmStart = Date.now();
    const result = await answerWithContext(question, hits);
    pipeline.push({
      step: 'LLM Generation',
      description: `GPT-4o synthesized answer from ${hits.length} policy contexts`,
      detail: { model: 'gpt-4o', contextsUsed: hits.length, referencesReturned: result.references?.length || 0 },
      durationMs: Date.now() - llmStart,
    });
    pipeline.push({
      step: 'Total',
      description: 'End-to-end pipeline complete',
      durationMs: Date.now() - totalStart,
    });
    res.json({
      ...result,
      pipeline,
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
