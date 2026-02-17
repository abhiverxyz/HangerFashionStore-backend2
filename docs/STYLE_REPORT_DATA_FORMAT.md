# Style Report: standard data and profile format

This document defines the **report data** and **style profile** shapes produced by the Style Report Agent (B4.3) so frontends and renderers can rely on a stable structure.

---

## Report data (for rendering)

Stored in `UserProfile.latestStyleReportData` and returned by `GET /api/style-report` and `POST /api/style-report`.

| Field | Type | Description |
|-------|------|-------------|
| `version` | number | Schema version (e.g. 1) for evolution |
| `generatedAt` | string | ISO 8601 date when the report was generated |
| `headline` | string | Report title |
| `sections` | array | Narrative sections from LLM: `{ title: string, content: string }[]` |
| `byLooks` | array | Per-look data (see below) |
| `byItems` | object | Aggregates + detailed breakdown (see below) |

### byLooks[]. Look object

| Field | Type | Description |
|-------|------|-------------|
| `lookId` | string | Look id |
| `imageUrl` | string \| null | Look image URL |
| `vibe`, `occasion`, `timeOfDay` | string \| null | Look metadata |
| `comment`, `labels`, `classificationTags` | — | From look analysis |
| `analysisComment`, `suggestions` | — | Optional |
| **`itemsByType`** | object | **Pairing**: `{ clothing: ItemSummary[], footwear: ItemSummary[], accessory: ItemSummary[] }` |
| **`pairingSummary`** | string \| null | Short text e.g. "Casual top with jeans and sneakers" |

### ItemSummary (minimal)

| Field | Type |
|-------|------|
| `type` | string \| null (e.g. "clothing", "footwear", "accessory") |
| `description` | string \| null |
| `category` | string \| null |
| `color` | string \| null |
| `style` | string \| null |
| `lookId` | string \| null (optional, for linking back to look) |

### byItems

| Field | Type | Description |
|-------|------|-------------|
| **`aggregates`** | object | `itemCount`, `byCategory` (counts), `byColor` (counts), `byType` (counts), `topTypes` |
| **`detailedBreakdown`** | object | `byCategory`, `byColor`, `byType`: each is `Record<string, ItemSummary[]>` (items grouped by that dimension) |

### reportData.comprehensive (optional)

When present, the report includes a **comprehensive profile** block (backend parity) for future UI or migration.

| Field | Type | Description |
|-------|------|-------------|
| `elements` | object | Nine dimensions, each `{ label: string, sub_elements: object }`. Keys: `colour_palette`, `silhouette_and_fit`, `fabric_texture_and_feel`, `styling_strategy`, `trend_preference`, `construction_and_detail_sensitivity`, `expression_intensity`, `contextual_flexibility`, `temporal_orientation`. Each sub_elements uses `{ value, scale?, position?, options?, confidence? }` where applicable. |
| `synthesis` | object | `style_descriptor_short`, `style_descriptor_long`, `style_keywords` (string[]), `one_line_takeaway`, `dominant_categories`, `dominant_colors`, `dominant_silhouettes`. |
| `style_dna` | object | `archetype_name`, `archetype_tagline`, `keywords` (string[]), `dna_line`. |
| `ideas_for_you` | object | `within_style_zone` (string[]), `adjacent_style_zone` (string[]). |
| `meta` (optional) | object | `version`, `generated_at`, `generated_from_looks`. |

---

## Style profile (for personalization and display)

Written to `UserProfile.styleProfileData` by the Style Report Agent. Used by Styling Agent, User Profile, etc.

| Field | Type | Description |
|-------|------|-------------|
| `dominantSilhouettes` | string \| null | e.g. "Relaxed, loose fits" |
| `colorPalette` | string \| null | e.g. "Neutrals and earth tones" |
| `formalityRange` | string \| null | e.g. "Casual to smart-casual" |
| `styleKeywords` | string[] | e.g. ["minimalist", "comfortable"] |
| `oneLiner` | string \| null | One-sentence style summary |
| `pairingTendencies` | string \| null | Optional: how they pair clothing with footwear/accessories |

When the Style Report Agent produces a comprehensive block, `styleProfileData` may also include **`comprehensive`** (same structure as `reportData.comprehensive`) so consumers reading `profile.styleProfile.data` can use it without changing how profile is loaded.

---

## Render mapping

- **Cover / title:** `headline` + `generatedAt`
- **Sections:** `sections[].title` + `sections[].content`
- **By looks:** For each `byLooks[]`: image + vibe/occasion + `itemsByType` (clothing, footwear, accessory) + `pairingSummary`
- **By items:** `byItems.aggregates` for counts/charts; `byItems.detailedBreakdown` for "items per category/color/type" lists
