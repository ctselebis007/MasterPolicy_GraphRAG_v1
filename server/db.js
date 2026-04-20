import { MongoClient } from 'mongodb';

const state = {
  client: null,
  db: null,
  dbName: null,
  uri: null,
  openaiKey: null,
  seedStatus: {
    seeded: false,
    seeding: false,
    lastError: null,
    documentCount: 0,
    indexes: { vector: 'not_created', text: 'not_created' },
    progress: '',
  },
  simpleSeedStatus: {
    seeded: false,
    seeding: false,
    lastError: null,
    documentCount: 0,
    indexes: { vector: 'not_created' },
    progress: '',
  },
};

export async function connectDb({ uri, dbName }) {
  if (!uri || !dbName) {
    throw new Error('Missing MongoDB URI or database name');
  }
  if (state.client) {
    try { await state.client.close(); } catch (_) {}
  }
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();
  await client.db(dbName).command({ ping: 1 });
  state.client = client;
  state.db = client.db(dbName);
  state.dbName = dbName;
  state.uri = uri;
  return state.db;
}

export function getDb() {
  if (!state.db) {
    throw new Error('Database not connected. Run /api/setup/connect first.');
  }
  return state.db;
}

export function setOpenAIKey(key) {
  state.openaiKey = key;
}

export function getOpenAIKey() {
  if (!state.openaiKey) {
    throw new Error('OpenAI API key not set. Configure it on the Setup page.');
  }
  return state.openaiKey;
}

export function getStatus() {
  return {
    connected: !!state.db,
    dbName: state.dbName,
    hasOpenAIKey: !!state.openaiKey,
    seed: state.seedStatus,
  };
}

export function getSimpleStatus() {
  return {
    connected: !!state.db,
    dbName: state.dbName,
    hasOpenAIKey: !!state.openaiKey,
    seed: state.simpleSeedStatus,
  };
}

export function getSeedStatus() {
  return state.seedStatus;
}

export function updateSeedStatus(patch) {
  state.seedStatus = { ...state.seedStatus, ...patch };
}

export function getSimpleSeedStatus() {
  return state.simpleSeedStatus;
}

export function updateSimpleSeedStatus(patch) {
  state.simpleSeedStatus = { ...state.simpleSeedStatus, ...patch };
}
