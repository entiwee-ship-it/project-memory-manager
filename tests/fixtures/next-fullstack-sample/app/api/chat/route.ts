import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/db';
import { streamChatCompletion } from '../../../lib/claude-client';
import { makeApiCall } from '../../../lib/facebook-client';

async function handleChat(request: NextRequest, message: string) {
  const aiConfig = await prisma.aiConfig.findUnique({ where: { userId: 'test-user' } });
  const conversation = await prisma.conversation.create({
    data: {
      userId: 'test-user',
      title: message,
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: message,
    },
  });
  const stream = new ReadableStream({
    async start(controller) {
      await makeApiCall<{ id: string }>('/me/feed', 'POST');
      const content = await streamChatCompletion([{ role: 'user', content: message }]);
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content,
        },
      });
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

export async function GET(request: NextRequest) {
  return handleChat(request, 'hello');
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  return handleChat(request, body.message);
}
