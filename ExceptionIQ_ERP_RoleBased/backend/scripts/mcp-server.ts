/**
 * ExceptionIQ MCP server (stdio). Exposes ONLY the read tools from the allowlist, each routed through
 * the same ToolGateway as the in-app agent, so scope checks, budgets, redaction and audit logging are identical.
 * Write tools are deliberately not exposed over MCP.
 *
 *   MCP_ACTOR_EMAIL=asha.analyst@exceptioniq.demo npm run mcp
 *   npx @modelcontextprotocol/inspector npx tsx scripts/mcp-server.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getDb } from '../src/db';
import { actorFromUser, SERVICE_ACTORS } from '../src/security/session';
import { requirePermission } from '../src/security/rbac';
import { ToolGateway } from '../src/tools/gateway';
import { AGENT_TOOLS, TOOLS } from '../src/tools/registry';
import { loadCaseFor } from '../src/workflow/cases';
import { Actor } from '../src/domain/types';

const db = getDb();
const email = process.env.MCP_ACTOR_EMAIL ?? 'asha.analyst@exceptioniq.demo';
const row = db.prepare('SELECT * FROM users WHERE email=?').get(email) as Parameters<typeof actorFromUser>[0] | undefined;
if (!row) { console.error(`Unknown MCP_ACTOR_EMAIL ${email}`); process.exit(1); }
const human: Actor = actorFromUser(row);
requirePermission(human, 'case:investigate');

// One gateway per case for the session, so scope expands only through evidence actually retrieved.
const gateways = new Map<string, ToolGateway>();
function gatewayFor(caseId: string): ToolGateway {
  const kase = loadCaseFor(db, human, caseId); // entity boundary
  let g = gateways.get(caseId);
  if (!g) { g = new ToolGateway(db, kase, 9000 + gateways.size, SERVICE_ACTORS.agent, human); gateways.set(caseId, g); }
  return g;
}

const server = new McpServer({ name: 'exceptioniq', version: '2.0.0' });
for (const name of AGENT_TOOLS) {
  const contract = TOOLS[name];
  const shape = (contract.input as z.ZodObject<z.ZodRawShape>).shape;
  server.registerTool(name.replace('.', '_'), {
    title: name,
    description: `${contract.description} Boundary: ${contract.boundary} (read-only; governed by ExceptionIQ gateway)`,
    inputSchema: { case_id: z.string().describe('ExceptionIQ case ID, e.g. CASE-104'), ...shape },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (input: Record<string, unknown>) => {
    const { case_id, ...args } = input;
    try {
      const r = gatewayFor(String(case_id)).call(name, args, 'MCP client request', 'agent');
      const body = r.decision === 'ALLOWED'
        ? { decision: r.decision, toolCallId: r.toolCallId, records: r.records.map(({ kind, id, version, hash, data }) => ({ kind, id, version, hash, data })) }
        : { decision: r.decision, toolCallId: r.toolCallId, reasonCode: r.reasonCode, reason: r.reason };
      return { content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }], isError: r.decision !== 'ALLOWED' };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: (e as Error).message }) }], isError: true };
    }
  });
}

await server.connect(new StdioServerTransport());
console.error(`ExceptionIQ MCP server ready (actor ${human.name}, tools: ${AGENT_TOOLS.join(', ')})`);
