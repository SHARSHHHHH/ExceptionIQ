import { z } from 'zod';
import { route } from '@/src/http/handler';
import { DomainError } from '@/src/domain/types';
import { CSV_HEADER, importStatement, parseCsv, type StatementRow } from '@/src/ingest/statement';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Row = z.object(Object.fromEntries(CSV_HEADER.map((h) => [h, z.string().max(200)])) as Record<(typeof CSV_HEADER)[number], z.ZodString>).strict();
const Body = z.object({
  entityId: z.string().min(2).max(10),
  csv: z.string().max(200_000).optional(),
  rows: z.array(Row).max(200).optional(),
  autoInvestigate: z.boolean().optional(),
  source: z.enum(['CSV', 'AI_PARSED', 'SAMPLE']).optional(),
}).strict();

export const POST = route(({ actor, body }) => {
  let rows = body.rows as StatementRow[] | undefined;
  if (!rows) {
    if (!body.csv) throw new DomainError('VALIDATION_FAILED', 'Provide csv or rows', 400);
    const parsed = parseCsv(body.csv);
    if (parsed.errors.length) throw new DomainError('VALIDATION_FAILED', parsed.errors.join('; '), 400);
    rows = parsed.rows;
  }
  return importStatement(actor, body.entityId, rows, { autoInvestigate: body.autoInvestigate, source: body.source });
}, { body: Body });
