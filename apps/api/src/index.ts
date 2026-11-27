import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { startDevnetSyncLoop } from './devnet-sync.ts';
import { createPercayaStore } from './store.ts';

const port = Number(process.env.PORT || 8787);
const mode =
  process.argv.includes('--chain') || process.env.DATA === 'chain' ? 'chain' : 'demo';
const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const store = createPercayaStore(mode);
const app = createApp(store);

if (mode === 'chain') {
  startDevnetSyncLoop(store, rpcUrl, 15_000);
}

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[percaya-api] listening on http://0.0.0.0:${info.port} (mode=${mode})`);
});
