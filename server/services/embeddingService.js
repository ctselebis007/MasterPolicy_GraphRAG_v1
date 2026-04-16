import OpenAI from 'openai';
import { getOpenAIKey } from '../db.js';

const MODEL = 'text-embedding-3-small';
const DIMS = 1536;

export function getOpenAIClient() {
  return new OpenAI({ apiKey: getOpenAIKey() });
}

export async function embedTexts(texts, { batchSize = 96 } = {}) {
  if (!texts.length) return [];
  const client = getOpenAIClient();
  const out = new Array(texts.length);
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => (t && t.trim()) || ' ');
    const res = await client.embeddings.create({ model: MODEL, input: batch });
    res.data.forEach((item, j) => {
      out[i + j] = item.embedding;
    });
  }
  return out;
}

export async function embedOne(text) {
  const [v] = await embedTexts([text]);
  return v;
}

export const EMBED_DIMS = DIMS;
export const EMBED_MODEL = MODEL;
