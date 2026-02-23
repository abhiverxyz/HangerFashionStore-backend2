import { Prisma } from "@prisma/client";
import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";
import { embedText, embedImage, embedImageWithQuery } from "../../utils/llm.js";

/** Max products to load for semantic similarity when pgvector is not used. */
const SEMANTIC_SEARCH_CANDIDATE_LIMIT = 2000;

/** OpenAI text-embedding-3-small dimension; must match DB vector(1536). */
const EMBEDDING_DIM = 1536;

/** Cosine distance threshold: only return products with distance < this (pgvector <=>; 0–2 range, lower = more similar). */
const RELEVANCE_DISTANCE_THRESHOLD = Number(process.env.RELEVANCE_DISTANCE_THRESHOLD) || 0.55;

/** Min similarity (dot product, ~cosine) for in-memory path; only return products above this. */
const RELEVANCE_MIN_SIMILARITY = Number(process.env.RELEVANCE_MIN_SIMILARITY) || 0.25;

/**
 * Get a single product by id (with brand and images).
 */
export async function getProduct(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.product.findUnique({
    where: { id: nid },
    include: {
      brand: { select: { id: true, name: true, logoUrl: true } },
      images: { orderBy: { position: "asc" } },
      variants: true,
    },
  });
}

/**
 * List products with optional filters and optional text search (title, tags).
 * @param {Object} opts - { brandId?, status?, limit?, offset?, category_lvl1?, occasion_primary?, mood_vibe?, search? }
 */
