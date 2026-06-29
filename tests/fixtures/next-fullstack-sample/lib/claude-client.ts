import Anthropic from '@anthropic-ai/sdk';

export async function streamChatCompletion(messages: Array<{ role: string; content: string }>): Promise<string> {
  const client = new Anthropic({ apiKey: 'test-key' });
  const stream = await client.messages.create({
    model: 'claude-test',
    max_tokens: 256,
    messages,
    stream: true,
  });
  let output = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      output += event.delta.text;
    }
  }
  return output;
}
