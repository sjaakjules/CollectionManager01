# Card Associations, Deck Clusters, and Card Packages

This document describes the generated association asset built by
`scripts/build-card-associations.mjs`, the parameters that tune deck clusters and
card packages, and how those two models interact.

The generated association JSON is static application data. It is not part of
`UserData`, guest storage, login storage, or backend user JSON.

## Outputs

The builder writes two assets:

- `tmp/oldAssociations/sorcery_card_associations_balanced.json`
- `tmp/oldAssociations/sorcery_card_associations_meta.json`

Both assets contain:

- `nodes`: card/avatar node metadata.
- `clusters`: non-overlapping deck communities from the deck similarity graph.
- `packages`: overlapping NMF-style card packages.
- `cardPackages`: package memberships for each card/avatar node.
- `deckPackages`: package memberships for each source deck.
- `index`: pairwise association links, optionally enriched with package evidence.
- `__meta`: options, counts, deck names, clustering details, and package model metadata.

## Pipeline

1. Normalize deck archive inputs.
2. Build deck identity vectors.
3. Build the deck similarity graph.
4. Run deck clustering.
5. Compute deck weights for `balanced` or `meta` mode.
6. Build pairwise association channels.
7. Build the card package model with deterministic NMF.
8. Merge package evidence into pairwise links.
9. Serialize clusters, packages, node memberships, and link index.

## Deck Identity Vectors

Each accepted deck becomes identity vectors for:

- `spellbook`
- `atlas`
- `collection`
- `avatar`

Card quantities are rarity-normalized with copy saturation:

```text
saturation = min(1, quantity / rarityLimit)
```

The rarity limits are:

- Ordinary: 4
- Exceptional: 3
- Elite: 2
- Unique: 1

The avatar channel is exact-match only: same avatar scores `1`, different avatar
scores `0`.

## Deck Similarity Graph

The deck graph connects decks whose weighted similarity is above the graph
threshold.

```text
similarity =
  spellbookWeight * weightedJaccard(spellbook)
+ atlasWeight     * weightedJaccard(atlas)
+ collectionWeight * weightedJaccard(collection)
+ avatarWeight    * avatarMatch
```

Current defaults:

```text
similarityThreshold = 0.32
spellbookWeight     = 0.75
atlasWeight         = 0.20
collectionWeight    = 0
avatarWeight        = 0.05
```

The graph is clustered with `graphology-communities-louvain`. If Louvain fails,
the builder falls back to a deterministic greedy modularity approximation.

### Cluster Tuning Parameters

These are available as CLI flags:

| Parameter | Default | Effect |
| --- | ---: | --- |
| `--threshold <n>` | `0.32` | Higher values produce fewer graph edges and usually smaller, tighter clusters. Lower values produce more edges and broader clusters. |
| `--spellbook-weight <n>` | `0.75` | Raises or lowers main spellbook influence on deck similarity. This is the dominant cluster signal by default. |
| `--atlas-weight <n>` | `0.20` | Raises or lowers site/atlas influence on deck similarity. |
| `--collection-weight <n>` | `0` | Adds collection-board cards to deck similarity if enabled. Currently disabled by default. |
| `--avatar-weight <n>` | `0.05` | Raises or lowers same-avatar influence. Higher values make avatar-specific clusters more likely. |
| `--allow-non-constructed` | off | Includes non-Constructed source decks. More data, but noisier. |
| `--allow-incomplete` | off | Includes decks below the full-deck size thresholds. More data, but noisier. |
| `--include-skipped` | off | Includes decks from the skipped archive. |
| `--min-spells <n>` | `50` | Minimum spellbook count for skipped decks when skipped decks are included. |
| `--min-atlas <n>` | `20` | Minimum atlas count for skipped decks when skipped decks are included. |

Internal defaults used by the full-deck filter:

| Parameter | Default | Effect |
| --- | ---: | --- |
| `fullSpellbookMin` | `60` | Minimum spellbook count for full decks. |
| `fullAtlasMin` | `30` | Minimum atlas count for full decks. |

There is currently no direct "number of clusters" parameter. Cluster count is an
emergent result of source data, graph threshold, similarity weights, and Louvain
modularity.

### Cluster Tuning Recipes

- More avatar-specific clusters: increase `--avatar-weight`, or slightly raise
  `--threshold`.
- Broader archetype clusters: lower `--threshold`.
- More site-sensitive clusters: increase `--atlas-weight`.
- Mostly spellbook-driven clusters: keep `collection-weight` at `0`, keep
  `spellbook-weight` high, and keep `atlas-weight` modest.
