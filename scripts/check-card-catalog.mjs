#!/usr/bin/env node
import { readCardCatalog } from './lib/card-catalog.mjs';

const input = process.argv[2] ?? 'docs/Sorcery_CardInfo.json';
try {
  const { cards, issues } = await readCardCatalog(input);
  console.log(`Validated ${cards.length} cards from ${input}`);
  console.log(`Types: ${[...new Set(cards.map((card) => card.guardian.type))].sort().join(', ')}`);
  console.log(`Sets: ${[...new Set(cards.flatMap((card) => card.sets.map((set) => set.name)))].sort().join(', ')}`);
  if (issues.length > 0) {
    console.error('Review these records before updating the bundled snapshot:');
    console.error(JSON.stringify(issues, null, 2));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message ?? error);
  process.exitCode = 1;
}
