import { describe, expect, it } from 'vitest';
import { isProposalCurrent, parseLocalAiEditProposal } from './editProposal';

const path = 'C:/dev/mod/data/ruby/items/ruby.json';
const revision = 'e'.repeat(64);
const before = '{"item":"ruby"}';

describe('local AI reviewed edits', () => {
  it('parses only exact path + newContent as a non-executing edit', () => {
    const proposal = parseLocalAiEditProposal(
      JSON.stringify({ path, newContent: '{"item":"ruby","glow":true}' }),
      path, before, revision, 'qwen-local',
    );
    expect(proposal.replacement).toBe('{"item":"ruby","glow":true}');
    expect(isProposalCurrent(proposal, path, before, revision)).toBe(true);
    expect(isProposalCurrent(proposal, path, before + ' ', revision)).toBe(false);
    expect(isProposalCurrent(proposal, path, before, 'f'.repeat(64))).toBe(false);
    expect(isProposalCurrent(proposal, 'C:/elsewhere.json', before, revision)).toBe(false);
  });

  it('rejects unauthorized file targets, shell-like actions and unstructured prose', () => {
    for (const reply of [
      'Please change this file',
      JSON.stringify({ path: 'C:/dev/secret.txt', newContent: 'stolen' }),
      JSON.stringify({ path, newContent: 'x', command: 'powershell -c rm' }),
      JSON.stringify({ path, newContent: 'x', execute: true }),
      JSON.stringify([{ path, newContent: 'x' }]),
    ]) {
      expect(() => parseLocalAiEditProposal(reply, path, before, revision, 'qwen-local')).toThrow();
    }
  });

  it('accepts JSON fenced blocks but not empty or unchanged files', () => {
    const reply = '\`\`\`json\n' + JSON.stringify({ path, newContent: 'edited' }) + '\n\`\`\`';
    expect(parseLocalAiEditProposal(reply, path, before, revision, 'qwen-local').replacement).toBe('edited');
    expect(() => parseLocalAiEditProposal(
      JSON.stringify({ path, newContent: before }), path, before, revision, 'qwen-local',
    )).toThrow('no changes');
  });

  it('refuses oversized model output and file replacement', () => {
    expect(() => parseLocalAiEditProposal(
      JSON.stringify({ path, newContent: 'x'.repeat(65 * 1024) }),
      path, before, revision, 'qwen-local',
    )).toThrow();
    expect(() => parseLocalAiEditProposal(
      'x'.repeat(100 * 1024), path, before, revision, 'qwen-local',
    )).toThrow();
  });
});
