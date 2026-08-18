import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDugoutCallApp } from './app.js';
import { attachWebSocketServer } from './websocket.js';

const port = Number(process.env.PORT ?? 8787);
const tokenSecret = process.env.DUGOUTCALL_TOKEN_SECRET ?? 'local-development-secret-change-me';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoWebPath = path.resolve(__dirname, '../../demo-web');
const { app, rooms, diagnostics } = createDugoutCallApp({ tokenSecret, demoWebPath });

const server = http.createServer(app);
attachWebSocketServer(server, rooms, diagnostics, tokenSecret);

server.listen(port, () => {
  console.log(`DugoutCall server listening on http://localhost:${port}`);
});
