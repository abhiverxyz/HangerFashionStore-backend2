import { getPrisma } from "../../core/db.js";

const SHOPIFY_API_VERSION = "2025-01";

/**
 * Normalize Shopify product data (REST-like shape) to our schema.
 */
export function normalizeProduct(productData, _shopDomain) {
  return {
    source: "shopify",
    sourceProductId: String(productData.id),
    title: productData.title || "",
    descriptionHtml: productData.body_html || "",
    status: (productData.status || "active").toLowerCase(),
    handle: productData.handle || "",
    tags: Array.isArray(productData.tags)
      ? JSON.stringify(productData.tags.map((t) => t.trim()).filter(Boolean))
      : typeof productData.tags === "string"
        ? productData.tags
        : null,
    product_type: productData.product_type || null,
    vendor: productData.vendor || null,
    variants: (productData.variants || []).map((v) => ({
      sourceVariantId: String(v.id),
      sku: v.sku || null,
      price: v.price || "0.00",
      compareAtPrice: v.compare_at_price || null,
      option1: v.option1 ?? null,
      option2: v.option2 ?? null,
      option3: v.option3 ?? null,
      inventoryQuantity: Number(v.inventory_quantity) || 0,
    })),
    images: (productData.images || []).map((img, index) => ({
      src: img.src || img.url,
      position: img.position ?? index,
      alt: img.alt ?? img.altText ?? null,
    })),
  };
}

/**
 * Upsert one product (create or update) for a brand. Idempotent by sourceProductId.
 */
export async function upsertProduct(normalizedProduct, shopDomain) {
  const prisma = getPrisma();
  let brand = await prisma.brand.findUnique({ where: { shopDomain } });
  if (!brand) {
    brand = await prisma.brand.create({
      data: {
        shopDomain,
        name: shopDomain.split(".")[0],
        isActive: true,
      },
    });
  }

  const sourceProductId = normalizedProduct.sourceProductId;
  const existing = await prisma.product.findFirst({
    where: { brandId: brand.id, sourceProductId },
  });

  const productData = {
    brandId: brand.id,
    source: normalizedProduct.source,
    sourceProductId,
    title: normalizedProduct.title,
    descriptionHtml: normalizedProduct.descriptionHtml || null,
    status: normalizedProduct.status,
    handle: normalizedProduct.handle,
    tags: normalizedProduct.tags,
    product_type: normalizedProduct.product_type || null,
    vendor: normalizedProduct.vendor || null,
    syncedAt: new Date(),
  };

  let product;
  if (existing) {
    product = await prisma.product.update({
      where: { id: existing.id },
      data: productData,
    });
    await prisma.productVariant.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
  } else {
    product = await prisma.product.create({ data: productData });
  }

  if (normalizedProduct.variants?.length) {
    await prisma.productVariant.createMany({
      data: normalizedProduct.variants.map((v) => ({ ...v, productId: product.id })),
    });
  }
  if (normalizedProduct.images?.length) {
    await prisma.productImage.createMany({
      data: normalizedProduct.images.map((img) => ({ ...img, productId: product.id })),
    });
  }

  await prisma.brand.update({
    where: { id: brand.id },
    data: { lastSyncedAt: new Date() },
  });

  return product;
}

/**
 * Fetch all products from Shopify Admin GraphQL and sync to DB.
 * @param {string} brandId - Brand id (used to load shopDomain)
 * @param {string} accessToken - Shopify Admin API access token
 * @returns {Promise<{ synced: number, errors: number }>}
 */
export async function syncBrandFromShopify(brandId, accessToken) {
  const prisma = getPrisma();
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new Error(`Brand not found: ${brandId}`);
  const shopDomain = brand.shopDomain;

  const query = `
    query getProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id title handle status bodyHtml tags productType vendor
            images(first: 10) { edges { node { url altText } } }
            variants(first: 100) {
              edges {
                node {
                  id sku price compareAtPrice inventoryQuantity
                  selectedOptions { name value }
                }
              }
            }
          }
        }
      }
    }
  `;

  let hasNextPage = true;
  let cursor = null;
  let synced = 0;
  let errors = 0;
  const graphqlUrl = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  while (hasNextPage) {
    const variables = { first: 50, after: cursor || undefined };
    const res = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API error: ${res.status} - ${text}`);
    }

    const data = await res.json();
    if (data.errors) throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);

    const products = data.data.products;
    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;

    for (const edge of products.edges) {
      const node = edge.node;
      const product = {
        id: node.id.split("/").pop(),
        title: node.title,
        handle: node.handle,
        status: node.status?.toLowerCase?.() || "active",
        body_html: node.bodyHtml,
        tags: node.tags || [],
        product_type: node.productType || null,
        vendor: node.vendor || null,
        images: (node.images?.edges || []).map((e, i) => ({
          url: e.node.url,
          altText: e.node.altText,
          position: i,
        })),
        variants: (node.variants?.edges || []).map((e) => {
          const v = e.node;
          const opts = v.selectedOptions || [];
          return {
            id: v.id.split("/").pop(),
            sku: v.sku,
            price: v.price || "0.00",
            compare_at_price: v.compareAtPrice,
            inventory_quantity: v.inventoryQuantity ?? 0,
            option1: opts[0]?.value ?? null,
            option2: opts[1]?.value ?? null,
            option3: opts[2]?.value ?? null,
          };
        }),
      };

      try {
        const normalized = normalizeProduct(product, shopDomain);
        await upsertProduct(normalized, shopDomain);
        synced++;
      } catch (err) {
        console.error(`[sync] Error syncing product ${product.id}:`, err.message);
        errors++;
      }
    }
  }

  return { synced, errors };
}
