import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app';
import { loadEnv } from './env';

// Local development reads .env from apps/api or the repository root; production uses real env vars.
const envFile = [resolve('.env'), resolve('../../.env')].find((f) => existsSync(f));
if (envFile) process.loadEnvFile(envFile);

const env = loadEnv();
const app = await buildApp({ env });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: env.HOST, port: env.PORT });
