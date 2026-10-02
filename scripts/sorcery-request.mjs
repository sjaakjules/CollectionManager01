#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeSorceryClient } from './lib/sorcery-client.ts';

/** Manual diagnostics and catalogue downloads must use the same host queue. */
export async function downloadSorceryResponse(urlInput, output, { client = nodeSorceryClient, signal } = {}) {
  const url = new URL(urlInput);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !['sorcerytcg.com', 'api.sorcerytcg.com'].includes(url.hostname)) {
    throw new Error('Use an HTTPS URL on sorcerytcg.com or api.sorcerytcg.com');
  }
  const response = await client.fetch(url.href, { headers: {
    accept: 'application/json', 'user-agent': 'SorceryStacks/1.0',
    ...(url.hostname === 'sorcerytcg.com' ? { origin: 'https://sorcerytcg.com', referer: 'https://sorcerytcg.com/' } : {}),
  } }, { signal, onDelay: ({ delayMs, reason }) => console.error(`Waiting ${Math.ceil(delayMs / 1000)}s for SorceryTCG (${reason})`) });
  if (!response.ok) throw new Error(`SorceryTCG returned HTTP ${response.status}; output was not replaced`);
  await writeFile(output, new Uint8Array(await response.arrayBuffer()));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [url, output, ...extra] = process.argv.slice(2);
  if (!url || !output || extra.length > 0) {
    console.error('Usage: pnpm sorcery:request <https-url> <output-file>');
    process.exitCode = 1;
  } else {
    const controller = new AbortController();
    const stop = () => controller.abort(new DOMException('Download cancelled', 'AbortError'));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      await downloadSorceryResponse(url, output, { signal: controller.signal });
      console.log(`Saved SorceryTCG response to ${output}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
}
