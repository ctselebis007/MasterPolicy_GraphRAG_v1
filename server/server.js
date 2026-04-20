import express from 'express';
import cors from 'cors';
import setupRoutes from './routes/setup.js';
import qaRoutes from './routes/qa.js';
import simpleSetupRoutes from './routes/simple-setup.js';
import simpleQaRoutes from './routes/simple-qa.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/setup', setupRoutes);
app.use('/api/qa', qaRoutes);
app.use('/api/simple-setup', simpleSetupRoutes);
app.use('/api/simple-qa', simpleQaRoutes);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 5174;
app.listen(PORT, () => {
  console.log(`GraphRAG API listening on http://localhost:${PORT}`);
});
