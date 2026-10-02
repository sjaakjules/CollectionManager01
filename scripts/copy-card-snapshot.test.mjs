import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'vitest';

const exec = promisify(execFile);

test('snapshot updates normalize the new format and never replace a good file with partial data', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sorcery-catalog-test-'));
  const output = path.join(dir, 'snapshot.json');
  const input = path.join(dir, 'incoming.json');
  try {
    await exec(process.execPath, ['scripts/copy-card-snapshot.mjs',
      '--input', 'src/data/__fixtures__/sorcery-engine-cards.json', '--output', output]);
    const good = await readFile(output, 'utf8');
    const cards = JSON.parse(good);
    assert.equal(cards.length, 3);
    assert.equal(cards[0].guardian.type, 'Minion');
    assert.ok(cards[0].sets[0].variants.length > 0);

    // The old script only checked the first five records.
    const previews = Array.from({ length: 5 }, (_, i) => ({
      name: `Preview ${i}`, engine: { type: 'Trap' },
    }));
    await writeFile(input, JSON.stringify([...previews, { name: 'Broken sixth card' }]));
    await assert.rejects(exec(process.execPath, ['scripts/copy-card-snapshot.mjs', '--input', input, '--output', output]),
      /Broken sixth card/);
    assert.equal(await readFile(output, 'utf8'), good);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
