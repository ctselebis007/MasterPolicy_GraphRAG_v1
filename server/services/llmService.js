import { getOpenAIClient } from './embeddingService.js';

const SYSTEM_PROMPT = `You are a Master Policy assistant. Answer the user's question strictly using the POLICY CONTEXT provided.
Rules:
- If the answer is not contained in the context, say you could not find it in the policy.
- Cite the specific Policy numbers you used (e.g. "Policy 3.12" or "Policy 3.12a").
- Quote or paraphrase concisely. Do not invent facts.
- Preserve parent/child relationships: when a child section answers, also reference its parent policy.
Return a JSON object with keys: "answer" (string), "references" (array of {policyId, sectionId?, title}).`;

function formatContext(hits) {
  return hits
    .map((h, i) => {
      const sectionsText = (h.sections || [])
        .map((s) => `  - Policy ${s.sectionId} ${s.title ? `— ${s.title}` : ''}\n    ${s.content || ''}`)
        .join('\n');
      return `# Context ${i + 1} (matchType=${h.matchType}, score=${(h.score || 0).toFixed(3)})
Policy ${h.policyId}${h.title ? ` — ${h.title}` : ''}
${h.content || ''}
${sectionsText ? `\nSub-sections:\n${sectionsText}` : ''}`;
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
