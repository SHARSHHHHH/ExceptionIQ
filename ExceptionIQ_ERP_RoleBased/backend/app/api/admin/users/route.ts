import { route } from '@/src/http/handler';
import { listUsers } from '@/src/workflow/users';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ actor }) => ({ users: listUsers(actor) }));
