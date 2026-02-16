/**
 * Import products from a Shopify store's public products.json API (no token).
 * Ported from backend/app/routes/api.admin.scrape-and-import-brand.jsx
 */

import { getPrisma } from "../../core/db.js";
import { enqueueEnrichment } from "../../utils/queue.js";

/**
 * Fetch all products from Shopify public JSON API with pagination.
 * @param {string} baseUrl - e.g. https://example.com (no trailing slash)
 * @returns {Promise<Array<{ id, title, description, handle, vendor, product_type, tags, variants, images, ... }>>}
 */
export async function fetchProductsFromPublicUrl(baseUrl) {
  const allProducts = [];
  let page = 1;
  let hasMore = true;
  const base = baseUrl.replace(/\/+$/, "");

  while (hasMore) {
    const url = `${base}/products.json?page=${page}&limit=250`;
    let data;
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HangerImport/1.0)",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 404 && page > 1) {
          hasMore = false;
          break;
        }
        const body = await response.text();
        const hint = body.length > 200 ? body.slice(0, 200) + "…" : body;
        throw new Error(
          `Store returned HTTP ${response.status}: ${response.statusText}. Check the URL (use the store’s root, e.g. https://store.com). Response: ${hint}`
        );
      }

      data = await response.json();
    } catch (err) {
      if (err.message && err.message.startsWith("Store returned HTTP")) throw err;
      if (err instanceof SyntaxError) {
        throw new Error(
          "Store URL did not return valid JSON (e.g. login/404 page). Use the store’s root URL and ensure it’s a Shopify store with public products."
        );
      }
      const cause = err.cause || err;
      const code = cause.code || cause.errno;
      const host = cause.hostname ? ` (${cause.hostname})` : "";
      if (code === "ENOTFOUND" || cause.syscall === "getaddrinfo") {
        throw new Error(
          `Could not reach the store: hostname could not be resolved${host}. Check the URL and that this server has internet access.`
        );
      }
      if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENETUNREACH") {
        throw new Error(
          `Could not connect to the store${host}: ${code}. Check the URL and network.`
        );
      }
      throw new Error(cause.message || err.message || "Failed to fetch store");
    }

    if (data?.products && Array.isArray(data.products)) {
      const products = data.products.map((p) => ({
        id: p.id,
        title: p.title,
        body_html: p.body_html,
        handle: p.handle,
        vendor: p.vendor,
        product_type: p.product_type,
        tags: p.tags,
        variants: p.variants || [],
        images: p.images || [],
      }));
      allProducts.push(...products);
      if (products.length < 250) hasMore = false;
      else {
        page++;
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      hasMore = false;
    }
  }

  return allProducts;
}

/**
 * Normalize raw product from products.json to backend2 Product shape (for upsert).
 */
export function normalizePublicProduct(productData, _baseUrl) {
  const images = (productData.images || []).map((img, index) => ({
    src: typeof img === "string" ? img : (img.src || img.url || ""),
    position: index,
    alt: typeof img === "object" ? (img.alt || null) : null,
  })).filter((img) => img.src);

  return {
    source: "shopify",
    sourceProductId: String(productData.id || productData.handle || `rand-${Math.random().toString(36).slice(2)}`),
    title: productData.title || "",
    descriptionHtml: (productData.body_html ?? productData.description) || "",
    status: "active",
    handle: productData.handle || "",
    tags: productData.tags != null
      ? (Array.isArray(productData.tags) ? JSON.stringify(productData.tags) : String(productData.tags))
      : null,
    product_type: productData.product_type || null,
    vendor: productData.vendor || null,
    variants: (productData.variants || []).map((v, index) => ({
      sourceVariantId: String(v.id || `var-${index}`),
      sku: v.sku || null,
      price: v.price || "0.00",
      compareAtPrice: v.compare_at_price ?? v.compareAtPrice ?? null,
      option1: v.option1 ?? null,
      option2: v.option2 ?? null,
      option3: v.option3 ?? null,
      inventoryQuantity: Number(v.inventory_quantity ?? v.inventoryQuantity ?? 0) || 0,
    })),
    images,
  };
}

/**
 * Derive shop domain from URL (hostname).
 */
function getShopDomainFromUrl(urlInput) {
  let s = urlInput.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
  return s || urlInput;
}

/**
 * Derive brand name from domain (e.g. riasjaipur.com -> Rias Jaipur).
 */
function getBrandNameFromDomain(shopDomain) {
  const parts = shopDomain
    .replace(/\.(com|net|org|in|co\.in)$/i, "")
    .split(/[-.]/)
    .filter((p) => p.toLowerCase() !== "www" && p.length > 0);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || shopDomain;
}

/**
 * Import brand and products from a pre-fetched list (e.g. from frontend). No server-side fetch.
 * Use when the server cannot resolve the store hostname (DNS); the browser fetches and sends payload.
 * @param {string} url - Store URL (e.g. https://example.com)
 * @param {string} [brandName] - Optional display name; otherwise derived from domain
 * @param {Array} rawProducts - Array of raw Shopify product objects (from products.json)
 * @returns {Promise<{ summary, brand }>}
 */
