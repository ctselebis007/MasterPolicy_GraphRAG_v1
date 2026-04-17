import { Bot, User, BookMarked } from 'lucide-react';
import type { QAResponse } from '../lib/api';
import PipelineSteps from './PipelineSteps';

export type ChatEntry =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; data?: QAResponse };

export default function ChatMessage({ entry }: { entry: ChatEntry }) {
  const isUser = entry.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? 'bg-slate-900 text-white' : 'bg-emerald-600 text-white'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : ''} flex flex-col gap-2`}>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-slate-900 text-white rounded-tr-sm'
              : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm'
          }`}
        >
          <p className="whitespace-pre-wrap">{entry.content}</p>
        </div>
        {!isUser && entry.data?.references && entry.data.references.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {entry.data.references.map((r, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full px-2.5 py-1"
              >
                <BookMarked className="w-3 h-3" />
                Policy {r.sectionId || r.policyId}
                {r.title ? <span className="text-emerald-600">— {r.title}</span> : null}
              </span>
            ))}
          </div>
        )}
        {!isUser && entry.data?.pipeline && entry.data.pipeline.length > 0 && (
          <PipelineSteps steps={entry.data.pipeline} />
        )}
        {!isUser && entry.data?.matches && entry.data.matches.length > 0 && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer hover:text-slate-700">
              Retrieved {entry.data.matches.length} context blocks
            </summary>
            <ul className="mt-1 space-y-0.5 pl-4 list-disc">
              {entry.data.matches.map((m, i) => (
                <li key={i}>
                  <span className="font-mono">Policy {m.policyId}</span> · {m.matchType} · score{' '}
                  {(m.score || 0).toFixed(3)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
