import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';

export async function GET() {
  const connection = await prisma.facebookConnection.findUnique({ where: { userId: 'test-user' } });
  return NextResponse.json({ connected: Boolean(connection) });
}
