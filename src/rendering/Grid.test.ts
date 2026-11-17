import { describe, expect, it } from "vitest";
import type { CardType, ThresholdGroup } from "@/data/dataModels";
import type { CatalogueLayoutConfig } from '@/data/catalogueLayout';
import { required } from '@/utils/required';
import {
  calculateCardLayout,
  calculateDeckLayout,
  CARD_CELL_SPACING,
  DECK_AVATAR_SIZE,
  DRAWN_GRID,
  getCardCenterPosition,
  getCardPixelSize,
  getStackFan,
  GROUP_GAP_UNITS,
  pixelsToSnapGrid,
  SNAP_GRID,
  snapCardCenter,
  snapToDrawnGrid,
  type GroupHeader,
  type LayoutCardInput,
  type LayoutResult,
} from "./Grid";

function card(
  name: string,
  type: CardType,
  thresholdGroup: ThresholdGroup,
  cost: number | null = 1,
): LayoutCardInput {
  return {
    name,
    type,
    thresholdGroup,
    cost,
    isLandscape: type === "Site",
    rarity: "Ordinary",
    primarySet: "Alpha",
  };
}

function cardByName(result: LayoutResult, name: string) {
  const layout = result.cards.find((entry) => entry.name === name);
  if (!layout) {
    throw new Error(`Expected ${name} to be laid out`);
  }
  return layout;
}

function collectionHeader(
  result: LayoutResult,
  label: string,
): GroupHeader | undefined {
  return result.headers.find(
    (header) => header.kind === "collection" && header.label === label,
  );
}

describe('stack fans', () => {
  it.each([false, true])('fit inside their grid slot regardless of stack size (landscape=%s)', landscape => {
    const spacing = landscape ? CARD_CELL_SPACING.LANDSCAPE : CARD_CELL_SPACING.PORTRAIT;
    const first = getCardCenterPosition(0, 0, landscape);
    const next = getCardCenterPosition(0, 1, landscape);
    const rowTop = first.y - spacing.y * DRAWN_GRID.height / 2;
    expect(DRAWN_GRID).toEqual({ width: 60, height: 60 });
    expect(spacing).toEqual(landscape ? { x: 3, y: 2 } : { x: 2, y: 3 });
    expect(snapToDrawnGrid(0, rowTop).y).toBe(rowTop);
    for (const count of [0, 1, 2, 3, 4, 5, 6, 20, 100]) {
      const fan = getStackFan(count, landscape);
      const fannedHeight = getCardPixelSize(landscape).height + 2 * fan.overhang;
      expect(fannedHeight).toBeLessThanOrEqual(next.y - first.y);
      expect(fan.spacing * Math.max(0, count - 1)).toBeCloseTo(2 * fan.overhang);
    }
    expect(snapCardCenter(next.x, next.y, landscape)).toEqual(next);
    expect(DECK_AVATAR_SIZE).toEqual({ width: 157, height: 220 });
  });

  it('fits four spells at their nameplate spacing and limits wider site fans', () => {
    const counts = [1, 2, 3, 4, 5];
    expect(counts.map(count => getStackFan(count, false).spacing)).toEqual([0, 40 / 3, 40 / 3, 40 / 3, 10]);
    expect(counts.map(count => getStackFan(count, true).spacing)).toEqual([0, 18, 10, 20 / 3, 5]);
    expect(getCardPixelSize(false).height + getStackFan(4, false).overhang * 2).toBe(DRAWN_GRID.height * 3);
  });
});

