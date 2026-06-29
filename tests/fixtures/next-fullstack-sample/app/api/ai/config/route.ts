import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

export async function GET() {
  const config = await prisma.aiConfig.findUnique({ where: { userId: 'test-user' } });
  return NextResponse.json({ success: true, config });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  await prisma.aiConfig.upsert({
    where: { userId: 'test-user' },
    update: { model: body.model },
    create: { userId: 'test-user', model: body.model },
  });
  return NextResponse.json({ success: true });
}
