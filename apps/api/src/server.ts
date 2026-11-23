import { config } from './config.js';
import { prisma } from './db.js';
import { createApp } from './app.js';

const app = createApp({ prisma });
const server = app.listen(config.PORT, '0.0.0.0', () => {
  console.info(JSON.stringify({ event: 'server_started', port: config.PORT, timeZone: 'Asia/Kolkata' }));
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.info(JSON.stringify({ event: 'server_shutdown', signal }));
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
