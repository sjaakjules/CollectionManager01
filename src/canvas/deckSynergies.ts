import type { Card, Thresholds } from '@/data/dataModels';

interface Trigger {
  name: string;
  otherCopy?: true;
}

interface SynergyRule {
  id: string;
  label: string;
  matches: (card: Card) => boolean;
  triggers: readonly (string | Trigger)[];
}

export interface DeckSynergy {
  id: string;
  label: string;
  count: number;
  minionCount: number;
  sources: readonly string[];
}

const minion = (card: Card) => card.guardian.type === 'Minion';
const type = (value: string) => (card: Card) => card.guardian.type === value;
const rarity = (value: string) => (card: Card) => card.guardian.rarity === value;
const subtype = (value: string) => (card: Card) => card.subTypes.split(',').some(entry => entry.trim() === value);
const umbrella = (value: string) => (card: Card) => !!card.umbrellas?.includes(value);
const element = (value: keyof Thresholds) => {
  const label = value[0]?.toUpperCase() + value.slice(1);
  return (card: Card) => card.guardian.thresholds[value] > 0 || card.elements.split(',').some(entry => entry.trim() === label);
};
const both = (...tests: readonly ((card: Card) => boolean)[]) => (card: Card) => tests.every(test => test(card));
const oneOf = (...values: string[]) => (card: Card) => values.includes(card.name);
const otherCopy = (name: string): Trigger => ({ name, otherCopy: true });

function manaAtMost(max: number): (card: Card) => boolean {
  return ({ guardian: { cost } }) => cost !== null && cost >= 0 && cost <= max;
}

function powerAtMost(max: number): (card: Card) => boolean {
  return ({ guardian: { attack } }) => attack !== null && attack <= max;
}

// Feed keywords include effects aimed at other cards. Match printed ability
// declarations, plus reviewed cards whose own ability has conditional wording.
const conditionalAbilities: Readonly<Record<string, readonly string[]>> = {
  Airborne: ['Angel Ascendant', 'Monastery Gargoyle', 'Ribble Boggart', 'Tombstone Wardens', 'Zeppelin of Zealots'],
  Burrowing: ['Awakened Mummies', 'Sewer Rats'],
  Charge: ['Avenging Angel', 'Grand Old Boar', 'Nanurluk', 'Rebecks'],
  Ranged: ['Ribble Boggart', 'Spire Lich'],
  Spellcaster: ['One-shot Wizard', 'Spire Lich'],
};

function ability(value: string): (card: Card) => boolean {
  if (value === 'Genesis' || value === 'Deathrite') {
    const abilityLine = new RegExp(`^\\s*(?:Genesis & )?${value}(?: & Deathrite)?\\s*(?:→|->)`, 'imu');
    return card => abilityLine.test(card.guardian.rulesText);
  }
  const qualifiers = value === 'Spellcaster' ? '(?:(?:Air|Earth|Fire|Water|Non-fire|Non-Ordinary)(?: and (?:Air|Earth|Fire|Water))? )?' : '';
  const declaration = new RegExp(`^${qualifiers}${value}(?: \\d+)?$`, 'iu');
  return card => {
    const [firstLine = ''] = card.guardian.rulesText.split(/\r?\n/u, 1);
    return firstLine.split(/[,.;]/u).some(clause => declaration.test(clause.trim())) ||
      !!conditionalAbilities[value]?.includes(card.name);
  };
}

const airborne = ability('Airborne');
const beast = subtype('Beast');
const dragon = subtype('Dragon');
const faerie = subtype('Faerie');
const mortal = subtype('Mortal');
const undead = subtype('Undead');
const spirit = subtype('Spirit');
const evil = umbrella('Evil');
const knights = umbrella('Knight');
const magic = type('Magic');
const artifact = type('Artifact');
const weapon = subtype('Weapon');
const armour = subtype('Armor');
const bear = oneOf('Brown Bears', 'Polar Bears');
const rats = oneOf('Cemetery Rats', 'Granary Rats', 'Plague Rat', 'Sewer Rats');
const courts = oneOf('Court of Equity', 'Mobbed Court', 'Mock Court', 'Overflowing Court');