- More meta-representative clusters: use the generated `meta` asset. It keeps
  every accepted deck at equal weight.
- Less dominant-popular-archetype bias: use the generated `balanced` asset. It
  downweights large clusters.

## Deck Weights

After clustering, the builder creates deck weights for each output mode.

In `balanced` mode:

```text
deckWeight = 1 / sqrt(clusterSize)
```

This gives large clusters less total influence, so popular archetypes do not
overwhelm rarer archetypes.

In `meta` mode:

```text
deckWeight = 1
```

Every accepted deck has equal influence.

Deck weights are used by pairwise associations, cluster profile scores, package
matrix row scaling, package support, and package examples.

## Pairwise Association Graph

The pairwise association index stores directional links between card/avatar
nodes. Four channels are calculated:

- `mainMain`: selected main card to other main card.
- `mainToCollection`: selected main card to collection card.
- `collectionToMain`: selected collection card to main card.
- `collectionCollection`: selected collection card to collection card.

For each channel, the builder tracks:

- `confidence = coCount / countA`
- `baseline = countB / totalWeight`
- `lift = confidence / baseline`
- `reliability = coCount / (coCount + minEvidence)`

The displayed pairwise score is:

```text
score = round(
  100
  * reliability
  * sqrt(confidence)
  * liftComponent
)
```

where:

```text
liftComponent = 0 if lift <= 1
liftComponent = min(1, log2(lift) / 2) otherwise
```

### Pairwise Tuning Parameters

| Parameter | Default | Effect |
| --- | ---: | --- |
| `--min-evidence <n>` | `3` | Reliability midpoint. Higher values suppress low-evidence links. Lower values allow sparse links to surface. |
| `--top-links <n>` | `60` | Maximum serialized links per source node after sorting by visible score. |

## Card Package Model

Packages are overlapping reusable card groups. They are built with deterministic
offline NMF over a deck x node matrix.

Conceptually:

```text
X ~= W * H

X = deck x card/avatar matrix
W = deck x package memberships
H = package x card/avatar weights
```

Each deck can belong to several packages. Each card/avatar can belong to several
packages.

The package matrix includes:

- spellbook cards
- atlas cards
- avatar

It does not include collection cards.

Current package matrix zone weights:

```text
spellbook = 1
atlas     = 1
avatar    = 0.75
```

Each deck row is scaled by:

```text
sqrt(deckWeight)
```

That means package extraction is influenced by balanced/meta deck weighting, but
the package model does not take cluster labels or cluster ids as direct features.

## Do Deck Clusters Influence Packages?

Yes, but only indirectly through deck weights.

The dependency is:

```text
deck similarity graph -> deck clusters -> deckWeight -> package matrix row scale -> NMF packages
```

In `balanced` mode, clusters influence packages because deck weights are
`1 / sqrt(clusterSize)`, and the package matrix scales each row by
`sqrt(deckWeight)`. Large deck clusters therefore have less package-model
influence than they would in the raw archive.

In `meta` mode, deck weights are all `1`, so clusters do not meaningfully affect
package extraction. The NMF package model is then driven by raw accepted deck
contents.

Important boundaries:

- Clusters are non-overlapping communities of decks.
- Packages are overlapping components of cards/avatars.
- Packages are not constrained to stay inside clusters.
- A package can span several clusters.
- A deck can belong to several packages.
- A card/avatar can belong to several packages.

## Package Tuning Parameters

These are available as CLI flags:

| Parameter | Default | Effect |
| --- | ---: | --- |
| `--packages <n>` | `24` | Number of NMF components. Higher values make more specific packages. Lower values make broader packages. |
| `--no-packages` | off | Disables package generation and package link enrichment. |
| `--package-iterations <n>` | `400` | NMF update iterations. Higher may converge better but costs more build time. |
| `--package-seed <n>` | `1337` | Deterministic random seed for NMF initialization. Changes package ordering/content while staying reproducible. |
| `--package-min-card-strength <n>` | `0.12` | Minimum normalized node weight to show in a package top-node list, unless needed to satisfy `minNodesPerPackage`. |
| `--package-min-membership <n>` | `0.08` | Minimum deck membership to count a deck as package support. Also affects serialized deck package memberships. |
| `--package-max-nodes <n>` | `24` | Maximum cards/avatars serialized in each package top-node list. |
| `--package-max-packages-per-node <n>` | `4` | Maximum package memberships serialized for each card/avatar. |
| `--package-boost-weight <n>` | `0.30` | Package contribution when blending package evidence into main association scores. |

