import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const POLICY_RE = /^\s*Policy\s+(\d+)\.(\d+)([a-zA-Z])?\b[\s\.:\-]*(.*)$/;

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

  const parentsArr = Array.from(parents.values());
  if (parentsArr.length === 0) {
    const chunks = chunkText(rawText, 1200);
    return chunks.map((c, i) => ({
      policyId: `chunk.${i + 1}`,
      title: `Section ${i + 1}`,
      content: c,
      sections: [],
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
