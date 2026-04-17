import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const POLICY_RE = /^\s*Policy\s+(\d+)\.(\d+)([a-zA-Z])?\b[\s\.:\-]*(.*)$/;
// Match inline references like "Policy 2.71d", "FAQ 2.71d-1", "Policy 8.49", "see 3.12a"
const CROSSREF_RE = /(?:Policy|FAQ|policy|faq|See|see|Section|section)\s+(\d+\.\d+[a-zA-Z]?(?:-\d+)?)/g;

/** Extract the parent policy ID from any reference (e.g. "2.71d-1" → "2.71") */
function toParentId(ref) {
  const m = ref.match(/^(\d+\.\d+)/);
  return m ? m[1] : ref;
}

function extractCrossRefs(text, ownId) {
  const refs = new Set();
  let m;
  while ((m = CROSSREF_RE.exec(text)) !== null) {
    const ref = m[1];
    if (ref !== ownId) refs.add(ref);
  }
  return [...refs];
}

/**
 * Normalize cross-refs to parent-level policy IDs for $graphLookup connectivity.
 * e.g. ["2.71d-1", "2.71d-2", "8.49i"] → ["2.71", "8.49"]
 */
function toParentIds(crossRefs) {
  const ids = new Set();
  for (const ref of crossRefs) {
    ids.add(toParentId(ref));
  }
  return [...ids];
}

export async function parsePdfToHierarchy(buffer) {
  const data = await pdfParse(buffer);
  const rawText = data.text || '';
  const lines = rawText.split(/\r?\n/);

  const parents = new Map();
  let currentParent = null;
  let currentChild = null;
  let bufferLines = [];

  const flushBuffer = () => {
    if (!bufferLines.length) return;
    const text = bufferLines.join('\n').trim();
    if (!text) { bufferLines = []; return; }
    if (currentChild) {
      currentChild.content = (currentChild.content + '\n' + text).trim();
    } else if (currentParent) {
      currentParent.content = (currentParent.content + '\n' + text).trim();
    }
    bufferLines = [];
  };

  for (const line of lines) {
    const m = line.match(POLICY_RE);
    if (m) {
      flushBuffer();
      const major = m[1];
      const minor = m[2];
      const letter = m[3] || '';
      const titleRest = (m[4] || '').trim();
      const parentId = `${major}.${minor}`;
      const childId = letter ? `${major}.${minor}${letter}` : null;

      if (!parents.has(parentId)) {
        parents.set(parentId, {
          policyId: parentId,
          title: !letter ? titleRest : '',
          content: '',
          sections: [],
        });
      }
      currentParent = parents.get(parentId);
      if (!letter && titleRest && !currentParent.title) {
        currentParent.title = titleRest;
      }

      if (childId) {
        currentChild = {
          sectionId: childId,
          title: titleRest,
          content: '',
        };
        currentParent.sections.push(currentChild);
      } else {
        currentChild = null;
      }
    } else {
      bufferLines.push(line);
    }
  }
  flushBuffer();

  // Extract cross-references from content of each parent and its sections
  for (const parent of parents.values()) {
    const allText = [parent.content, ...parent.sections.map((s) => s.content)].join('\n');
    parent.crossRefs = extractCrossRefs(allText, parent.policyId);
    // Normalized parent-level IDs for $graphLookup
    parent.refPolicyIds = toParentIds(parent.crossRefs);
    for (const section of parent.sections) {
      section.crossRefs = extractCrossRefs(section.content, section.sectionId);
    }
  }

  const parentsArr = Array.from(parents.values());
  if (parentsArr.length === 0) {
    const chunks = chunkText(rawText, 1200);
    return chunks.map((c, i) => ({
      policyId: `chunk.${i + 1}`,
      title: `Section ${i + 1}`,
      content: c,
      sections: [],
      crossRefs: [],
      refPolicyIds: [],
    }));
  }
  return parentsArr;
}

export function chunkText(text, size = 1200) {
  const chunks = [];
  const cleaned = text.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < cleaned.length; i += size) {
    chunks.push(cleaned.slice(i, i + size));
  }
  return chunks;
}
