import { useEffect, useRef, useState } from 'react';
import { Database, KeyRound, Upload, CheckCircle2, AlertTriangle, Loader2, Link as LinkIcon, FileText } from 'lucide-react';
import { simpleConnect, getSimpleStatus, simpleSeedPdf, simpleListIndexes, type SimpleSetupStatus } from '../lib/api';

export default function SetupSimpleRAG() {
  const [uri, setUri] = useState(() => localStorage.getItem('setup_uri') || '');
  const [dbName, setDbName] = useState(() => localStorage.getItem('setup_dbName') || 'masterpolicy');
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem('setup_openaiKey') || '');
  const [status, setStatus] = useState<SimpleSetupStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [indexInfo, setIndexInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try { setStatus(await getSimpleStatus()); } catch {}
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      await simpleConnect({ uri, dbName, openaiKey });
      localStorage.setItem('setup_uri', uri);
      localStorage.setItem('setup_dbName', dbName);
      localStorage.setItem('setup_openaiKey', openaiKey);
      await refresh();
    } catch (err: any) {
      setConnectError(err?.response?.data?.error || err.message || 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }

  async function handleSeed() {
    if (!pdfFile) return;
    setSeeding(true);
    setSeedError(null);
    try {
      await simpleSeedPdf(pdfFile);
      await refresh();
    } catch (err: any) {
      setSeedError(err?.response?.data?.error || err.message || 'Seed failed');
    } finally {
      setSeeding(false);
    }
  }

  async function handleCheckIndexes() {
    try {
      const data = await simpleListIndexes();
      const rows = (data.indexes || []).map((i: any) => `${i.name}: ${i.status || i.queryable ? 'queryable' : 'building'}`).join('\n');
      setIndexInfo(rows || 'No search indexes yet.');
    } catch (err: any) {
      setIndexInfo(err?.response?.data?.error || err.message);
    }
  }

  const connected = !!status?.connected;
  const seeded = !!status?.seed?.seeded;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Setup Simple RAG</h1>
              <p className="text-xs text-slate-500">MongoDB Atlas Vector Search + GPT-4o (No enrichment, no hybrid, no graph)</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a href="/setup" className="text-sm text-slate-600 hover:text-slate-900 font-medium">
              Setup GraphRAG
            </a>
            <a href="/simple-qa" className="text-sm text-blue-700 hover:text-blue-900 font-medium">
              Go to Simple Q&amp;A
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 grid lg:grid-cols-5 gap-8">
        <section className="lg:col-span-3 space-y-6">
          <Card>
            <CardHeader
              icon={<LinkIcon className="w-4 h-4" />}
              title="1. Connect to MongoDB Atlas"
              subtitle="Your URI is held in server memory only."
            />
            <div className="space-y-4 mt-4">
              <Field label="MongoDB URI">
                <input
                  type="password"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="mongodb+srv://user:pass@cluster.mongodb.net/"
                  className="input"
                />
              </Field>
              <Field label="Database Name">
                <input value={dbName} onChange={(e) => setDbName(e.target.value)} className="input" />
              </Field>
              <Field label="OpenAI API Key">
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                    className="input pl-9"
                  />
                </div>
              </Field>
              {connectError && <Alert tone="error">{connectError}</Alert>}
              <button
                onClick={handleConnect}
                disabled={connecting || !uri || !dbName || !openaiKey}
                className="btn-primary"
              >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
                Connect &amp; save
              </button>
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={<FileText className="w-4 h-4" />}
              title="2. Seed the Master Policy PDF"
              subtitle="Parses hierarchy, embeds with plain text (no enrichment), vector index only."
            />
            <div className="space-y-4 mt-4">
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/40 transition-colors"
              >
                <Upload className="w-6 h-6 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-700 font-medium">
                  {pdfFile ? pdfFile.name : 'Click to select MasterPolicy PDF'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Max 50 MB. PDF only.</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                />
              </div>
              {seedError && <Alert tone="error">{seedError}</Alert>}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSeed}
                  disabled={!connected || !pdfFile || seeding}
                  className="btn-primary"
                >
                  {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Parse, embed, &amp; create index
                </button>
                <button onClick={handleCheckIndexes} disabled={!connected} className="btn-secondary">
                  Check index status
                </button>
              </div>
              {status?.seed?.progress && (
                <p className="text-xs text-slate-600 bg-slate-100 rounded p-2 font-mono">{status.seed.progress}</p>
              )}
              {indexInfo && (
                <pre className="text-xs text-slate-700 bg-slate-100 rounded p-3 whitespace-pre-wrap">{indexInfo}</pre>
              )}
            </div>
          </Card>
        </section>

        <aside className="lg:col-span-2 space-y-4">
          <Card>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Status</h3>
            <StatusRow ok={connected} label={connected ? `Connected to ${status?.dbName}` : 'MongoDB not connected'} />
            <StatusRow ok={!!status?.hasOpenAIKey} label={status?.hasOpenAIKey ? 'OpenAI key set' : 'OpenAI key missing'} />
            <StatusRow ok={seeded} label={seeded ? `Seeded (${status?.seed?.documentCount} policies)` : 'Not seeded'} />
            <div className="mt-3 text-xs text-slate-500 space-y-1">
              <div>Vector index: <span className="font-mono">{status?.seed?.indexes?.vector || '—'}</span></div>
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">How Simple RAG works</h3>
            <ol className="text-xs text-slate-600 space-y-2 list-decimal pl-4">
              <li><span className="font-semibold text-slate-700">Hierarchical Chunking</span> — PDF is parsed into parent policies (<code className="text-blue-700">Policy X.XX</code>) with nested child sections (<code className="text-blue-700">Policy X.XXa</code>). Same structure as GraphRAG.</li>
              <li><span className="font-semibold text-slate-700">Plain Embeddings</span> — Each parent &amp; section is embedded with <code className="text-blue-700">text-embedding-3-small</code> using raw text only. <strong>No enrichment</strong> with cross-references, summaries, or parent context.</li>
              <li><span className="font-semibold text-slate-700">Vector Index Only</span> — Only a vector search index (<code className="text-blue-700">$vectorSearch</code>) is created. <strong>No text search index</strong>.</li>
              <li><span className="font-semibold text-slate-700">Simple Vector Search</span> — User questions are searched directly against parent + child embeddings. <strong>No query expansion</strong>, <strong>no hybrid search</strong>.</li>
              <li><span className="font-semibold text-slate-700">No Graph Traversal</span> — <strong>No <code className="text-blue-700">$graphLookup</code></strong>, no cross-reference following. Results come purely from vector similarity.</li>
              <li><span className="font-semibold text-slate-700">LLM Answer Generation</span> — GPT-4o synthesizes an answer from retrieved contexts only, citing specific policy numbers.</li>
            </ol>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Simple RAG vs GraphRAG</h3>
            <div className="text-xs text-slate-600 space-y-1">
              <div className="flex justify-between"><span>Enriched embeddings</span><span className="font-mono text-red-600">No</span></div>
              <div className="flex justify-between"><span>Text search ($search)</span><span className="font-mono text-red-600">No</span></div>
              <div className="flex justify-between"><span>Query expansion</span><span className="font-mono text-red-600">No</span></div>
              <div className="flex justify-between"><span>Hybrid search</span><span className="font-mono text-red-600">No</span></div>
              <div className="flex justify-between"><span>$graphLookup traversal</span><span className="font-mono text-red-600">No</span></div>
              <div className="flex justify-between"><span>Hierarchical chunking</span><span className="font-mono text-emerald-600">Yes</span></div>
              <div className="flex justify-between"><span>Vector search</span><span className="font-mono text-emerald-600">Yes</span></div>
            </div>
          </Card>

          <div className="text-xs text-slate-400 text-center">
            Vector index may take 1–5 minutes on Atlas to reach READY.
          </div>
        </aside>
      </main>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">{children}</div>;
}
function CardHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-md bg-blue-50 text-blue-700 flex items-center justify-center">{icon}</div>
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1.5">{label}</span>
      {children}
    </label>
  );
}
function StatusRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm py-1">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-blue-600" />
      ) : (
        <AlertTriangle className="w-4 h-4 text-amber-500" />
      )}
      <span className={ok ? 'text-slate-700' : 'text-slate-500'}>{label}</span>
    </div>
  );
}
function Alert({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  const cls =
    tone === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-sky-50 border-sky-200 text-sky-800';
  return <div className={`text-xs border rounded p-2 ${cls}`}>{children}</div>;
}
