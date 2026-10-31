import { describe, expect, it } from 'vitest';
import { MockAIProvider } from './provider';

describe('MockAIProvider', () => {
  it('returns clearly marked mock content', async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate({ prompt: 'Hello' });
    expect(result.isMock).toBe(true);
    expect(result.content).toContain('MOCK RESPONSE');
  });
});
