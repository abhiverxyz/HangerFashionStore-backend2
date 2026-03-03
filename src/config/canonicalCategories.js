/**
 * Canonical category list for LLM/product mapping. Use these in prompts so the model
 * fixes the product to a specific category (not just "Pants"). See docs/COLOR_AND_STYLE_IMPROVEMENTS.md.
 *
 * Format: { id, label, category_lvl1 } for grouping and filters.
 */
export const CANONICAL_CATEGORIES = [
  { id: "blouse", label: "Blouse", category_lvl1: "Tops" },
  { id: "t_shirt", label: "T-Shirt", category_lvl1: "Tops" },
  { id: "oversized_tshirt", label: "Oversized T-Shirt", category_lvl1: "Tops" },
  { id: "shirt", label: "Shirt", category_lvl1: "Tops" },
  { id: "polo", label: "Polo", category_lvl1: "Tops" },
  { id: "sweater", label: "Sweater", category_lvl1: "Tops" },
  { id: "knitwear", label: "Knitwear", category_lvl1: "Tops" },
  { id: "crop_top", label: "Crop Top", category_lvl1: "Tops" },
  { id: "tank", label: "Tank", category_lvl1: "Tops" },
  { id: "skinny_jeans", label: "Skinny Jeans", category_lvl1: "Bottoms" },
  { id: "straight_leg_jeans", label: "Straight-Leg Jeans", category_lvl1: "Bottoms" },
  { id: "relaxed_jeans", label: "Relaxed Fit Jeans", category_lvl1: "Bottoms" },
  { id: "wide_leg_trousers", label: "Wide-Leg Trousers", category_lvl1: "Bottoms" },
  { id: "chinos", label: "Chinos", category_lvl1: "Bottoms" },
  { id: "trousers", label: "Trousers", category_lvl1: "Bottoms" },
  { id: "shorts", label: "Shorts", category_lvl1: "Bottoms" },
  { id: "skirt", label: "Skirt", category_lvl1: "Bottoms" },
  { id: "dress", label: "Dress", category_lvl1: "One-Piece" },
  { id: "jumpsuit", label: "Jumpsuit", category_lvl1: "One-Piece" },
  { id: "romper", label: "Romper", category_lvl1: "One-Piece" },
  { id: "jacket", label: "Jacket", category_lvl1: "Outerwear" },
  { id: "coat", label: "Coat", category_lvl1: "Outerwear" },
  { id: "blazer", label: "Blazer", category_lvl1: "Outerwear" },
  { id: "sneakers", label: "Sneakers", category_lvl1: "Footwear" },
  { id: "boots", label: "Boots", category_lvl1: "Footwear" },
  { id: "loafers", label: "Loafers", category_lvl1: "Footwear" },
  { id: "sandals", label: "Sandals", category_lvl1: "Footwear" },
  { id: "heels", label: "Heels", category_lvl1: "Footwear" },
  { id: "bag", label: "Bag", category_lvl1: "Accessories" },
  { id: "hat", label: "Hat", category_lvl1: "Accessories" },
  { id: "belt", label: "Belt", category_lvl1: "Accessories" },
  { id: "scarf", label: "Scarf", category_lvl1: "Accessories" },
];

/** Labels only for prompt injection (e.g. "Blouse, T-Shirt, ..."). */
export function getCanonicalCategoryLabels() {
  return CANONICAL_CATEGORIES.map((c) => c.label);
}

/** category_lvl1 grouping for filters. */
export const CATEGORY_LVL1_OPTIONS = ["Tops", "Bottoms", "One-Piece", "Outerwear", "Footwear", "Accessories"];
