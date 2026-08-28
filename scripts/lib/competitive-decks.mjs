const RESULT_TAG_ORDER = ['winner', 'placed', 'top-cut', 'undefeated', 'record'];

export const COMPETITIVE_PRESETS = {
  'competitive-2026': {
    id: 'competitive-2026',
    season: 2026,
    since: '2026-01-01',
    sort: 'latest',
    format: 'Constructed',
    rebuildLookup: true,
    queries: [
      'Grand Contest',
      'GC',
      'Cornerstone',
      'SCG CON',
      'SCGCon',
      'Gen Con',
      'GenCon',
      'SorceryFest',
      'SorceryCon',
      'SCRCON',
      'Avatar of the Realm',
      'AotR',
      'Sorcerers at the Core',
      'Explorer Series',
      'Unland Cup',
      'Sorcerers Summit',
      'Battle for Midland',
      'Ropecon',
      'Gothcon',
      'Ascanrask',
      'War of the Four Elements',
      'Spielefest',
      'Excalibur Events',
      'Tumatarau',
      'Cold Foil Heroes',
      'Lincon',
      'Tournament of Champions',
      'POG Cornerstore',
      'Sorcery 1K',
      '2026',
      '1st Place',
      'Top 8',
      'Winner',
      'Champion',
      'Undefeated',
      'Tournament',
    ],
  },
};

const STRONG_EVENTS = [
  ['grand-contest', 'Grand Contest', /(?:\bgrand\s*contests?\b|\b20\d{2}grandcontest\b)/gu],
  ['cornerstone', 'Cornerstone', /\bcornerst(?:one|ore)(?:\s+championship)?s?\b/gu],
  ['scg-con', 'SCG CON', /\bscg(?:\s*con|\s+(?:atl|dc|hou|dfw|dal|balt|la|lv))\b/gu],
  ['gen-con', 'Gen Con', /\bgen\s*con(?:\s*\d+)?\b/gu],
  ['sorceryfest', 'SorceryFest', /\bsorcery\s*fest\b/gu],
  ['sorcerycon', 'SorceryCon', /\bsorcery\s*con\b/gu],
  ['scrcon', 'SCRCON', /\bscr\s*con\b/gu],
  ['avatar-of-the-realm', 'Avatar of the Realm', /\b(?:avatar\s+of\s+the\s+realm|aotr)\b/gu],
  ['sorcerers-at-the-core', 'Sorcerers at the Core', /\bsorcerers?\s+at\s+the\s+core\b/gu],
  ['explorer-series', 'Explorer Series', /\bexplorer\s+series\b/gu],
  ['unland-cup', 'Unland Cup', /\bunland\s+cup\b/gu],
  ['sorcerers-summit', 'Sorcerers Summit', /\bsorcerers?\s+summit\b/gu],
  ['battle-for-midland', 'Battle for Midland', /\bbattle\s+for\s+midland\b/gu],
  ['ropecon', 'Ropecon', /\bropecon\b/gu],
  ['gothcon', 'Gothcon', /\bgothcon\b/gu],
  ['ascanrask', 'Ascanrask', /\bascanrask(?:\s+[ivx]+)?\b/gu],
  ['war-of-the-four-elements', 'War of the Four Elements', /\bwar\s+of\s+the\s+four\s+elements\b/gu],
  ['spielefest', 'Spielefest', /\bspielefest\b/gu],
  ['excalibur-events', 'Excalibur Events', /\bexcalibur(?:\s+events?|\s+pittsburgh|\s+pgh)\b/gu],
  ['tumatarau', 'Tumatarau Whakataetae', /\btumatarau\s+whakataetae\b/gu],
  ['contesting-lincon', 'Contesting Lincon', /\bcontesting\s+lincon\b/gu],
  ['covo-del-nerd', 'Covo del Nerd', /\bcovo\s+del\s+nerd\b/gu],
  ['pikazard-dust-challenge', 'Pikazard Dust Challenge', /\bpikazard(?:\s+\d+k)?\s+dust\s+challenge\b/gu],
  ['cold-foil-heroes', 'Cold Foil Heroes', /\b(?:cold\s+foil\s+heroes|cfh)\b/gu],
  ['lincon', 'Lincon', /\blincon\b/gu],
  ['tournament-of-champions', 'Tournament of Champions', /\b(?:tournament\s+of\s+champions|t\.?\s*o\.?\s*c\.?)\b/gu],
  ['poorcery', 'Poorcery', /\bpoorcery\b/gu],
];