// Sources are reviewed against the cached catalogue and legible preview rules.
// Each names a beneficial effect or prerequisite for our copies, including effects shared by players.
const spellbookRules: readonly SynergyRule[] = [
  { id: 'airborne', label: 'Airborne', matches: both(minion, airborne), triggers: ['Bottomless Pit', 'Updraft Ridge'] },
  { id: 'angels', label: 'Angels', matches: subtype('Angel'), triggers: ['Apostles of Thamariel', 'The Empyrean'] },
  { id: 'bears', label: 'Bears', matches: bear, triggers: ['Bearserker', 'Nanurluk'] },
  { id: 'beasts', label: 'Beasts', matches: beast,
    triggers: ['Assorted Animals', 'Brocéliande', 'Firebreathing', 'Frost Breath', 'Hollow One', 'Ogre Chef', 'Pond', 'Sir Tom Thumb',
      'Sir Yvain', 'Sylvan Splendor', 'Varmint Warrens', otherCopy('Wolpertinger')] },
  { id: 'beasts-airborne', label: 'Flying Beasts ≤2', matches: both(beast, airborne, manaAtMost(2)), triggers: ['Highland Falconer'] },
  { id: 'burrowing', label: 'Burrowing', matches: both(minion, ability('Burrowing')), triggers: ['Grasping Ground', 'Secret Tunnel'] },
  { id: 'deathrite', label: 'Deathrite', matches: both(minion, ability('Deathrite')), triggers: ['Feign Death', 'Saintweald'] },
  { id: 'demons', label: 'Demons', matches: subtype('Demon'), triggers: ['Demonic Contract', 'Fallen Angel', 'Redmane Hyena'] },
  { id: 'dragons', label: 'Dragons', matches: dragon,
    triggers: ['Cradle of Etherrum', "Dragonlord's Lair", 'Firebreathing', 'Incinerate', 'Shrine of the Dragonlord', otherCopy('Caelestis')] },
  { id: 'earth-minions', label: 'Earth minions', matches: both(minion, element('earth')), triggers: ['Crusade'] },
  { id: 'elite-minions', label: 'Elite minions', matches: both(minion, rarity('Elite')), triggers: ['Major City'] },
  { id: 'evil', label: 'Evil', matches: both(minion, evil),
    triggers: ['Black Mass', 'Den of Evil', 'Desecrate', 'Desecrated Ground', 'Doomsday Cult', 'Eclipse', 'Grigori Rasputin',
      'Hellmouth', otherCopy('Mephistopheles'), 'Profane Revenant', 'Sinister Pond', 'Willing Tribute', 'Witching Hour'] },
  { id: 'exceptional-minions', label: 'Exceptional minions', matches: both(minion, rarity('Exceptional')), triggers: ['Town'] },
  { id: 'exceptional-mortals', label: 'Exceptional Mortals', matches: both(mortal, rarity('Exceptional')), triggers: ['Call to War'] },
  { id: 'faeries', label: 'Faeries', matches: faerie,
    triggers: ['A Midsummer Night\'s Dream', 'Brocéliande', 'Seelie Court', 'Sylvan Splendor',
      otherCopy('The Faerie Queene'), otherCopy('The Wild Hunt')] },
  { id: 'fire-minions', label: 'Fire minions', matches: both(minion, element('fire')), triggers: ['Flamecaller', 'Jihad'] },
  { id: 'genesis', label: 'Genesis', matches: both(minion, ability('Genesis')),
    triggers: ["Captain's Macaw", 'Deathspeaker', 'The Geistwood'] },
  { id: 'giants', label: 'Giants', matches: subtype('Giant'), triggers: ['Blunderbore', 'Rebecks'] },
  { id: 'knights', label: 'Knights', matches: knights, triggers: ['Knighthood', 'Templar', 'The Round Table',
    'Tournament Grounds', 'Vengeful Heir'] },
  { id: 'low-cost-artefacts', label: 'Artefacts ≤1', matches: both(artifact, manaAtMost(1)), triggers: ['Highland Princess'] },
  { id: 'low-power-minions', label: 'Minions ≤2 power', matches: both(minion, powerAtMost(2)), triggers: ['Spore Spouts'] },
  { id: 'monsters', label: 'Monsters', matches: subtype('Monster'), triggers: ['Abyssal Assault', 'Howl from Beyond', 'Monstermorphosis'] },
  { id: 'mortals', label: 'Mortals', matches: mortal,
    triggers: ['Bearserker', 'Burning Hands', otherCopy('Crown Prince'), otherCopy('Dame Britomart'),
      'Hollow One', 'Keening Banshee', otherCopy('King of the Realm'), otherCopy('Mayor of Milborne'),
      'Moon Clan Werewolf', 'Scourge Zombies', 'Sinister Pond', otherCopy('Sir Gareth'), otherCopy('The Lady of the Lake')] },
  { id: 'ordinary-magic', label: 'Ordinary Magic', matches: both(magic, rarity('Ordinary')), triggers: ['Skeleton Mage'] },
  { id: 'ordinary-minions', label: 'Ordinary minions', matches: both(minion, rarity('Ordinary')),
    triggers: ['Cranky Overseer', 'Hamlet', 'Torch and Pitchfork'] },
  { id: 'ordinary-mortals', label: 'Ordinary Mortals', matches: both(mortal, rarity('Ordinary')), triggers: ['Chosen One', 'Knighthood'] },
  { id: 'ordinary-rats', label: 'Ordinary rats', matches: both(rats, rarity('Ordinary')), triggers: ['Rat King'] },
  { id: 'ranged', label: 'Ranged', matches: both(minion, ability('Ranged')), triggers: ['Vantage Hills'] },
  { id: 'royalty', label: 'Royalty', matches: umbrella('Royalty'), triggers: ['Royal Bodyguard'] },
  { id: 'spellcasters', label: 'Spellcasters', matches: both(minion, ability('Spellcaster')),
    triggers: ['Book of the Dead', 'Bound Spirit', 'De Vermis Mysteriis', 'Dream-Quest', 'Occult Ritual',
      'Shackled Demon', otherCopy('Vivien the Enchantress'), 'Witching Hour'] },
  { id: 'spirits', label: 'Spirits', matches: spirit,
    triggers: ['Evil Presence', 'Frost Breath', otherCopy('Ghost Ship'), 'Kiss of Death', otherCopy('The Wild Hunt'), 'Witching Hour'] },
  { id: 'submerge', label: 'Submerge', matches: both(minion, ability('Submerge')), triggers: ['Slimy Mutants', 'Waveshaper'] },
  { id: 'undead', label: 'Undead', matches: undead,
    triggers: ['Arcade of Bones', 'Bone Spear', 'Carrionette', otherCopy('Death Knight'), 'Gravedigger', 'Kiss of Death',
      'Necropotence', 'Necronomiconcert', otherCopy('Returned King')] },
  { id: 'unique-dragons', label: 'Unique Dragons', matches: both(minion, dragon, rarity('Unique')), triggers: ['Dragonlord'] },
  { id: 'unique-minions', label: 'Unique minions', matches: both(minion, rarity('Unique')), triggers: ['Camelot', "King's Council"] },
  { id: 'unique-spells', label: 'Unique spells', matches: rarity('Unique'), triggers: ['Pendragon Legacy'] },
  { id: 'voidwalk', label: 'Voidwalk', matches: both(minion, ability('Voidwalk')),
    triggers: ['Howl from Beyond', 'Stargazer', otherCopy('Ultimate Horror')] },
  { id: 'wards', label: 'Ward', matches: both(minion, ability('Ward')), triggers: ['Divine Lance', 'Faith Incarnate', 'Holy Nova',
    'Revered Revenant', 'Seraphim', 'The Empyrean'] },
  { id: 'waterbound', label: 'Waterbound', matches: both(minion, ability('Waterbound')), triggers: ['Giant Pelican'] },
  { id: 'weapons-armour', label: 'Weapons / Armour', matches: card => weapon(card) || armour(card),
    triggers: ['Dwarven Forge'] },
  { id: 'instruments', label: 'Instruments', matches: subtype('Instruments'), triggers: ['Necronomiconcert'] },
  { id: 'brother-knights', label: 'Brother Knights', matches: oneOf('Brother Knight'), triggers: [otherCopy('Brother Knight')] },
  { id: 'grey-wolves', label: 'Grey Wolves', matches: oneOf('Grey Wolves', 'Moonsong Talagelum'),
    triggers: [otherCopy('Grey Wolves'), otherCopy('Moonsong Talagelum')] },
  { id: 'illusionists', label: 'Adept Illusionists', matches: oneOf('Adept Illusionist'), triggers: [otherCopy('Adept Illusionist')] },
  { id: 'pigs', label: 'Pigs of the Sounder', matches: oneOf('Pigs of the Sounder'), triggers: ['Squeakers'] },
  { id: 'grand-old-boars', label: 'Grand Old Boars', matches: oneOf('Grand Old Boar'), triggers: ['Pigs of the Sounder'] },
  { id: 'squeakers', label: 'Squeakers', matches: oneOf('Squeakers'), triggers: ['Grand Old Boar'] },
  { id: 'relentless-crowds', label: 'Relentless Crowds', matches: oneOf('Relentless Crowd'), triggers: [otherCopy('Relentless Crowd')] },
  { id: 'search-parties', label: 'Search Parties', matches: oneOf('Search Party'), triggers: [otherCopy('Search Party')] },
  { id: 'arthur-guinevere', label: 'Arthur / Guinevere', matches: oneOf('King Arthur', 'Queen Guinevere'), triggers: ['Wedding Hall'] },
];

