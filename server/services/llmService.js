import { getOpenAIClient } from './embeddingService.js';

const SYSTEM_PROMPT = `You are a Master Policy assistant. Answer the user's question strictly using the POLICY CONTEXT provided.

The context includes policies retrieved by semantic search AND graph-connected policies found by traversing cross-references. Pay special attention to graph-connected policies (marked as graph-hop or graph-reverse) — they are related policies discovered by following reference chains and often contain crucial details, exceptions, or FAQs that directly answer the question.

Rules:
- THOROUGHLY read ALL provided context including every sub-section, FAQ, and cross-referenced policy before answering.
- Synthesize information across multiple policies when they reference each other. A question about one policy may be answered by combining its content with cross-referenced policies.
- For each sub-section/FAQ in the context, read its FULL content and incorporate relevant details into the answer — do not just cite the section number.
- If a policy mentions BDIP, divestiture, mutual funds, or account requirements, check ALL related sub-sections for exceptions, grandfathering rules, and regional exemptions.
- Cite the specific Policy numbers you used (e.g. "Policy 3.12" or "Policy 3.12a" or "FAQ 2.71d-1").
- Quote or paraphrase concisely. Do not invent facts.
- Preserve parent/child relationships: when a child section answers, also reference its parent policy.
- If the answer is not contained in the context, say you could not find it in the policy.
Return a JSON object with keys: "answer" (string), "references" (array of {policyId, sectionId?, title}).`;

function formatContext(hits) {
  // Sort: direct matches first, then graph-connected
  const sorted = [...hits].sort((a, b) => {
    const aGraph = a.matchType?.startsWith('graph') ? 1 : 0;
    const bGraph = b.matchType?.startsWith('graph') ? 1 : 0;
    if (aGraph !== bGraph) return aGraph - bGraph;
    return (b.score || 0) - (a.score || 0);
  });

  return sorted
    .map((h, i) => {
      const sectionsText = (h.sections || [])
        .map((s) => {
          const refNote = (s.crossRefs && s.crossRefs.length) ? `  [Cross-refs: ${s.crossRefs.join(', ')}]` : '';
          return `  - Policy ${s.sectionId} ${s.title ? `— ${s.title}` : ''}${refNote}\n    ${s.content || ''}`;
        })
        .join('\n');
      const parentRefs = (h.crossRefs && h.crossRefs.length) ? `\nCross-references: ${h.crossRefs.join(', ')}` : '';
      const graphLabel = h.matchType?.startsWith('graph')
        ? ` ⟵ GRAPH-CONNECTED (found via cross-reference traversal — READ CAREFULLY)`
        : '';
      return `# Context ${i + 1} (matchType=${h.matchType}, score=${(h.score || 0).toFixed(3)})${graphLabel}
Policy ${h.policyId}${h.title ? ` — ${h.title}` : ''}${parentRefs}
${h.content || ''}
${sectionsText ? `\nSub-sections (READ ALL OF THESE):\n${sectionsText}` : ''}`;
    })
    .join('\n\n---\n\n');
}

export async function answerWithContext(question, hits) {
  const client = getOpenAIClient();
  const context = formatContext(hits);
  const userMsg = `POLICY CONTEXT:\n${context}\n\nQUESTION: ${question}\n\nRespond with a single JSON object only.`;

  const resp = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
  });

  const raw = resp.choices[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = { answer: raw, references: [] }; }
  return {
    answer: parsed.answer || '',
    references: Array.isArray(parsed.references) ? parsed.references : [],
    contextCount: hits.length,
  };
}