These defaults are currently internal builder options, not CLI flags:

| Parameter | Default | Effect |
| --- | ---: | --- |
| `enabled` | `true` | Enables package model generation. |
| `epsilon` | `1e-9` | Numerical stability term in NMF multiplicative updates. |
| `l1H` | `0.002` | L1 regularization on package-card weights. Higher values make package card lists sparser. |
| `l1W` | `0.0005` | L1 regularization on deck-package memberships. Higher values make decks use fewer packages. |
| `minCardPackageStrength` | `0.18` | Minimum normalized package membership for a card/avatar in `cardPackages`. |
| `minNodesPerPackage` | `12` | Keep at least this many top nodes per package before applying the max cap. |
| `maxPackagesPerDeck` | `5` | Maximum package memberships serialized per deck. |
| `maxExampleDecksPerPackage` | `5` | Maximum example decks shown per package. |
| `reliabilityWeightedSupport` | `6` | Weighted support required for full package-link reliability. |
| `zoneWeights.spellbook` | `1` | Spellbook contribution to package matrix. |
| `zoneWeights.atlas` | `1` | Atlas contribution to package matrix. |
| `zoneWeights.avatar` | `0.75` | Avatar contribution to package matrix. |

### Package Tuning Recipes

- More packages and more specificity: increase `--packages`.
- Fewer, broader packages: lower `--packages`.
- Less noisy package top lists: raise `--package-min-card-strength` or lower
  `--package-max-nodes`.
- More cards shown per package: lower `--package-min-card-strength` or raise
  `--package-max-nodes`.
- Fewer package memberships per card: lower `--package-max-packages-per-node`
  or raise internal `minCardPackageStrength`.
- More stable NMF convergence: increase `--package-iterations`.
- Different package decomposition with the same data: change `--package-seed`.
- Less package influence on highlights: lower `--package-boost-weight`.
- More package-only association hints: raise `--package-boost-weight`, but watch
  for visual noise.
- More avatar-shaped packages: raise internal `zoneWeights.avatar`.
- More site-shaped packages: raise internal `zoneWeights.atlas`.

## Package Evidence in Association Links

After NMF, package memberships are merged into the pairwise link index.

For two nodes, shared package strength is:

```text
sqrt(sourcePackageStrength * targetPackageStrength) * packageReliability
```

Package reliability is:

```text
min(1, packageWeightedSupport / reliabilityWeightedSupport)
```

The package score is:

```text
round(100 * bestSharedPackageStrength)
```

The main-channel displayed score blends pairwise and package evidence:

```text
displayedMainScore = min(
  100,
  round(max(pairwiseScore, pairwiseScore * 0.85 + packageScore * packageBoostWeight))
)
```

With the default `packageBoostWeight = 0.30`, pairwise evidence remains dominant.
Package-only links can still appear subtly in the main channel when two cards
share a strong package but do not have a strong pairwise co-occurrence link.

## UI Behavior

The Associations UI has two sub-tabs:

- `Clusters`: browse deck clusters grouped by avatar. Selecting an avatar group
  can show all clusters in that group or one specific cluster.
- `Packages`: browse card packages. Selecting a package highlights the package
  cards and lays duplicate package cards below the full collection.

Highlight channels remain:

- Blue/main: main-deck association or package-derived main score.
- Orange/collection: collection-channel association.

There is no third outline for packages. Package evidence is folded into the main
association channel and described in tooltips.

## Recommended Validation After Tuning

Run:

```bash
node scripts/build-card-associations.mjs
pnpm test -- scripts/build-card-associations.test.mjs
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

After running the legacy offline builder, inspect both generated assets:

- `__meta.version` should be `4`.
- `__meta.mode` should match `balanced` or `meta`.
- `packages`, `cardPackages`, and `deckPackages` should be present unless
  packages were intentionally disabled.
- `index` should contain no self-links.
- Top links should remain capped by `topLinks`.

## Example Commands

Build with tighter deck clusters and more packages:

```bash
node scripts/build-card-associations.mjs --threshold 0.38 --packages 32
```

Build with broader clusters and less package visual influence:

```bash
node scripts/build-card-associations.mjs --threshold 0.25 --package-boost-weight 0.18
```

Build with more avatar-sensitive clusters:

```bash
node scripts/build-card-associations.mjs --avatar-weight 0.15
```

Build without packages:

```bash
node scripts/build-card-associations.mjs --no-packages
```