describe("calculateCardLayout", () => {
  it.each([
    { mode: "grouped", layoutVariant: "wide" },
    { mode: "grouped", layoutVariant: "portrait" },
    { mode: "filteredFlat", layoutVariant: "wide" },
    { mode: "preserveFlat", layoutVariant: "wide" },
    { mode: "typeRows", layoutVariant: "wide" },
  ] as const)("keeps unfamiliar types visible in $mode / $layoutVariant", (config) => {
    const inputs = (["air", "earth", "fire", "water", "multiple", "none"] as const)
      .flatMap((threshold) => [
        card(`${threshold} trap`, "Trap", threshold, null),
        card(`${threshold} future`, "Unannounced Form", threshold),
        card(`${threshold} artifact`, "Artifact", threshold),
        card(`${threshold} magic`, "Magic", threshold),
      ]);
    const result = calculateCardLayout({ cards: inputs, ...config });
    expect(result.cards.map((entry) => entry.name).sort()).toEqual(inputs.map((entry) => entry.name).sort());
    expect(result.cards.every((entry) => Number.isFinite(entry.position.x) && Number.isFinite(entry.position.y))).toBe(true);
    expect(new Set(result.cards.map((entry) => `${entry.position.x},${entry.position.y}`)).size).toBe(inputs.length);
    if (config.mode === 'grouped') expect(result.headers.some((header) => header.label.includes('Trap'))).toBe(true);
  });

  it('lays out unfamiliar types on every deck board', () => {
    const names = ['Main Trap', 'Side Trap', 'Maybe Trap'];
    const cardLookup = new Map(names.map((name) => [name, {
      type: 'Trap', cost: 2, isLandscape: false, thresholdGroup: 'none' as const,
    }]));
    const result = calculateDeckLayout({
      deck: { name: 'Future deck', boards: {
        avatar: [], mainboard: [{ name: names[0] ?? '', quantity: 2 }],
        collection: [{ name: names[1] ?? '', quantity: 1 }],
        maybeboard: [{ name: names[2] ?? '', quantity: 1 }],
      } }, cardLookup, collectionBottom: 0,
    });
    expect(result.cards.map((entry) => entry.name).sort()).toEqual([...names].sort());
    expect(result.headers.some((header) => header.label === 'Trap')).toBe(true);
  });
  it("keeps shifted cards centered on their snap cells when layout offsets are grid-snapped", () => {
    const result = calculateCardLayout({
      cards: [
        card("Portrait", "Minion", "fire", 1),
        card("Landscape", "Site", "fire", 1),
      ],
      mode: "typeRows",
    });
    const offset = snapToDrawnGrid(123, 147);

    for (const entry of result.cards) {
      const shifted = {
        x: entry.position.x + offset.x,
        y: entry.position.y + offset.y,
      };

      expect(snapCardCenter(shifted.x, shifted.y, entry.isLandscape)).toEqual(
        shifted,
      );
    }
  });

  it("keeps wide grouped threshold groups horizontal", () => {
    const result = calculateCardLayout({
      cards: [
        card("Air Adept", "Minion", "air"),
        card("Earth Adept", "Minion", "earth"),
      ],
    });

    const air = cardByName(result, "Air Adept");
    const earth = cardByName(result, "Earth Adept");

    expect(air.position.x).toBeLessThan(earth.position.x);
    expect(air.position.y).toBe(earth.position.y);
  });

  it("stacks portrait element sections with minions left and other types right", () => {
    const result = calculateCardLayout({
      cards: [
        card("Avatar A", "Avatar", "air"),
        card("Avatar B", "Avatar", "earth"),
        card("Air Minion", "Minion", "air"),
        card("Air Magic", "Magic", "air"),
        card("Air Aura", "Aura", "air"),
        card("Air Site", "Site", "air"),
        card("Earth Minion", "Minion", "earth"),
      ],
      layoutVariant: "portrait",
    });

    const airMinion = cardByName(result, "Air Minion");
    const airMagic = cardByName(result, "Air Magic");
    const earthMinion = cardByName(result, "Earth Minion");
    const airHeader = collectionHeader(result, "Air");
    const earthHeader = collectionHeader(result, "Earth");

    expect(airMinion.position.x).toBeLessThan(airMagic.position.x);
    expect(earthMinion.position.y).toBeGreaterThan(airMinion.position.y);
    expect(airHeader).toBeDefined();
    expect(earthHeader?.position.y).toBeGreaterThan(airHeader?.position.y ?? 0);
  });

  it("moves the four named provider-family cards to their explicit elements", () => {
    const result = calculateCardLayout({
      cards: [
        card("Castle Servants", "Minion", "none", 2),
        card("Common Cottagers", "Minion", "none", 2),
        card("Blacksmith Family", "Minion", "none", 2),
        card("Fisherman's Family", "Minion", "none", 2),
      ],
    });

    expect(cardByName(result, "Castle Servants").thresholdGroup).toBe("air");
    expect(cardByName(result, "Common Cottagers").thresholdGroup).toBe(
      "earth",
    );
    expect(cardByName(result, "Blacksmith Family").thresholdGroup).toBe(
      "fire",
    );
    expect(cardByName(result, "Fisherman's Family").thresholdGroup).toBe(
      "water",
    );
  });

  it("hides null-cost None minion tokens only in grouped layouts", () => {
    const token = card("Frog", "Minion", "none", null);

    const grouped = calculateCardLayout({ cards: [token] });
    const filteredFlat = calculateCardLayout({
      cards: [token],
      mode: "filteredFlat",
    });

    expect(grouped.cards.map((entry) => entry.name)).not.toContain("Frog");
    expect(filteredFlat.cards.map((entry) => entry.name)).toContain("Frog");
  });

  it("preserves supplied score order in flat shelf layouts", () => {
    const result = calculateCardLayout({
      cards: [
        card("High Value", "Magic", "fire", 9),
        card("Medium Value", "Magic", "fire", 1),
        card("Low Value", "Magic", "fire", 0),
      ],
      mode: "preserveFlat",
    });

    expect(result.cards.map((entry) => entry.name)).toEqual([
      "High Value",
      "Medium Value",
      "Low Value",
    ]);
  });

  it("groups shelf cards into tight type rows while preserving score order within each type", () => {
    const result = calculateCardLayout({
      cards: [
        card("Aura High", "Aura", "fire", 1),
        card("Avatar High", "Avatar", "fire", 1),
        card("Minion High", "Minion", "fire", 1),
        card("Magic High", "Magic", "fire", 1),
        card("Artifact High", "Artifact", "fire", 1),
        card("Minion Low", "Minion", "fire", 1),
        card("Site High", "Site", "fire", 1),
      ],
      mode: "typeRows",
    });

    expect(result.headers).toEqual([]);
    expect(result.cards.map((entry) => entry.name)).toEqual([
      "Avatar High",
      "Minion High",
      "Minion Low",
      "Magic High",
      "Artifact High",
      "Aura High",
      "Site High",
    ]);

    const avatar = cardByName(result, "Avatar High");
    const minionHigh = cardByName(result, "Minion High");
    const minionLow = cardByName(result, "Minion Low");
    const magic = cardByName(result, "Magic High");
    const artifact = cardByName(result, "Artifact High");
    const aura = cardByName(result, "Aura High");

    expect(minionHigh.position.y).toBe(minionLow.position.y);
    expect(minionHigh.position.x).toBeLessThan(minionLow.position.x);

    const avatarGrid = pixelsToSnapGrid(
      avatar.position.x,
      avatar.position.y,
      avatar.isLandscape,
    );
    const minionGrid = pixelsToSnapGrid(
      minionHigh.position.x,
      minionHigh.position.y,
      minionHigh.isLandscape,
    );
    const magicGrid = pixelsToSnapGrid(
      magic.position.x,
      magic.position.y,
      magic.isLandscape,
    );
    const artifactGrid = pixelsToSnapGrid(
      artifact.position.x,
      artifact.position.y,
      artifact.isLandscape,
    );
    const auraGrid = pixelsToSnapGrid(
      aura.position.x,
      aura.position.y,
      aura.isLandscape,
    );

    expect(minionGrid.y - avatarGrid.y).toBe(3);
    expect(magicGrid.y - minionGrid.y).toBe(3);
    expect(artifactGrid.y - magicGrid.y).toBe(3);
    expect(auraGrid.y - artifactGrid.y).toBe(3);
    expect(minionGrid.x).toBe(avatarGrid.x);
    expect(magicGrid.x).toBe(avatarGrid.x);
    expect(artifactGrid.x).toBe(avatarGrid.x);
    expect(auraGrid.x).toBe(avatarGrid.x);
  });

  it("adds a portrait Artifacts and Multi / None section with None sites", () => {
    const result = calculateCardLayout({
      cards: [
        card("Clockwork", "Artifact", "none", 1),
        card("Triune Minion", "Minion", "multiple", 2),
        card("Triune Magic", "Magic", "multiple", 2),
        card("Triune Site", "Site", "multiple", 2),
        card("Desert", "Site", "none", 0),
      ],
      layoutVariant: "portrait",
    });

    const artifact = cardByName(result, "Clockwork");
    const multiMinion = cardByName(result, "Triune Minion");
    const noneSite = cardByName(result, "Desert");

    expect(collectionHeader(result, "Artifacts")).toBeDefined();
    expect(collectionHeader(result, "Multi / None")).toBeDefined();
    expect(artifact.position.x).toBeLessThan(multiMinion.position.x);
    expect(noneSite.thresholdGroup).toBe("none");
  });
});