export async function importBrandFromPublicPayload(url, brandName, rawProducts) {
  const prisma = getPrisma();
  const baseUrl = url.trim().startsWith("http") ? url.trim().replace(/\/+$/, "") : `https://${url.trim()}`;
  const shopDomain = getShopDomainFromUrl(baseUrl);
  const name = (brandName && brandName.trim()) || getBrandNameFromDomain(shopDomain);

  if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
    throw new Error("No products in payload. Provide a non-empty products array.");
  }
  console.log("[importPublic] Importing from payload:", rawProducts.length, "products for", shopDomain);
  return importRawProductsIntoBrand(prisma, baseUrl, shopDomain, name, rawProducts);
}

/**
 * Import brand and products from public URL (server fetches products.json). Fails if server cannot resolve store DNS.
 * @param {string} url - Store URL (e.g. https://example.com)
 * @param {string} [brandName] - Optional display name; otherwise derived from domain
 * @returns {Promise<{ summary, brand }>}
 */
export async function importBrandFromPublicUrl(url, brandName) {
  const prisma = getPrisma();
  const baseUrl = url.trim().startsWith("http") ? url.trim().replace(/\/+$/, "") : `https://${url.trim()}`;
  const shopDomain = getShopDomainFromUrl(baseUrl);
  const name = (brandName && brandName.trim()) || getBrandNameFromDomain(shopDomain);

  console.log("[importPublic] Fetching products from", baseUrl);
  const rawProducts = await fetchProductsFromPublicUrl(baseUrl);
  if (!rawProducts.length) {
    throw new Error(
      `No products found at ${baseUrl}/products.json. Use the store’s root URL (e.g. https://store.com) and ensure it’s a Shopify store with public products.`
    );
  }
  console.log("[importPublic] Fetched", rawProducts.length, "products for", shopDomain);
  return importRawProductsIntoBrand(prisma, baseUrl, shopDomain, name, rawProducts);
}

/**
 * Shared: create/update brand and upsert products from raw Shopify product list.
 */
async function importRawProductsIntoBrand(prisma, baseUrl, shopDomain, name, rawProducts) {

  let brand = await prisma.brand.findUnique({ where: { shopDomain } });
  if (!brand) {
    brand = await prisma.brand.create({
      data: {
        shopDomain,
        name,
        websiteUrl: baseUrl,
        description: `Products imported from ${name}`,
        isActive: true,
      },
    });
  } else {
    await prisma.brand.update({
      where: { id: brand.id },
      data: { websiteUrl: baseUrl, lastSyncedAt: new Date() },
    });
  }

  let newProducts = 0;
  let updatedProducts = 0;
  let errors = 0;
  let enqueuedForEnrichment = 0;

  for (const raw of rawProducts) {
    try {
      const normalized = normalizePublicProduct(raw, baseUrl);
      const existing = await prisma.product.findFirst({
        where: { brandId: brand.id, sourceProductId: normalized.sourceProductId },
      });

      const productPayload = {
        brandId: brand.id,
        source: normalized.source,
        sourceProductId: normalized.sourceProductId,
        title: normalized.title,
        descriptionHtml: normalized.descriptionHtml || null,
        status: normalized.status,
        handle: normalized.handle,
        tags: normalized.tags,
        product_type: normalized.product_type,
        vendor: normalized.vendor,
        syncedAt: new Date(),
        enrichmentStatus: "pending",
      };

      let product;
      if (existing) {
        product = await prisma.product.update({
          where: { id: existing.id },
          data: productPayload,
        });
        await prisma.productVariant.deleteMany({ where: { productId: product.id } });
        await prisma.productImage.deleteMany({ where: { productId: product.id } });
        updatedProducts++;
      } else {
        product = await prisma.product.create({ data: productPayload });
        newProducts++;
      }

      if (normalized.variants?.length) {
        await prisma.productVariant.createMany({
          data: normalized.variants.map((v) => ({ ...v, productId: product.id })),
        });
      }
      if (normalized.images?.length) {
        await prisma.productImage.createMany({
          data: normalized.images.map((img) => ({
            productId: product.id,
            src: img.src,
            position: img.position,
            alt: img.alt,
          })),
        });
      }

      try {
        await enqueueEnrichment(product.id, 100);
        enqueuedForEnrichment++;
      } catch (queueErr) {
        console.warn("[importPublic] Enrichment queue failed for product", product.id, queueErr.message);
        // Product is still imported; user can enqueue manually
      }
    } catch (err) {
      errors++;
      console.error(`[importPublic] Error importing product ${raw.id}:`, err.message);
    }
  }

  await prisma.brand.update({
    where: { id: brand.id },
    data: { lastSyncedAt: new Date() },
  });

  const totalProducts = await prisma.product.count({ where: { brandId: brand.id } });

  return {
    summary: {
      total: rawProducts.length,
      newProducts,
      updatedProducts,
      errors,
      enqueuedForEnrichment,
    },
    brand: {
      id: brand.id,
      name: brand.name,
      shopDomain: brand.shopDomain,
      totalProducts,
    },
  };
}