const atlasRules: readonly SynergyRule[] = [
  { id: 'babel', label: 'Babel', matches: oneOf('The Apex of Babel'), triggers: ['The Base of Babel'] },
  { id: 'courts', label: 'Courts', matches: courts, triggers: [otherCopy('Overflowing Court')] },
  { id: 'deserts', label: 'Deserts', matches: subtype('Desert'), triggers: ['Khamaseen Mummy', 'Shifting Sands'] },
  { id: 'earth-sites', label: 'Earth sites', matches: element('earth'), triggers: ['Avatar of Earth', 'Bone Rabble', 'Geomancer'] },
  { id: 'fire-sites', label: 'Fire sites', matches: element('fire'), triggers: ['Avatar of Fire'] },
  { id: 'air-sites', label: 'Air sites', matches: element('air'), triggers: ['Avatar of Air'] },
  { id: 'leyline-henges', label: 'Leyline Henges', matches: oneOf('Leyline Henge'), triggers: [otherCopy('Leyline Henge')] },
  { id: 'rivers', label: 'Rivers', matches: subtype('River'), triggers: ['Fenvale Muse', 'River Rapids'] },
  { id: 'towers', label: 'Towers', matches: card => /\bTower\b/u.test(card.name), triggers: ['Spire Lich'] },
  { id: 'water-sites', label: 'Water sites', matches: element('water'), triggers: ['King Croc', 'Lugbog Cat', 'Yokai Kappas'] },
];