export async function listProducts(opts = {}) {
  const {
    brandId,
    status = "active",
    limit = 24,
    offset = 0,
    category_lvl1,
    occasion_primary,
    mood_vibe,
    search,
  } = opts;
  const prisma = getPrisma();
  const where = { status: status || "active" };
  if (normalizeId(brandId)) where.brandId = normalizeId(brandId);
  if (category_lvl1 != null && String(category_lvl1).trim()) where.category_lvl1 = String(category_lvl1).trim();
  if (occasion_primary != null && String(occasion_primary).trim()) where.occasion_primary = String(occasion_primary).trim();
  if (mood_vibe != null && String(mood_vibe).trim()) where.mood_vibe = String(mood_vibe).trim();
  if (search != null && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { tags: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        brand: { select: { id: true, name: true, logoUrl: true } },
        images: { take: 1, orderBy: { position: "asc" } },
        variants: { select: { price: true }, take: 1, orderBy: { id: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(limit) || 24, 100),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.product.count({ where }),
  ]);

  return { items, total };
}

/**
 * Dot product of two vectors (same length). OpenAI embeddings are normalized, so dot ≈ cosine similarity.
 */
function dot(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Natural language or image-based semantic search over products.
 * Uses pgvector when available (full catalog, fast); otherwise in-memory similarity over products with embedding.
 * @param {Object} opts - { query?, imageUrl?, limit?, offset?, brandId?, status?, category_lvl1?, occasion_primary?, mood_vibe? }
 * @returns {Promise<{ items: Object[], total: number }>}
 */
export async function searchProducts(opts = {}) {
  const {
    query,
    imageUrl,
    limit = 24,
    offset = 0,
    brandId,
    status = "active",
    category_lvl1,
    occasion_primary,
    mood_vibe,
  } = opts;

  const queryTrimmed = query != null ? String(query).trim() : "";
  const imageUrlTrimmed = imageUrl != null ? String(imageUrl).trim() : "";

  if (!queryTrimmed && !imageUrlTrimmed) {
    return listProducts({
      search: query,
      limit,
      offset,
      brandId,
      status,
      category_lvl1,
      occasion_primary,
      mood_vibe,
    });
  }

  let queryVector;
  if (imageUrlTrimmed && queryTrimmed) {
    queryVector = await embedImageWithQuery(imageUrlTrimmed, queryTrimmed);
  } else if (imageUrlTrimmed) {
    queryVector = await embedImage(imageUrlTrimmed);
  } else {
    queryVector = await embedText(queryTrimmed.slice(0, 8000));
  }

  const prisma = getPrisma();
  const limitNum = Math.min(Number(limit) || 24, 100);
  const offsetNum = Math.max(0, Number(offset) || 0);
  const nidBrand = normalizeId(brandId);
  const cat =
    category_lvl1 != null && String(category_lvl1).trim() ? String(category_lvl1).trim() : null;
  const occ =
    occasion_primary != null && String(occasion_primary).trim() ? String(occasion_primary).trim() : null;
  const mood =
    mood_vibe != null && String(mood_vibe).trim() ? String(mood_vibe).trim() : null;

  const vectorStr = "[" + queryVector.join(",") + "]";

  try {
    const distanceCondition = Prisma.raw(
      `(embedding_vector <=> '${vectorStr}'::vector(1536)) < ${RELEVANCE_DISTANCE_THRESHOLD}`
    );
    const orderByDistance = Prisma.raw(`embedding_vector <=> '${vectorStr}'::vector(1536)`);
    const conditions = [
      Prisma.sql`status = ${status || "active"}`,
      Prisma.sql`embedding_vector IS NOT NULL`,
      distanceCondition,
    ];
    if (nidBrand) conditions.push(Prisma.sql`"brandId" = ${nidBrand}`);
    if (cat) conditions.push(Prisma.sql`"category_lvl1" = ${cat}`);
    if (occ) conditions.push(Prisma.sql`"occasion_primary" = ${occ}`);
    if (mood) conditions.push(Prisma.sql`"mood_vibe" = ${mood}`);

    const [ids, countResult] = await Promise.all([
      prisma.$queryRaw(
        Prisma.sql`
        SELECT id FROM "Product"
        WHERE ${Prisma.join(conditions, " AND ")}
        ORDER BY ${orderByDistance}
        LIMIT ${limitNum} OFFSET ${offsetNum}
        `
      ),
      prisma.$queryRaw(
        Prisma.sql`
        SELECT COUNT(*)::int as c FROM "Product"
        WHERE ${Prisma.join(conditions, " AND ")}
        `
      ),
    ]);

    const idList = ids.map((row) => row.id);
    const total = countResult[0]?.c ?? 0;
    if (idList.length === 0) return { items: [], total };

    const order = idList.map((id, i) => ({ id, ord: i }));
    const products = await prisma.product.findMany({
      where: { id: { in: idList } },
      include: {
        brand: { select: { id: true, name: true, logoUrl: true } },
        images: { take: 1, orderBy: { position: "asc" } },
        variants: { select: { price: true }, take: 1, orderBy: { id: "asc" } },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const items = idList
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((p) => {
        const { embedding, embedding_vector, ...rest } = p;
        return rest;
      });

    return { items, total };
  } catch (pgErr) {
    console.warn("[searchProducts] pgvector path failed, falling back to in-memory:", pgErr?.message);
  }

  const where = {
    status: status || "active",
    embedding: { not: null },
  };
  if (nidBrand) where.brandId = nidBrand;
  if (cat) where.category_lvl1 = cat;
  if (occ) where.occasion_primary = occ;
  if (mood) where.mood_vibe = mood;

  const candidates = await prisma.product.findMany({
    where,
    include: {
      brand: { select: { id: true, name: true, logoUrl: true } },
      images: { take: 1, orderBy: { position: "asc" } },
      variants: { select: { price: true }, take: 1, orderBy: { id: "asc" } },
    },
    take: SEMANTIC_SEARCH_CANDIDATE_LIMIT,
  });

  const scored = [];
  for (const p of candidates) {
    let vec;
    try {
      vec = typeof p.embedding === "string" ? JSON.parse(p.embedding) : p.embedding;
    } catch {
      continue;
    }
    if (!Array.isArray(vec) || vec.length !== queryVector.length) continue;
    const score = dot(queryVector, vec);
    if (score >= RELEVANCE_MIN_SIMILARITY) scored.push({ product: p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const total = scored.length;
  const slice = scored.slice(offsetNum, offsetNum + limitNum);
  const items = slice.map(({ product }) => {
    const { embedding, ...rest } = product;
    return rest;
  });
  return { items, total };
}
