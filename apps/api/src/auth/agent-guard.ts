import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { AppError, unauthorized } from '../errors';
import { verifyAgentToken } from './tokens';

export interface AgentSession {
  agentId: string;
  fullName: string;
  code: string;
  phone: string | null;
  mustChangePassword: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    agent?: AgentSession;
  }
}

async function load(request: FastifyRequest): Promise<AgentSession> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const { clock, tokenKeys, db } = request.server;
  const claims = await verifyAgentToken(header.slice('Bearer '.length), tokenKeys, clock.now());
  if (!claims) throw unauthorized();
  // A suspended agent's token stops working at once, not when it expires
  const [row] = await db.execute<{
    id: string;
    full_name: string;
    code: string;
    phone: string | null;
    must_change_password: boolean;
  }>(sql`select * from agent_session(${claims.agentId}::uuid)`);
  if (!row) throw unauthorized();
  const session = {
    agentId: row.id,
    fullName: row.full_name,
    code: row.code,
    phone: row.phone,
    mustChangePassword: row.must_change_password,
  };
  request.agent = session;
  return session;
}

/** preHandler for the agent portal: a token of the agent realm only, for an agent who is still active. */
export async function requireAgent(request: FastifyRequest): Promise<void> {
  const session = await load(request);
  // The password the owner gave him is for the first sign-in only: nothing else opens until he changes it
  if (session.mustChangePassword) {
    throw new AppError(403, 'forbidden', 'غيّر كلمة السر المؤقتة أولاً.');
  }
}

/** The same, for the two routes a new agent may use before he has changed his password. */
export async function requireAgentAnyState(request: FastifyRequest): Promise<void> {
  await load(request);
}