const SUPPORTING_EVENTS = [
  ['grand-contest', 'Grand Contest', /\bgc\b/gu],
  ['sorcerers-summit', 'Sorcerers Summit', /\bsummit(?:\s+s\d+)?\b/gu],
  ['boef', 'BoEF', /\bboef\b/gu],
];

const LOCATIONS = [
  ['las-vegas', 'Las Vegas', /\b(?:las\s+vegas|vegas|sin\s+city)\b/gu],
  ['leeuwarden', 'Leeuwarden', /\bleeuwarden\b/gu],
  ['netherlands', 'Netherlands', /\b(?:netherlands|nederland)\b/gu],
  ['melbourne', 'Melbourne', /\bmelbourne\b/gu],
  ['indianapolis', 'Indianapolis', /\bindianapolis\b/gu],
  ['auckland', 'Auckland', /\b(?:auckland|(?:grand\s+contest|gc)\s+akl|akl\s+(?:grand\s+contest|gc))\b/gu],
  ['new-zealand', 'New Zealand', /\b(?:new\s+zealand|aotearoa|nz)\b/gu],
  ['dunedin', 'Dunedin', /\bdunedin\b/gu],
  ['washington-dc', 'Washington, DC', /\b(?:washington(?:,?\s+d\.?c\.?)?|(?:scg\s*con|grand\s+contest)\s+dc)\b/gu],
  ['houston', 'Houston', /\b(?:houston|scg\s*con\s+hou)\b/gu],
  ['dallas', 'Dallas', /\bdallas\b/gu],
  ['baltimore', 'Baltimore', /\bbaltimore\b/gu],
  ['adelaide', 'Adelaide', /\badelaide\b/gu],
  ['los-angeles', 'Los Angeles', /\blos\s+angeles\b/gu],
  ['montreal', 'Montreal', /\b(?:montreal|mtl)\b/gu],
  ['hartford', 'Hartford', /\bhartford\b/gu],
  ['germany', 'Germany', /\b(?:germany|deutschland)\b/gu],
  ['italy', 'Italy', /\b(?:italy|italia)\b/gu],
  ['united-kingdom', 'United Kingdom', /\b(?:united\s+kingdom|uk|brighton)\b/gu],
  ['sydney', 'Sydney', /\bsydney\b/gu],
  ['new-york-city', 'New York City', /\b(?:new\s+york(?:\s+city)?|nyc)\b/gu],
  ['portland', 'Portland', /\bportland\b/gu],
  ['pittsburgh', 'Pittsburgh', /\b(?:pittsburgh|pgh)\b/gu],
  ['louisville', 'Louisville', /\blouisville\b/gu],
  ['london', 'London', /\blondon\b/gu],
  ['merida', 'Merida', /\bmerida\b/gu],
  ['invercargill', 'Invercargill', /\binvercargill\b/gu],
  ['oulu', 'Oulu', /\boulu\b/gu],
  ['aachen', 'Aachen', /\baachen\b/gu],
  ['tokyo', 'Tokyo', /\btokyo\b/gu],
  ['columbus', 'Columbus', /\bcolumbus\b/gu],
  ['hot-springs', 'Hot Springs', /\bhot\s+springs\b/gu],
  ['hendersonville', 'Hendersonville', /\bhendersonville\b/gu],
];

function sortUnique(values, compare = (left, right) => left.localeCompare(right)) {
  return [...new Set(values)].sort(compare);
}

function uniqueInOrder(values, key = (value) => value) {
  const seen = new Set();
  return values.filter((value) => {
    const valueKey = key(value);
    if (seen.has(valueKey)) return false;
    seen.add(valueKey);
    return true;
  });
}

export function normalizeSearchQueries(queries) {
  const seen = new Set();
  const normalized = [];

  for (const value of queries ?? []) {
    const query = String(value ?? '').replace(/\s+/gu, ' ').trim();
    const key = query.toLocaleLowerCase('en');
    if (!query || seen.has(key)) continue;
    seen.add(key);
    normalized.push(query);
  }

  return normalized;
}

export function stripPrimerHtml(value) {
  return String(value ?? '')
    .replace(/<\s*br\s*\/?\s*>/giu, ' ')
    .replace(/<\/\s*(?:p|div|li|h[1-6])\s*>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;|&#160;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;|&#34;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeMatchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[’`]/gu, "'")
    .replace(/_+/gu, ' ')
    .toLocaleLowerCase('en')
    .replace(/\s+/gu, ' ')
    .trim();
}

function matchesForDefinitions(text, definitions) {
  const matches = [];
  for (const [id, label, pattern] of definitions) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) matches.push({ id, label });
  }
  return matches;
}

function readYears(text) {
  const years = [];
  for (const match of text.matchAll(/\b(20\d{2})\b/gu)) {
    years.push(Number(match[1]));
  }
  return sortUnique(years, (left, right) => left - right);
}

