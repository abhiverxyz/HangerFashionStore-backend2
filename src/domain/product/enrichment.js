import { Prisma } from "@prisma/client";
import { getPrisma } from "../../core/db.js";
import { chat, embed } from "../../utils/llm.js";

const DETECTION_PROMPT = `You are a fashion product classifier. Given the product information below, return a single JSON object with exactly these keys (use null if unknown):
- category_lvl1: one of "tops", "bottoms", "dresses", "ethnicwear", "outerwear", "co-ords", "activewear", "loungewear", "footwear", "accessories", "jewellery", "menswear", or null
- gender: one of "women", "men", "unisex", or null
- color_primary: primary color (e.g. "black", "navy"), or null
- product_type: brief type (e.g. "t-shirt", "jeans"), or null

Product information:
`;

/**
 * Build text bundle from product for LLM.
 */
function textBundle(product) {
  const parts = [];
  if (product.title) parts.push(`Title: ${product.title}`);
  if (product.descriptionHtml) {
    const text = product.descriptionHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (text) parts.push(`Description: ${text.slice(0, 2000)}`);
  }
  if (product.product_type) parts.push(`Product Type: ${product.product_type}`);
  if (product.vendor) parts.push(`Vendor: ${product.vendor}`);
  if (product.tags) {
    try {
      const t = typeof product.tags === "string" ? JSON.parse(product.tags) : product.tags;
      if (Array.isArray(t) && t.length) parts.push(`Tags: ${t.join(", ")}`);
      else if (typeof product.tags === "string") parts.push(`Tags: ${product.tags}`);
    } catch {
      if (typeof product.tags === "string") parts.push(`Tags: ${product.tags}`);
    }
  }
  return parts.join("\n");
}

/**
 * Enrich one product: LLM attributes + optional embedding. Does not re-enqueue existing 27k.
 */
export async function enrichProduct(productId) {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { brand: true, images: { orderBy: { position: "asc" } }, variants: true },
  });

  if (!product) throw new Error(`Product not found: ${productId}`);

  await prisma.product.update({
    where: { id: productId },
    data: { enrichmentStatus: "processing", enrichmentError: null },
  });

  try {
    const text = textBundle(product);
    const prompt = DETECTION_PROMPT + text + "\nRespond only with valid JSON.";

    const result = await chat({
      messages: [{ role: "user", content: prompt }],
      responseFormat: "json_object",
      temperature: 0.2,
      maxTokens: 500,
    });

    const updateData = {
      gender: result.gender || product.gender || null,
      category_lvl1: result.category_lvl1 || product.category_lvl1 || null,
      color_primary: result.color_primary || product.color_primary || null,
      product_type: result.product_type || product.product_type || null,
      enrichedAt: new Date(),
      enrichmentStatus: "completed",
      enrichmentError: null,
    };

    await prisma.product.update({
      where: { id: productId },
      data: updateData,
    });

    // Optional: store text embedding for search (embedding + pgvector embedding_vector)
    try {
      const embedText = [product.title, product.descriptionHtml, result.category_lvl1, result.color_primary].filter(Boolean).join(" ");
      const vector = await embed(embedText.slice(0, 8000));
      await prisma.product.update({
        where: { id: productId },
        data: { embedding: JSON.stringify(vector) },
      });
      const vectorStr = "[" + vector.join(",") + "]";
      await prisma.$executeRaw(
        Prisma.sql`UPDATE "Product" SET embedding_vector = ${vectorStr}::vector(1536) WHERE id = ${productId}`
      );
    } catch (err) {
      console.warn(`[enrichment] Embedding failed for ${productId}:`, err.message);
    }

    return { success: true, productId, data: updateData };
  } catch (err) {
    await prisma.product.update({
      where: { id: productId },
      data: { enrichmentStatus: "failed", enrichmentError: err.message },
    });
    throw err;
  }
}

/**
 * Enqueue product for enrichment (delegate to queue).
 */
export async function enqueueProductEnrichment(productId, priority = 100) {
  const { enqueueEnrichment } = await import("../../utils/queue.js");
  return enqueueEnrichment(productId, priority);
}
