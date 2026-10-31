/** Read-only local-AI edit proposal. Parsing never writes to workspace. */
export interface ReviewedEditProposal {
  path: string;
  original: string;
  replacement: string;
  baseRevision: string;
  model: string;
}

const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_REPLY_BYTES = 96 * 1024;

export function parseLocalAiEditProposal(
  response: string,
  path: string,
  original: string,
  baseRevision: string,
  model: string,
): ReviewedEditProposal {
  if (!path || !baseRevision || !model) throw new Error('An open revisioned file and local model are required');
  if (new TextEncoder().encode(response).length > MAX_REPLY_BYTES) {
    throw new Error('The proposed edit response exceeds the 96 KiB limit');
  }
  const trimmed = response.trim();
  const match = trimmed.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i);
  const jsonSource = match ? match[1] : trimmed;
  let value: unknown;
  try {
    value = JSON.parse(jsonSource);
  } catch {
    throw new Error('Local AI must return one JSON object containing exact path and newContent');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Proposed edit must be a JSON object');
  }
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== 2 || typeof obj.path !== 'string' || typeof obj.newContent !== 'string') {
    throw new Error('Only path and newContent are accepted; no commands or extra actions');
  }
  if (obj.path !== path) throw new Error('Model proposed editing a different file');
  const replacement = obj.newContent;
  if (new TextEncoder().encode(replacement).length > MAX_SOURCE_BYTES) {
    throw new Error('Proposed file exceeds 64 KiB');
  }
  if (replacement === original) throw new Error('The model returned no changes');
  return { path, original, replacement, baseRevision, model };
}

export function isProposalCurrent(
  proposal: ReviewedEditProposal,
  path: string,
  contents: string,
  revision: string,
): boolean {
  return proposal.path === path && proposal.original === contents
    && proposal.baseRevision === revision;
}
