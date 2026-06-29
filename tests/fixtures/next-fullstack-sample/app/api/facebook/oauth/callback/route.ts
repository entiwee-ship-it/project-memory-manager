import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';

export async function GET(request: NextRequest) {
  const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
    params: { code: request.nextUrl.searchParams.get('code') },
  });
  await prisma.facebookConnection.upsert({
    where: { userId: 'test-user' },
    update: { facebookUserId: tokenResponse.data.user_id },
    create: { userId: 'test-user', facebookUserId: tokenResponse.data.user_id },
  });
  return NextResponse.json({ success: true });
}
