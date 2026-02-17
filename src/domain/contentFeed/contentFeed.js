/**
 * Content Feed Service (B9) — backed by FeedPost.
 * List, get, create, update, delete, approve; create from link.
 */
import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

const includeRelations = {
  creator: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
  brand: {
    select: { id: true, name: true, logoUrl: true },
  },
  approver: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
};

function serializePost(post) {
  if (!post) return null;
  return {
    id: post.id,
    type: post.type,
    title: post.title,
    subtitle: post.subtitle ?? null,
    imageUrl: post.imageUrl,
    videoUrl: post.videoUrl ?? null,
    contentType: post.contentType ?? "image",
    href: post.href ?? null,
    meta: post.meta ?? null,
    isActive: post.isActive,
    order: post.order,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    createdBy: post.createdBy ?? "admin",
    createdByUserId: post.createdByUserId ?? null,
    brandId: post.brandId ?? null,
    approvalStatus: post.approvalStatus ?? "pending",
    approvedBy: post.approvedBy ?? null,
    approvedAt: post.approvedAt ? post.approvedAt.toISOString() : null,
    rejectionReason: post.rejectionReason ?? null,
    creator: post.creator ?? null,
    brand: post.brand ?? null,
    approver: post.approver ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

/**
 * List feed posts with filters and pagination.
 * @param {Object} opts - { active, type, approvalStatus, createdBy, contentType, brandId, userId, limit, offset }
 */
export async function listFeedPosts(opts = {}) {
  const {
    active,
    type,
    approvalStatus,
    createdBy,
    contentType,
    brandId,
    userId,
    limit = 50,
    offset = 0,
  } = opts;
  const prisma = getPrisma();
  const where = {};
  if (typeof active === "boolean") where.isActive = active;
  if (type != null && String(type).trim()) where.type = String(type).trim();
  if (approvalStatus != null && String(approvalStatus).trim())
    where.approvalStatus = String(approvalStatus).trim();
  if (createdBy != null && String(createdBy).trim()) where.createdBy = String(createdBy).trim();
  if (contentType != null && String(contentType).trim())
    where.contentType = String(contentType).trim();
  if (normalizeId(brandId)) where.brandId = normalizeId(brandId);
  if (normalizeId(userId)) where.createdByUserId = normalizeId(userId);

  const [items, total] = await Promise.all([
    prisma.feedPost.findMany({
      where,
      include: includeRelations,
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      take: Math.min(Number(limit) || 50, 100),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.feedPost.count({ where }),
  ]);
  return { items: items.map(serializePost), total };
}

/**
 * Get a single feed post by id.
 */
export async function getFeedPost(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const post = await prisma.feedPost.findUnique({
    where: { id: nid },
    include: includeRelations,
  });
  return serializePost(post);
}

/**
 * Create a feed post. Caller sets createdBy, createdByUserId, brandId as appropriate.
 */
export async function createFeedPost(data) {
  const prisma = getPrisma();
  const {
    type = "drop",
    title,
    subtitle,
    imageUrl,
    videoUrl,
    contentType = "image",
    href,
    meta,
    isActive = true,
    order = 0,
    publishedAt,
    createdBy = "admin",
    createdByUserId,
    brandId,
    approvalStatus = "pending",
  } = data;
  if (!title || title.trim() === "") {
    throw new Error("title is required");
  }
  const post = await prisma.feedPost.create({
    data: {
      type: String(type).trim(),
      title: String(title).trim(),
      subtitle: subtitle != null ? String(subtitle).trim() : null,
      imageUrl: imageUrl != null && String(imageUrl).trim() ? String(imageUrl).trim() : "",
      videoUrl: videoUrl ?? null,
      contentType: contentType === "video" ? "video" : "image",
      href: href ?? null,
      meta: meta != null ? (typeof meta === "string" ? meta : JSON.stringify(meta)) : null,
      isActive: Boolean(isActive),
      order: Number(order) || 0,
      publishedAt: publishedAt ? new Date(publishedAt) : null,
      createdBy: String(createdBy),
      createdByUserId: normalizeId(createdByUserId) ?? null,
      brandId: normalizeId(brandId) ?? null,
      approvalStatus: String(approvalStatus),
    },
    include: includeRelations,
  });
  return serializePost(post);
}

/**
 * Update a feed post (partial). Admin can edit any; brand only own brandId.
 */
export async function updateFeedPost(id, data, opts = {}) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const { adminCanEditAny = false, brandIdScope = null } = opts;
  const existing = await prisma.feedPost.findUnique({
    where: { id: nid },
    select: { id: true, brandId: true },
  });
  if (!existing) return null;
  if (!adminCanEditAny && brandIdScope != null && existing.brandId !== brandIdScope) {
    return null; // brand user can only edit own brand's posts
  }
  const {
    type,
    title,
    subtitle,
    imageUrl,
    videoUrl,
    contentType,
    href,
    meta,
    isActive,
    order,
    publishedAt,
  } = data;
  const update = {};
  if (type !== undefined) update.type = String(type).trim();
  if (title !== undefined) update.title = String(title).trim();
  if (subtitle !== undefined) update.subtitle = subtitle != null ? String(subtitle).trim() : null;
  if (imageUrl !== undefined) update.imageUrl = imageUrl;
  if (videoUrl !== undefined) update.videoUrl = videoUrl ?? null;
  if (contentType !== undefined) update.contentType = contentType === "video" ? "video" : "image";
  if (href !== undefined) update.href = href ?? null;
  if (meta !== undefined) update.meta = typeof meta === "string" ? meta : JSON.stringify(meta);
  if (isActive !== undefined) update.isActive = Boolean(isActive);
  if (order !== undefined) update.order = Number(order) || 0;
  if (publishedAt !== undefined) update.publishedAt = publishedAt ? new Date(publishedAt) : null;

  const post = await prisma.feedPost.update({
    where: { id: nid },
    data: update,
    include: includeRelations,
  });
  return serializePost(post);
}

/**
 * Delete a feed post (admin only).
 */
export async function deleteFeedPost(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  await prisma.feedPost.delete({ where: { id: nid } });
  return { deleted: nid };
}

/**
 * Approve or reject a feed post. Admin only.
 */
export async function approveFeedPost(id, action, approverId, rejectionReason = null) {
  const nid = normalizeId(id);
  if (!nid) return null;
  if (action !== "approve" && action !== "reject") {
    throw new Error("action must be approve or reject");
  }
  const prisma = getPrisma();
  const post = await prisma.feedPost.update({
    where: { id: nid },
    data: {
      approvalStatus: action === "approve" ? "approved" : "rejected",
      approvedBy: normalizeId(approverId) ?? null,
      approvedAt: new Date(),
      rejectionReason: action === "reject" ? (rejectionReason || null) : null,
      isActive: action === "approve",
    },
    include: includeRelations,
  });
  return serializePost(post);
}

/**
 * Create a draft feed post from a URL (fetch metadata). approvalStatus: pending.
 * @param {string} url - Page URL to fetch
 * @param {Object} opts - { createdBy, createdByUserId, brandId, type, titleOverride }
 */
export async function createFeedPostFromLink(url, opts = {}) {
  const { createdBy = "admin", createdByUserId, brandId, type = "drop", titleOverride } = opts;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FeedBot/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);
  const html = await res.text();
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
  const ogDescription = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1];
  const title = titleOverride || ogTitle || new URL(url).hostname || "Untitled";
  const imageUrl = ogImage || "";
  const metaJson = JSON.stringify({ sourceUrl: url });
  return createFeedPost({
    type,
    title: title.slice(0, 500),
    subtitle: ogDescription ? ogDescription.slice(0, 1000) : null,
    imageUrl,
    videoUrl: null,
    contentType: "image",
    href: url,
    meta: metaJson,
    approvalStatus: "pending",
    createdBy,
    createdByUserId: normalizeId(createdByUserId) ?? null,
    brandId: normalizeId(brandId) ?? null,
  });
}
