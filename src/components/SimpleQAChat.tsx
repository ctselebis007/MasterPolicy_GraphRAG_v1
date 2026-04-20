import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Settings, Database } from 'lucide-react';
import { simpleAsk, getSimpleStatus, type SimpleSetupStatus } from '../lib/api';
import ChatMessage, { type ChatEntry } from './ChatMessage';

export default function SimpleQAChat() {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<SimpleSetupStatus | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getSimpleStatus().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function handleSend() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setLoading(true);
    try {
      const res = await simpleAsk(q);
      setMessages((m) => [...m, { role: 'assistant', content: res.answer || '(no answer)', data: res }]);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err.message || 'Request failed';
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }

  const ready = status?.connected && status.hasOpenAIKey && status.seed?.seeded;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
              <Database className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-900">Simple Q&amp;A</h1>
              <p className="text-xs text-slate-500">
                {status?.connected ? `Connected to ${status.dbName}` : 'Not connected'}
                {status?.seed?.seeded ? ` · ${status.seed.documentCount} policies` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/qa"
              className="text-sm text-slate-600 hover:text-slate-900 font-medium"
            >
              GraphRAG Q&amp;A
            </a>
            <a
              href="/simple-setup"
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 font-medium"
            >
              <Settings className="w-4 h-4" />
              Setup
            </a>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-5">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center mx-auto mb-4">
                <Database className="w-6 h-6 text-blue-700" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Simple Q&amp;A</h2>
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                Questions are answered using simple vector search only — no query expansion, no hybrid search, no graph traversal.
              </p>
              {!ready && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block mt-4">
                  Complete the <a className="underline" href="/simple-setup">Simple RAG Setup page</a> first.
                </p>
              )}
              {ready && (
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    'What does Policy 3.12 cover?',
                    'Summarize the travel reimbursement rules.',
                    'Who approves exceptions in section 5.1?',
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="text-xs bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-700 rounded-full px-3 py-1.5 text-slate-600"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m, i) => (
            <ChatMessage key={i} entry={m} />
          ))}

          {loading && (
            <div className="flex gap-3 items-center text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching Atlas and thinking...
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border-t border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder="Ask a question about the Master Policy..."
              className="flex-1 resize-none border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="btn-primary h-11"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">Enter to send · Shift+Enter for newline</p>
        </div>
      </div>
    </div>
  );
}
