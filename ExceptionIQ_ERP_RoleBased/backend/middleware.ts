import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ALLOWED = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',');

/** CORS allowlist (the Vite dev server proxies /api, so this is only needed for split-origin deployments). */
export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin');
  const allowed = origin && ALLOWED.includes(origin);
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = origin!;
    headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Max-Age'] = '600';
  }
  if (req.method === 'OPTIONS') return new NextResponse(null, { status: allowed ? 204 : 403, headers });
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}
export const config = { matcher: '/api/:path*' };
