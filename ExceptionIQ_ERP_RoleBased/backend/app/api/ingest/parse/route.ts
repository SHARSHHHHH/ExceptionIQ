import { z } from 'zod';
import { route } from '@/src/http/handler';
import { parseStatementText } from '@/src/ingest/statement';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ text: z.string().max(60_000), currency: z.string().regex(/^[A-Z]{3}$/).default('INR') }).strict();
export const POST = route(({ actor, body }) => parseStatementText(actor, body.text, body.currency ?? 'INR'), { body: Body });
