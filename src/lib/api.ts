import axios from 'axios';

const client = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

export type SetupStatus = {
  connected: boolean;
  dbName: string | null;
  hasOpenAIKey: boolean;
  seed: {
    seeded: boolean;
    seeding: boolean;
    lastError: string | null;
    documentCount: number;
    indexes: { vector: string; text: string };
    progress: string;
  };
};

export async function connect(payload: { uri: string; dbName: string; openaiKey: string }) {
  const res = await client.post('/setup/connect', payload);
  return res.data;
}

export async function getStatus(): Promise<SetupStatus> {
  const res = await client.get('/setup/status');
  return res.data;
}

export async function seedPdf(file: File) {
  const fd = new FormData();
  fd.append('pdf', file);
  const res = await client.post('/setup/seed', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export async function listIndexes() {
  const res = await client.get('/setup/indexes');
  return res.data;
}

export type QAResponse = {
  answer: string;
  references: { policyId: string; sectionId?: string; title?: string }[];
  contextCount: number;
  matches?: {
    policyId: string;
    title: string;
    score: number;
    matchType: string;
    sections: { sectionId: string; title: string }[];
  }[];
};

export async function ask(question: string): Promise<QAResponse> {
  const res = await client.post('/qa/ask', { question });
  return res.data;
}