const synergySourceNames = new Set([...spellbookRules, ...atlasRules].flatMap(rule =>
  rule.triggers.map(trigger => typeof trigger === 'string' ? trigger : trigger.name)));

export function isDeckSynergySource(name: string): boolean {
  return synergySourceNames.has(name);
}

function matchingSynergies(pool: readonly Card[], activeNames: ReadonlyMap<string, number>, rules: readonly SynergyRule[]): DeckSynergy[] {
  return rules.flatMap(rule => {
    const active = rule.triggers.map(trigger => typeof trigger === 'string' ? { name: trigger } : trigger)
      .filter(trigger => activeNames.has(trigger.name));
    if (!active.length) return [];
    const canUseCopy = (card: Card, trigger: Trigger) => !trigger.otherCopy || trigger.name !== card.name ||
      (activeNames.get(card.name) ?? 0) > 1;
    const matches = pool.filter(rule.matches);
    if (!matches.length || matches.length === pool.length) return [];
    const sources = active.filter(trigger => matches.some(card => canUseCopy(card, trigger))).map(trigger => trigger.name);
    if (!sources.length) return [];
    return [{
      id: rule.id,
      label: rule.label,
      count: matches.length,
      minionCount: matches.filter(minion).length,
      sources,
    }];
  });
}

export function getDeckSynergies(spells: readonly Card[], sites: readonly Card[], avatars: readonly Card[]): {
  spellbook: DeckSynergy[];
  atlas: DeckSynergy[];
} {
  const activeNames = new Map<string, number>();
  for (const card of [...spells, ...sites, ...avatars]) {
    activeNames.set(card.name, (activeNames.get(card.name) ?? 0) + 1);
  }
  const spellbook = matchingSynergies(spells, activeNames, spellbookRules);
  const charge = spells.filter(both(minion, ability('Charge')));
  const minions = spells.filter(minion).length;
  if (charge.length && charge.length < minions) {
    spellbook.push({
      id: 'charge',
      label: 'Charge',
      count: charge.length,
      minionCount: charge.length,
      sources: [],
    });
  }
  return {
    spellbook: spellbook.sort((a, b) => a.label.localeCompare(b.label)),
    atlas: matchingSynergies(sites, activeNames, atlasRules).sort((a, b) => a.label.localeCompare(b.label)),
  };
}
