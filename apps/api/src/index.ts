import { serve } from '@hono/node-server';
import { createApp } from './app.ts';

const port = Number(process.env.PORT || 8787);
const app = createApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[percaya-api] listening on http://localhost:${info.port} (mode=${process.env.DATA || 'demo'})`,
  );
});
