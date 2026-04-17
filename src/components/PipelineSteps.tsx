import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, Search, GitBranch, Sparkles, Zap, CheckCircle2, Copy, Check, Code2 } from 'lucide-react';
import type { PipelineStep } from '../lib/api';

const STEP_ICONS: Record<string, typeof Clock> = {
  'Query Expansion': Sparkles,
  'Hybrid Search': Search,
  'Graph Traversal': GitBranch,
  'Dedup & Rank': Zap,
  'LLM Generation': Sparkles,
  'Total': CheckCircle2,
};

const STEP_COLORS: Record<string, string> = {
  'Query Expansion': 'text-violet-600 bg-violet-50 border-violet-200',
  'Hybrid Search': 'text-blue-600 bg-blue-50 border-blue-200',
  'Graph Traversal': 'text-amber-600 bg-amber-50 border-amber-200',
  'Dedup & Rank': 'text-cyan-600 bg-cyan-50 border-cyan-200',
  'LLM Generation': 'text-emerald-600 bg-emerald-50 border-emerald-200',
  'Total': 'text-slate-600 bg-slate-50 border-slate-200',
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function PipelineSteps({ steps }: { steps: PipelineStep[] }) {
  const [open, setOpen] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const total = steps.find((s) => s.step === 'Total');
  const visibleSteps = steps.filter((s) => s.step !== 'Total');

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
      {/* Toggle header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Zap className="w-3.5 h-3.5 text-emerald-500" />
          Pipeline Steps
          <span className="text-slate-400">({visibleSteps.length} steps)</span>
        </div>
        {total && (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
            <Clock className="w-3 h-3" />
            {formatMs(total.durationMs)}
          </span>
        )}
      </button>

      {/* Steps timeline */}
      {open && (
        <div className="px-3 pb-3 pt-1">
          <div className="relative">
            {/* Vertical connector line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-slate-200" />

            <div className="space-y-1">
              {visibleSteps.map((step, i) => {
                const Icon = STEP_ICONS[step.step] || Clock;
                const colors = STEP_COLORS[step.step] || 'text-slate-600 bg-slate-50 border-slate-200';
                const isExpanded = expandedStep === i;

                return (
                  <div key={i} className="relative pl-9">
                    {/* Step icon */}
                    <div
                      className={`absolute left-0 top-1 w-[30px] h-[30px] rounded-full border flex items-center justify-center ${colors}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>

                    {/* Step content */}
                    <div
                      className={`rounded-lg border transition-colors ${
                        isExpanded ? 'border-slate-300 bg-slate-50' : 'border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <button
                        onClick={() => setExpandedStep(isExpanded ? null : i)}
                        className="w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-slate-800">{step.step}</span>
                          <p className="text-[11px] text-slate-500 truncate">{step.description}</p>
                        </div>
                        <span className="flex-shrink-0 text-[11px] font-mono text-slate-400 tabular-nums">
                          {formatMs(step.durationMs)}
                        </span>
                      </button>

                      {isExpanded && step.detail && (
                        <div className="px-2.5 pb-2">
                          <div className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-md p-2 font-mono leading-relaxed overflow-x-auto max-h-40 overflow-y-auto">
                            {formatDetail(step.detail)}
                          </div>
                        </div>
                      )}
                      {isExpanded && step.pipelines && (
                        <div className="px-2.5 pb-2 space-y-2">
                          {Object.entries(step.pipelines).map(([name, pipeline]) => (
                            <AggregationBlock key={name} name={name} pipeline={pipeline} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Timing bar */}
          {total && (
            <div className="mt-3 pt-2 border-t border-slate-100">
              <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-slate-100">
                {visibleSteps
                  .filter((s) => s.durationMs > 0)
                  .map((s, i) => {
                    const pct = Math.max(2, (s.durationMs / total.durationMs) * 100);
                    const color = {
                      'Query Expansion': 'bg-violet-400',
                      'Hybrid Search': 'bg-blue-400',
                      'Graph Traversal': 'bg-amber-400',
                      'Dedup & Rank': 'bg-cyan-400',
                      'LLM Generation': 'bg-emerald-400',
                    }[s.step] || 'bg-slate-400';
                    return (
                      <div
                        key={i}
                        className={`${color} rounded-full transition-all`}
                        style={{ width: `${pct}%` }}
                        title={`${s.step}: ${formatMs(s.durationMs)}`}
                      />
                    );
                  })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                {visibleSteps
                  .filter((s) => s.durationMs > 0)
                  .map((s, i) => {
                    const dotColor = {
                      'Query Expansion': 'bg-violet-400',
                      'Hybrid Search': 'bg-blue-400',
                      'Graph Traversal': 'bg-amber-400',
                      'Dedup & Rank': 'bg-cyan-400',
                      'LLM Generation': 'bg-emerald-400',
                    }[s.step] || 'bg-slate-400';
                    return (
                      <span key={i} className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                        {s.step}
                      </span>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDetail(detail: Record<string, unknown>): React.ReactNode {
  const entries = Object.entries(detail);
  return (
    <div className="space-y-1">
      {entries.map(([key, val]) => (
        <div key={key}>
          <span className="text-slate-400">{key}: </span>
          <span className="text-slate-700">
            {Array.isArray(val)
              ? val.length <= 8
                ? val.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')
                : `[${val.length} items]`
              : typeof val === 'object'
              ? JSON.stringify(val)
              : String(val)}
          </span>
        </div>
      ))}
    </div>
  );
}

function AggregationBlock({ name, pipeline }: { name: string; pipeline: unknown }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const json = JSON.stringify(pipeline, null, 2);

  function handleCopy() {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-900">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-800 hover:bg-slate-700 transition-colors"
      >
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <Code2 className="w-3 h-3 text-emerald-400" />
          {name}
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          {Array.isArray(pipeline) ? 'aggregate' : 'find'}
        </span>
      </button>
      {expanded && (
        <div className="relative">
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded px-2 py-1 transition-colors z-10"
            title="Copy to clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                Copy
              </>
            )}
          </button>
          <pre className="p-3 pr-20 text-[11px] leading-relaxed text-emerald-300 overflow-x-auto max-h-64 overflow-y-auto font-mono">
            <code>{json}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