describe('catalogue hierarchy geometry', () => {
  it('keeps the full configured column allowance for a site-only filter', () => {
    const result = calculateCardLayout({
      cards: Array.from({ length: 8 }, (_, index) => card(`Site ${index}`, 'Site', 'water', null)),
      viewportAspect: 4,
      catalogueLayout: { columns: 4, columnMode: 'limit', steps: [
        { field: 'name', mode: 'sort', direction: 'asc', axis: 'horizontal' },
      ] },
    });
    expect(new Set(result.cards.map(card => card.position.x)).size).toBe(4);
    expect(new Set(result.cards.map(card => card.position.y)).size).toBe(2);
    expect(result.cards.every(card => card.isLandscape)).toBe(true);
  });

  it.each([
    { limit: 2, spellColumns: 2, siteColumns: 1 },
    { limit: 5, spellColumns: 3, siteColumns: 2 },
    { limit: 6, spellColumns: 6, siteColumns: 4 },
  ])('packs adjacent element groups within a $limit-column ceiling', ({ limit, spellColumns, siteColumns }) => {
    const cards = (['air', 'earth'] as const).flatMap(element => [
      ...Array.from({ length: 12 }, (_, index) => card(`${element} Spell ${index}`, 'Minion', element)),
      ...Array.from({ length: 12 }, (_, index) => card(`${element} Site ${index}`, 'Site', element, null)),
    ]);
    const result = calculateCardLayout({ cards, viewportAspect: 4, catalogueLayout: { columns: limit, columnMode: 'limit', steps: [
      { field: 'element', mode: 'group', direction: 'asc', axis: 'horizontal' },
      { field: 'family', mode: 'group', direction: 'asc', axis: 'vertical' },
    ] } });
    const columns = (isLandscape: boolean) => new Set(result.cards.filter(card =>
      card.thresholdGroup === 'air' && card.isLandscape === isLandscape).map(card => card.position.x)).size;
    expect(columns(false)).toBe(spellColumns);
    expect(columns(true)).toBe(siteColumns);
    const air = required(collectionHeader(result, 'Air'));
    const earth = required(collectionHeader(result, 'Earth'));
    expect(earth.position.y).toBe(air.position.y);
    expect(earth.position.x - air.position.x).toBe((spellColumns * CARD_CELL_SPACING.PORTRAIT.x + GROUP_GAP_UNITS) * SNAP_GRID.width);
  });

  it.each([{ layoutVariant: 'wide', viewportAspect: 2 }, { layoutVariant: 'portrait', viewportAspect: 0.5 }] as const)(
    'fits mixed catalogue groups to a $layoutVariant viewport while aligning their widths', ({ layoutVariant, viewportAspect }) => {
      const cards = (['air', 'earth', 'fire', 'water'] as const).flatMap(element => [
        ...Array.from({ length: 48 }, (_, index) => card(`${element} Spell ${index}`, 'Minion', element)),
        ...Array.from({ length: 32 }, (_, index) => card(`${element} Site ${index}`, 'Site', element, null)),
      ]);
      const result = calculateCardLayout({ cards, layoutVariant, viewportAspect, catalogueLayout: {
        columns: 16, columnMode: 'auto', steps: [
          { field: 'element', mode: 'group', direction: 'asc', axis: 'horizontal' },
          { field: 'family', mode: 'group', direction: 'asc', axis: 'vertical' },
          { field: 'name', mode: 'sort', direction: 'asc', axis: 'horizontal' },
        ],
      } });
      const columns = (isLandscape: boolean) => new Set(result.cards.filter(card =>
        card.thresholdGroup === 'air' && card.isLandscape === isLandscape).map(card => card.position.x)).size;
      expect(columns(false) * CARD_CELL_SPACING.PORTRAIT.x).toBe(columns(true) * CARD_CELL_SPACING.LANDSCAPE.x);
      const ratio = (result.bounds.right - result.bounds.left) / (result.bounds.bottom - result.bounds.top);
      expect(Math.abs(Math.log(ratio / viewportAspect))).toBeLessThan(0.25);
      expect(result.cards).toHaveLength(cards.length);
    },
  );

  it('chooses catalogue dimensions for the window and respects a per-group column cap', () => {
    const inputs = Array.from({ length: 48 }, (_, i) => card(`Spell ${i}`, 'Magic', 'air', i % 3));
    const preference: CatalogueLayoutConfig = { columns: 16, columnMode: 'auto', steps: [
      { field: 'cost', mode: 'sort', direction: 'asc', axis: 'vertical' },
    ] };
    const wide = calculateCardLayout({ cards: inputs, catalogueLayout: preference, viewportAspect: 2 });
    const tall = calculateCardLayout({ cards: inputs, catalogueLayout: preference, viewportAspect: 0.5 });
    const aspect = (result: LayoutResult) => (result.bounds.right - result.bounds.left) / (result.bounds.bottom - result.bounds.top);
    expect(Math.abs(Math.log(aspect(wide) / 2))).toBeLessThan(0.25);
    expect(Math.abs(Math.log(aspect(tall) / 0.5))).toBeLessThan(0.25);
    expect(new Set(wide.cards.map(card => card.position.x)).size).toBeGreaterThan(new Set(tall.cards.map(card => card.position.x)).size);
    const capped = calculateCardLayout({ cards: inputs, viewportAspect: 2, catalogueLayout: {
      columns: 2, columnMode: 'limit', steps: [
        { field: 'cost', mode: 'group', direction: 'asc', axis: 'horizontal' },
        { field: 'name', mode: 'sort', direction: 'asc', axis: 'vertical' },
      ],
    } });
    for (const cost of [0, 1, 2]) {
      expect(new Set(capped.cards.filter(card => card.cost === cost).map(card => card.position.x)).size).toBeLessThanOrEqual(2);
    }
    expect(capped.cards).toHaveLength(inputs.length);
  });

  const catalogueLayout = { columns: 6, steps: [
    { field: 'element', mode: 'group', direction: 'asc' },
    { field: 'family', mode: 'group', direction: 'asc' },
    { field: 'cost', mode: 'sort', direction: 'asc' },
  ] } as const;
  it.each([false, true])('always leads with the earliest avatar sets (configured=%s)', configured => {
    const inputs = [
      { ...card('Z gothic', 'Avatar', 'none'), primarySet: 'Gothic' },
      { ...card('B newer set', 'Avatar', 'none'), primarySet: 'Future B', earliestSetReleasedAt: '2032-01-01' },
      { ...card('Z newer set', 'Avatar', 'none'), primarySet: 'Future A', earliestSetReleasedAt: '2031-01-01' },
      { ...card('A alpha', 'Avatar', 'none'), primarySet: 'Alpha' },
      { ...card('Z promo', 'Avatar', 'none'), primarySet: 'Promotional' },
      { ...card('B beta', 'Avatar', 'none'), primarySet: 'Beta' },
    ];
    const result = calculateCardLayout({ cards: inputs,
      catalogueLayout: configured ? { columns: 4, steps: [{ field: 'name', mode: 'sort', direction: 'desc' }] } : undefined,
    });
    expect(result.cards.map(card => card.name)).toEqual(['A alpha', 'B beta', 'Z gothic', 'Z newer set', 'B newer set', 'Z promo']);
    expect(result.cards.map(card => card.position.x)).toEqual([...result.cards.map(card => card.position.x)].sort((a, b) => a - b));
  });
  it.each(['wide', 'portrait'] as const)('puts all avatars in a visible leading section in %s layout', layoutVariant => {
    const avatars = [
      card('Frost Mage', 'Avatar', 'none', null),
      card('Lavamancer', 'Avatar', 'none', null),
      ...Array.from({ length: 13 }, (_, index) => card(`Avatar ${index}`, 'Avatar', 'air', null)),
    ];
    const inputs = [...avatars, card('Spell', 'Magic', 'air'), card('Site', 'Site', 'fire', null)];
    const result = calculateCardLayout({ cards: inputs, layoutVariant, catalogueLayout: { ...catalogueLayout, steps: [...catalogueLayout.steps] } });
    expect(result.headers[0]?.label).toBe('Avatars');
    expect(result.cards.map(entry => entry.name).sort()).toEqual(inputs.map(entry => entry.name).sort());
    const avatarPositions = result.cards.filter(entry => entry.type === 'Avatar').map(entry => entry.position);
    expect(new Set(avatarPositions.map(position => position.y)).size).toBe(layoutVariant === 'portrait' ? 2 : 1);
    const lastAvatarEdge = Math.max(...avatarPositions.map(position => position.y + 70));
    expect(result.cards.filter(entry => entry.type !== 'Avatar').every(entry => entry.position.y - 70 > lastAvatarEdge)).toBe(true);
    for (const entry of result.cards) expect(snapCardCenter(entry.position.x, entry.position.y, entry.isLandscape)).toEqual(entry.position);
    const onlyAvatars = calculateCardLayout({ cards: avatars, layoutVariant, catalogueLayout: { columns: 6, steps: [] } });
    expect(onlyAvatars.cards).toHaveLength(avatars.length);
    expect(onlyAvatars.bounds.bottom).toBe(lastAvatarEdge);
    const onlySpells = calculateCardLayout({ cards: inputs.filter(entry => entry.type !== 'Avatar'), catalogueLayout: { columns: 6, steps: [] } });
    expect(onlySpells.headers.some(header => header.label === 'Avatars')).toBe(false);
    const singleAvatar = calculateCardLayout({ cards: [card('Frost Mage', 'Avatar', 'none', null)], layoutVariant, catalogueLayout: { columns: 1, steps: [] } });
    const title = singleAvatar.headers[0];
    expect(title).toBeDefined();
    expect((title?.fontSize ?? 0) * ('Avatars'.length * 0.7)).toBeLessThanOrEqual(singleAvatar.bounds.right);
  });
  it('uses each grouping and sort axis to place its siblings and cards', () => {
    const inputs = [
      card('First air spell', 'Magic', 'air', 1),
      card('Second air spell', 'Magic', 'air', 2),
      card('Air site', 'Site', 'air', null),
      card('Earth spell', 'Magic', 'earth', 1),
    ];
    const result = calculateCardLayout({
      cards: inputs,
      layoutVariant: 'portrait',
      catalogueLayout: { columns: 1, steps: [
        {field: 'element', mode: 'group', direction: 'asc', axis: 'vertical'},
        {field: 'family', mode: 'group', direction: 'asc', axis: 'horizontal'},
        {field: 'cost', mode: 'sort', direction: 'desc', axis: 'vertical'},
      ] },
    });
    const air = collectionHeader(result, 'Air');
    const earth = collectionHeader(result, 'Earth');
    expect(air?.position.x).toBe(earth?.position.x);
    expect(earth?.position.y).toBeGreaterThan(air?.position.y ?? Infinity);
    const spellbook = result.headers.find(header => header.label === 'Spellbook');
    const atlas = result.headers.find(header => header.label === 'Atlas');
    expect(spellbook?.position.y).toBe(atlas?.position.y);
    expect(atlas?.position.x).toBeGreaterThan(spellbook?.position.x ?? Infinity);
    const first = cardByName(result, 'First air spell');
    const second = cardByName(result, 'Second air spell');
    expect(first.position.x).toBe(second.position.x);
    expect(first.position.y).toBeGreaterThan(second.position.y);
  });
  it.each(['wide', 'portrait'] as const)('keeps every card in non-overlapping snapped cells in %s layout', (layoutVariant) => {
    const inputs = (['air', 'earth', 'fire', 'water', 'multiple', 'none'] as const).flatMap((element) =>
      Array.from({ length: 25 }, (_, i) => card(`${element}-${i}`, i % 3 === 0 ? 'Site' : 'Magic', element, i % 6)));
    const result = calculateCardLayout({ cards: inputs, layoutVariant, catalogueLayout: { ...catalogueLayout, steps: [...catalogueLayout.steps] } });
    expect(result.cards).toHaveLength(inputs.length);
    for (const item of result.cards) {
      expect(snapCardCenter(item.position.x, item.position.y, item.isLandscape)).toEqual(item.position);
      expect(item.isLandscape).toBe(item.type === 'Site');
      const width = item.isLandscape ? 140 : 100;
      const height = item.isLandscape ? 100 : 140;
      for (const other of result.cards) {
        if (item === other) continue;
        const otherWidth = other.isLandscape ? 140 : 100;
        const otherHeight = other.isLandscape ? 100 : 140;
        expect(Math.abs(item.position.x - other.position.x) >= (width + otherWidth) / 2 || Math.abs(item.position.y - other.position.y) >= (height + otherHeight) / 2).toBe(true);
      }
    }
    expect(result.headers.some((header) => header.label === 'Air')).toBe(true);
    expect(result.headers.some((header) => header.label.includes('Atlas'))).toBe(true);
  });
});
