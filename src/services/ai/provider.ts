export interface AIRequest {
  prompt: string;
}

export interface AIResponse {
  content: string;
  isMock: boolean;
}

export interface AIProvider {
  id: string;
  label: string;
  generate(request: AIRequest): Promise<AIResponse>;
}

export class MockAIProvider implements AIProvider {
  readonly id = 'mock';
  readonly label = 'Mock Provider';

  async generate(request: AIRequest): Promise<AIResponse> {
    return {
      isMock: true,
      content: `MOCK RESPONSE\n\nPrompt: ${request.prompt}\n\nThis is placeholder AI output. Integrate a real provider before production use.`,
    };
  }
}