function inferredYear(deck) {
  for (const value of [deck.updatedAt, deck.createdAt]) {
    const timestamp = Date.parse(value ?? '');
    if (Number.isFinite(timestamp)) return new Date(timestamp).getUTCFullYear();
  }
  return null;
}

function readPlacements(text) {
  const placements = [];
  for (const match of text.matchAll(/\b(\d{1,2})\s*:?(?:st|nd|rd|th)(?:\s+place)?\b/gu)) {
    const placement = Number(match[1]);
    if (placement >= 1 && placement <= 64) placements.push(placement);
  }
  if (/\bfirst\s+place\b/gu.test(text)) placements.push(1);
  return sortUnique(placements, (left, right) => left - right);
}

function readTopCuts(text) {
  const topCuts = [];
  for (const match of text.matchAll(/\btop\s*(4|8|16|32|64)\b/gu)) {
    topCuts.push(Number(match[1]));
  }
  return sortUnique(topCuts, (left, right) => left - right);
}

function readRecords(text) {
  const records = [];
  for (const match of text.matchAll(/\b(\d{1,2})\s*[-–—]\s*(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?\b/gu)) {
    const wins = Number(match[1]);
    const losses = Number(match[2]);
    const draws = match[3] === undefined ? null : Number(match[3]);
    if (wins + losses > 20 || (draws !== null && draws > 5)) continue;
    records.push(draws === null ? `${wins}-${losses}` : `${wins}-${losses}-${draws}`);
  }
  return sortUnique(records);
}

function hasWinnerSignal(nameText, primerText) {
  const titleWinner = /\b(?:winner|winning|won(?!'t)|champion)\b/u.test(nameText);
  const primerWinnerWord = /\b(?:winner|champion)\b/u.test(primerText);
  const primerEventWin = /\bwon(?!'t)\s+(?:the\s+)?(?:event|tournament|contest|championship|finals?|grand\s+contest|cornerstone)\b/u.test(primerText);
  return titleWinner || primerWinnerWord || primerEventWin;
}

export function classifyCompetitiveDeck(deck, options = {}) {
  const primer = stripPrimerHtml(deck?.primer);
  const nameText = normalizeMatchText(deck?.name);
  const primerText = normalizeMatchText(primer);
  const text = `${nameText} ${primerText}`.trim();
  const nameStrongEventMatches = matchesForDefinitions(nameText, STRONG_EVENTS);
  const primerStrongEventMatches = matchesForDefinitions(primerText, STRONG_EVENTS);
  const strongEventMatches = uniqueInOrder(
    [...nameStrongEventMatches, ...primerStrongEventMatches],
    (entry) => entry.id,
  );
  const nameSupportingEventMatches = matchesForDefinitions(nameText, SUPPORTING_EVENTS);
  const primerSupportingEventMatches = matchesForDefinitions(primerText, SUPPORTING_EVENTS);
  const supportingEventMatches = uniqueInOrder(
    [...nameSupportingEventMatches, ...primerSupportingEventMatches],
    (entry) => entry.id,
  )
    .filter((entry) => !strongEventMatches.some((strong) => strong.id === entry.id));
  const eventMatches = uniqueInOrder([
    ...nameStrongEventMatches,
    ...nameSupportingEventMatches,
    ...primerStrongEventMatches,
    ...primerSupportingEventMatches,
  ], (entry) => entry.id);
  const locationMatches = uniqueInOrder([
    ...matchesForDefinitions(nameText, LOCATIONS),
    ...matchesForDefinitions(primerText, LOCATIONS),
  ], (entry) => entry.id);
  const competitionNoun = /\b(?:tourn(?:a|e)ment|tourney|championship|contest|qualifier|league|cup|open|finals?|top\s+cut|whakataetae|\d+\s*k)\b/gu.test(text);
  const placements = uniqueInOrder([
    ...readPlacements(nameText),
    ...readPlacements(primerText),
  ]);
  const topCuts = uniqueInOrder([
    ...readTopCuts(nameText),
    ...readTopCuts(primerText),
  ]);
  const records = uniqueInOrder([
    ...readRecords(nameText),
    ...readRecords(primerText),
  ]);
  const undefeated = /\bundefeated\b/gu.test(text);
  const winnerWord = hasWinnerSignal(nameText, primerText);
  const winner = winnerWord || placements.includes(1);
  const hasResult = winner || placements.length > 0 || topCuts.length > 0 || undefeated || records.length > 0;
  const hasLocation = locationMatches.length > 0;
  const hasStrongEvent = strongEventMatches.length > 0;
  const hasGcAlias = supportingEventMatches.some((entry) => entry.id === 'grand-contest');
  const hasNamedSupportingEvent = supportingEventMatches.some((entry) => entry.id !== 'grand-contest');
  const explicitYears = readYears(text);
  const inferred = inferredYear(deck ?? {});
  const seasons = explicitYears.length > 0
    ? explicitYears
    : inferred === null
      ? []
      : [inferred];

  let confidence = 'low';
  let isCompetitive = false;
  if (hasStrongEvent) {
    confidence = 'high';
    isCompetitive = true;
  } else if ((competitionNoun && (hasResult || hasLocation)) || (hasResult && hasLocation)) {
    confidence = 'medium';
    isCompetitive = true;
  } else if (
    (hasNamedSupportingEvent && hasResult) ||
    (hasGcAlias && (hasResult || hasLocation))
  ) {
    confidence = 'medium';
    isCompetitive = true;
  }

  const resultTags = [];
  if (winner) resultTags.push('winner');
  if (placements.length > 0) resultTags.push('placed');
  if (topCuts.length > 0) resultTags.push('top-cut');
  if (undefeated) resultTags.push('undefeated');
  if (records.length > 0) resultTags.push('record');

  const signals = [
    ...eventMatches.map((entry) => `event:${entry.id}`),
    ...locationMatches.map((entry) => `location:${entry.id}`),
    ...resultTags.map((entry) => `result:${entry}`),
  ];
  signals.push(...supportingEventMatches.map((entry) => `event-alias:${entry.id}`));
  if (competitionNoun) signals.push('competition:noun');
  if (explicitYears.length > 0) signals.push(...explicitYears.map((year) => `season:${year}`));

  const season = Number.isInteger(options.season) ? options.season : null;
  const explicitSeasonMismatch = season !== null
    && explicitYears.length > 0
    && !explicitYears.includes(season)
    && explicitYears.every((year) => year < season);

  return {
    isCompetitive,
    confidence,
    seasons,
    events: eventMatches.map((entry) => entry.label),
    locations: locationMatches.map((entry) => entry.label),
    resultTags: RESULT_TAG_ORDER.filter((tag) => resultTags.includes(tag)),
    placements,
    topCuts,
    records,
    matchedQueries: normalizeSearchQueries(deck?.matchedQueries),
    matchedSignals: sortUnique(signals),
    likes: Number.isFinite(deck?.likes) ? Math.max(0, Math.floor(deck.likes)) : 0,
    views: Number.isFinite(deck?.views) ? Math.max(0, Math.floor(deck.views)) : 0,
    explicitSeasonMismatch,
  };
}

export function classifyAndFilterCompetitiveDeck(deck, options = {}) {
  const competitive = classifyCompetitiveDeck(deck, options);
  const exclusionReasons = [];
  const minViews = Number.isFinite(options.minViews) ? options.minViews : 0;
  const minLikes = Number.isFinite(options.minLikes) ? options.minLikes : 0;
  const requiredFormat = String(options.format ?? 'all').trim().toLocaleLowerCase('en');

  if ((deck?.views ?? 0) < minViews) exclusionReasons.push(`minimum-views:${minViews}`);
  if ((deck?.likes ?? 0) < minLikes) exclusionReasons.push(`minimum-likes:${minLikes}`);
  if (
    requiredFormat &&
    requiredFormat !== 'all' &&
    String(deck?.format ?? '').trim().toLocaleLowerCase('en') !== requiredFormat
  ) {
    exclusionReasons.push(`format:${deck?.format ?? 'unknown'}`);
  }

  if (options.since) {
    const sinceMs = Date.parse(options.since);
    const deckMs = Date.parse(deck?.updatedAt ?? deck?.createdAt ?? '');
    const hasRequestedSeason = Number.isInteger(options.season)
      && competitive.seasons.includes(options.season);
    if (!Number.isFinite(deckMs) && !hasRequestedSeason) {
      exclusionReasons.push('missing-date');
    } else if (Number.isFinite(deckMs) && deckMs < sinceMs && !hasRequestedSeason) {
      exclusionReasons.push(`before:${options.since}`);
    }
  }

  if (competitive.explicitSeasonMismatch) {
    exclusionReasons.push(`season-before:${options.season}`);
  }
  if (options.competitiveOnly && !competitive.isCompetitive) {
    exclusionReasons.push('unclassified');
  }

  const { explicitSeasonMismatch: _explicitSeasonMismatch, ...archiveCompetitive } = competitive;
  return {
    competitive: archiveCompetitive,
    exclusionReasons,
    included: exclusionReasons.length === 0,
  };
}
