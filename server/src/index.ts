import 'dotenv/config';
import { createDugoutServer } from './server.js';

const port = Number(process.env.PORT ?? 8787);
const isProduction = process.env.NODE_ENV === 'production';

const tokenSecret = process.env.DUGOUTCALL_TOKEN_SECRET;
if (isProduction && !tokenSecret) {
  throw new Error(
    'DUGOUTCALL_TOKEN_SECRET must be set in production. Refusing to start with the development secret.'
  );
}

const corsOrigins = process.env.DUGOUTCALL_CORS_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const { server } = createDugoutServer({
  tokenSecret: tokenSecret ?? 'local-development-secret-change-me',
  isProduction,
  corsOrigins
});

server.listen(port, () => {
  console.log(`DugoutCall server listening on http://localhost:${port}`);
});
