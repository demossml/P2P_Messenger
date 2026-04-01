import { env } from './env.js';
import { SignalingServer } from './signaling-server.js';

function bootstrap(): void {
  const server = new SignalingServer();
  server.start();
  console.log(`[server] signaling runtime started on port ${env.PORT}`);
}

bootstrap();
