import { getPrisma } from "../../core/db.js";
import { normalizeId, safeJsonParse } from "../../core/helpers.js";

const MAX_SECTIONS = 3;
const VISIBILITY_SCOPE_ALL = "all";
const VISIBILITY_SCOPE_SINGLE_USER = "single_user";
const VISIBILITY_SCOPE_SELECT_USERS = "select_users";

/**
 * Parse sections JSON from MicroStore.
 * @returns {Array<{ label: string, productIds: string[] }>}
 */
export function parseSections(sectionsJson) {
  const arr = safeJsonParse(sectionsJson, []);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s) => s && typeof s.label === "string" && Array.isArray(s.productIds))
    .map((s) => ({ label: s.label, productIds: s.productIds.filter((id) => id != null && String(id).trim()) }));
}

/**
 * Check if a user can see a microstore (visibility + not deleted).
 */
export function canUserSeeStore(store, userId) {
  if (!store) return false;
  if (store.deletedAt) return false;
  const scope = store.visibilityScope || VISIBILITY_SCOPE_ALL;
  if (scope === VISIBILITY_SCOPE_ALL) return true;
  if (!userId) return false;
  if (scope === VISIBILITY_SCOPE_SINGLE_USER) return store.visibilityUserId === userId;
  if (scope === VISIBILITY_SCOPE_SELECT_USERS) {
    if (store.visibleTo && store.visibleTo.some((v) => v.userId === userId)) return true;
    return false;
  }
  return false;
}

/**
 * Build visibility filter for list: only stores the user is allowed to see.
 */
function visibilityWhere(userId, adminBypass = false) {
  if (adminBypass) return { deletedAt: null };
  const prisma = getPrisma();
  return {
    deletedAt: null,
    OR: [
      { visibilityScope: null },
      { visibilityScope: VISIBILITY_SCOPE_ALL },
      ...(userId
        ? [
            { visibilityScope: VISIBILITY_SCOPE_SINGLE_USER, visibilityUserId: userId },
            { visibilityScope: VISIBILITY_SCOPE_SELECT_USERS, visibleTo: { some: { userId } } },
          ]
        : []),
    ],
  };
}

const defaultInclude = {
  brand: { select: { id: true, name: true, logoUrl: true } },
  products: { orderBy: { order: "asc" }, include: { product: { include: { images: { take: 1, orderBy: { position: "asc" } } } } } },
  visibleTo: { select: { userId: true } },
  _count: { select: { followers: true } },
};

/**
 * List microstores visible to the user (or all if admin).
 * @param {Object} opts - { userId?, adminBypass?, brandId?, status?, featured?, limit?, offset? }
 */
export async function listMicrostores(opts = {}) {
  const { userId, adminBypass = false, brandId, status, featured, limit = 24, offset = 0 } = opts;
  const prisma = getPrisma();
  const where = { ...visibilityWhere(userId, adminBypass) };
  if (normalizeId(brandId)) where.brandId = normalizeId(brandId);
  if (status != null && String(status).trim()) where.status = String(status).trim();
  if (featured === true) where.featured = true;

  const [items, total] = await Promise.all([
    prisma.microStore.findMany({
      where,
      include: defaultInclude,
      orderBy: [{ order: "asc" }, { publishedAt: "desc" }, { updatedAt: "desc" }],
      take: Math.min(Number(limit) || 24, 100),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.microStore.count({ where }),
  ]);

  return { items, total };
}

/**
 * Get a single microstore by id. Returns null if not found or not visible to user.
 */
export async function getMicrostore(id, userId = null, adminBypass = false) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const store = await prisma.microStore.findFirst({
    where: { id: nid, ...visibilityWhere(userId, adminBypass) },
    include: defaultInclude,
  });
  return store;
}

/**
 * Create a microstore (admin/creator). Optional visibility and sections.
 */
export async function createMicrostore(data) {
  const prisma = getPrisma();
  const {
    name,
    description,
    coverImageUrl,
    styleNotes,
    brandId,
    vibe,
    trends,
    categories,
    status = "draft",
    createdBy = "admin",
    createdByUserId,
    visibilityScope,
    visibilityUserId,
    visibleUserIds,
    sections: sectionsInput,
    ...rest
  } = data;

  const sections = normalizeSectionsInput(sectionsInput);

  const store = await prisma.microStore.create({
    data: {
      name: name || "Untitled Store",
      description: description ?? null,
      coverImageUrl: coverImageUrl ?? null,
      styleNotes: typeof styleNotes === "string" ? styleNotes : (styleNotes != null ? JSON.stringify(styleNotes) : null),
      brandId: normalizeId(brandId) ?? null,
      vibe: vibe ?? null,
      trends: trends ?? null,
      categories: categories ?? null,
      status: status || "draft",
      createdBy: createdBy || "admin",
      createdByUserId: normalizeId(createdByUserId) ?? null,
      visibilityScope: visibilityScope ?? null,
      visibilityUserId: normalizeId(visibilityUserId) ?? null,
      ...rest,
    },
    include: defaultInclude,
  });

  if (Array.isArray(visibleUserIds) && visibleUserIds.length > 0 && (store.visibilityScope === VISIBILITY_SCOPE_SELECT_USERS || !store.visibilityScope)) {
    await prisma.microStoreVisibleTo.createMany({
      data: visibleUserIds.map((uid) => ({ microStoreId: store.id, userId: String(uid) })),
      skipDuplicates: true,
    });
    if (store.visibilityScope !== VISIBILITY_SCOPE_SELECT_USERS) {
      await prisma.microStore.update({ where: { id: store.id }, data: { visibilityScope: VISIBILITY_SCOPE_SELECT_USERS } });
    }
  }

  if (sections.length > 0) {
    await setMicroStoreProductsInternal(prisma, store.id, sections);
  }

  return prisma.microStore.findUnique({
    where: { id: store.id },
    include: defaultInclude,
  });
}

/**
 * Update a microstore (admin/creator). Partial update.
 */
export async function updateMicrostore(id, data) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const {
    name,
    description,
    coverImageUrl,
    styleNotes,
    vibe,
    trends,
    categories,
    status,
    visibilityScope,
    visibilityUserId,
    visibleUserIds,
    sections: sectionsInput,
    ...rest
  } = data;

  const update = { ...rest };
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (coverImageUrl !== undefined) update.coverImageUrl = coverImageUrl;
  if (styleNotes !== undefined) update.styleNotes = typeof styleNotes === "string" ? styleNotes : JSON.stringify(styleNotes);
  if (vibe !== undefined) update.vibe = vibe;
  if (trends !== undefined) update.trends = trends;
  if (categories !== undefined) update.categories = categories;
  if (status !== undefined) update.status = status;
  if (visibilityScope !== undefined) update.visibilityScope = visibilityScope;
  if (visibilityUserId !== undefined) update.visibilityUserId = normalizeId(visibilityUserId) ?? null;

  const store = await prisma.microStore.update({
    where: { id: nid },
    data: update,
    include: defaultInclude,
  });

  if (visibleUserIds !== undefined && Array.isArray(visibleUserIds)) {
    await prisma.microStoreVisibleTo.deleteMany({ where: { microStoreId: nid } });
    if (visibleUserIds.length > 0) {
      await prisma.microStore.update({ where: { id: nid }, data: { visibilityScope: VISIBILITY_SCOPE_SELECT_USERS } });
      await prisma.microStoreVisibleTo.createMany({
        data: visibleUserIds.map((uid) => ({ microStoreId: nid, userId: String(uid) })),
        skipDuplicates: true,
      });
    }
  }

  const sections = normalizeSectionsInput(sectionsInput);
  if (sections.length > 0) {
    await setMicroStoreProductsInternal(prisma, nid, sections);
  }

  return prisma.microStore.findUnique({
    where: { id: nid },
    include: defaultInclude,
  });
}

function normalizeSectionsInput(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_SECTIONS)
    .filter((s) => s && typeof s.label === "string")
    .map((s) => ({ label: s.label, productIds: Array.isArray(s.productIds) ? s.productIds.map((id) => String(id)) : [] }));
}

/**
 * Set products and sections for a microstore (max 3 sections). Replaces existing products.
 * @param {string} microStoreId
 * @param {Array<{ label: string, productIds: string[] }>} sections - max 3
 * @param {string} [scopeBrandId] - when set, all productIds must belong to this brand (for brand-user microstores)
 */
export async function setMicroStoreProducts(microStoreId, sections, scopeBrandId = null) {
  const nid = normalizeId(microStoreId);
  if (!nid) return null;
  const prisma = getPrisma();
  const normalized = normalizeSectionsInput(sections);
  const scopeBrand = normalizeId(scopeBrandId);
  if (scopeBrand) {
    const allIds = [...new Set(normalized.flatMap((s) => s.productIds))];
    if (allIds.length > 0) {
      const products = await prisma.product.findMany({
        where: { id: { in: allIds } },
        select: { id: true, brandId: true },
      });
      const byBrand = products.filter((p) => p.brandId === scopeBrand);
      if (byBrand.length !== allIds.length) {
        const invalid = allIds.filter((id) => !products.find((p) => p.id === id) || products.find((p) => p.id === id)?.brandId !== scopeBrand);
        throw new Error(`Products must belong to brand ${scopeBrand}; invalid or wrong brand: ${invalid.join(", ")}`);
      }
    }
  }
  await setMicroStoreProductsInternal(prisma, nid, normalized);
  return prisma.microStore.findUnique({
    where: { id: nid },
    include: defaultInclude,
  });
}

async function setMicroStoreProductsInternal(prisma, microStoreId, sections) {
  const flat = [];
  let order = 0;
  for (const sec of sections) {
    for (const productId of sec.productIds) {
      flat.push({ microStoreId, productId, order: order++ });
    }
  }
  await prisma.microStoreProduct.deleteMany({ where: { microStoreId } });
  if (flat.length > 0) {
    await prisma.microStoreProduct.createMany({
      data: flat,
      skipDuplicates: true,
    });
  }
  const sectionsJson = JSON.stringify(sections.map((s) => ({ label: s.label, productIds: s.productIds })));
  await prisma.microStore.update({
    where: { id: microStoreId },
    data: {
      sections: sectionsJson,
      productCount: flat.length,
      lastChangedAt: new Date(),
    },
  });
}

/**
 * Follow a microstore.
 */
export async function followMicrostore(microStoreId, userId) {
  const mid = normalizeId(microStoreId);
  const uid = normalizeId(userId);
  if (!mid || !uid) return null;
  const prisma = getPrisma();
  await prisma.microStoreFollower.upsert({
    where: { microStoreId_userId: { microStoreId: mid, userId: uid } },
    create: { microStoreId: mid, userId: uid },
    update: {},
  });
  return getMicrostore(mid, uid);
}

/**
 * Unfollow a microstore.
 */
export async function unfollowMicrostore(microStoreId, userId) {
  const mid = normalizeId(microStoreId);
  const uid = normalizeId(userId);
  if (!mid || !uid) return null;
  const prisma = getPrisma();
  await prisma.microStoreFollower.deleteMany({ where: { microStoreId: mid, userId: uid } });
  return getMicrostore(mid, uid);
}

/**
 * Publish a microstore (set status published, publishedAt).
 */
export async function publishMicrostore(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.microStore.update({
    where: { id: nid },
    data: { status: "published", publishedAt: new Date() },
    include: defaultInclude,
  });
}

/**
 * Archive a microstore.
 */
export async function archiveMicrostore(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.microStore.update({
    where: { id: nid },
    data: { status: "archived", archivedAt: new Date() },
    include: defaultInclude,
  });
}

const STATUS_PENDING_APPROVAL = "pending_approval";

/**
 * Submit microstore for approval (brand users). Only draft microstores can be submitted.
 * Sets status to pending_approval.
 */
export async function submitMicrostoreForApproval(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const store = await prisma.microStore.findUnique({
    where: { id: nid },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!store || store.deletedAt) return null;
  if (store.status !== "draft") {
    throw new Error(`Microstore must be in draft status to submit; current: ${store.status}`);
  }
  return prisma.microStore.update({
    where: { id: nid },
    data: { status: STATUS_PENDING_APPROVAL },
    include: defaultInclude,
  });
}

/**
 * Approve microstore (admin). Only pending_approval microstores can be approved.
 * Sets status to published and publishedAt.
 */
export async function approveMicrostore(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const store = await prisma.microStore.findUnique({
    where: { id: nid },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!store || store.deletedAt) return null;
  if (store.status !== STATUS_PENDING_APPROVAL) {
    throw new Error(`Microstore must be pending_approval to approve; current: ${store.status}`);
  }
  return prisma.microStore.update({
    where: { id: nid },
    data: { status: "published", publishedAt: new Date() },
    include: defaultInclude,
  });
}

/**
 * Reject microstore (admin). Only pending_approval microstores can be rejected.
 * Sets status back to draft.
 */
export async function rejectMicrostore(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const store = await prisma.microStore.findUnique({
    where: { id: nid },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!store || store.deletedAt) return null;
  if (store.status !== STATUS_PENDING_APPROVAL) {
    throw new Error(`Microstore must be pending_approval to reject; current: ${store.status}`);
  }
  return prisma.microStore.update({
    where: { id: nid },
    data: { status: "draft" },
    include: defaultInclude,
  });
}

/**
 * Soft-delete a microstore.
 */
export async function deleteMicrostore(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.microStore.update({
    where: { id: nid },
    data: { deletedAt: new Date(), status: "deleted" },
    include: defaultInclude,
  });
}

/**
 * Set visibility for a microstore.
 * @param {string} microStoreId
 * @param {Object} opts - { scope: "all"|"single_user"|"select_users", visibilityUserId?, userIds? }
 */
export async function setMicrostoreVisibility(microStoreId, opts) {
  const nid = normalizeId(microStoreId);
  if (!nid) return null;
  const prisma = getPrisma();
  const { scope, visibilityUserId, userIds } = opts;
  const update = {};
  if (scope === VISIBILITY_SCOPE_ALL) {
    update.visibilityScope = scope;
    update.visibilityUserId = null;
  } else if (scope === VISIBILITY_SCOPE_SINGLE_USER) {
    update.visibilityScope = scope;
    update.visibilityUserId = normalizeId(visibilityUserId) ?? null;
  } else if (scope === VISIBILITY_SCOPE_SELECT_USERS) {
    update.visibilityScope = scope;
    update.visibilityUserId = null;
    if (Array.isArray(userIds) && userIds.length > 0) {
      await prisma.microStoreVisibleTo.deleteMany({ where: { microStoreId: nid } });
      await prisma.microStoreVisibleTo.createMany({
        data: userIds.map((uid) => ({ microStoreId: nid, userId: String(uid) })),
        skipDuplicates: true,
      });
    }
  }
  if (Object.keys(update).length > 0) {
    await prisma.microStore.update({ where: { id: nid }, data: update });
  }
  return getMicrostore(nid, null, true);
}

/**
 * Search microstores by name/description (text). Respects visibility.
 */
export async function searchMicrostores(query, opts = {}) {
  const { userId, adminBypass = false, limit = 20 } = opts;
  const q = typeof query === "string" ? query.trim() : "";
  const prisma = getPrisma();
  const where = { ...visibilityWhere(userId, adminBypass) };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  const items = await prisma.microStore.findMany({
    where,
    include: defaultInclude,
    orderBy: [{ order: "asc" }, { publishedAt: "desc" }],
    take: Math.min(Number(limit) || 20, 50),
  });
  return { items };
}

/**
 * Get or create the "Store for you" microstore for a user.
 * Finds existing store with visibilityScope single_user and visibilityUserId = userId; otherwise runs curation and creates one.
 */
export async function getOrCreateStoreForUser(userId) {
  const uid = normalizeId(userId);
  if (!uid) return null;
  const prisma = getPrisma();
  const existing = await prisma.microStore.findFirst({
    where: {
      deletedAt: null,
      visibilityScope: VISIBILITY_SCOPE_SINGLE_USER,
      visibilityUserId: uid,
      createdBy: "store_for_user",
    },
    include: defaultInclude,
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;

  const { runMicrostoreCuration } = await import("../../agents/microstoreCurationAgent.js");
  const curated = await runMicrostoreCuration({ userId: uid });
  const styleNotesStr = typeof curated.styleNotes === "string" ? curated.styleNotes : JSON.stringify(curated.styleNotes || {});

  const store = await prisma.microStore.create({
    data: {
      name: curated.name,
      description: curated.description,
      coverImageUrl: curated.coverImageUrl ?? null,
      styleNotes: styleNotesStr,
      vibe: curated.vibe ?? null,
      trends: curated.trends ?? null,
      categories: curated.categories ?? null,
      status: "draft",
      createdBy: "store_for_user",
      createdByUserId: uid,
      visibilityScope: VISIBILITY_SCOPE_SINGLE_USER,
      visibilityUserId: uid,
      lastGeneratedAt: new Date(),
    },
    include: defaultInclude,
  });

  await setMicroStoreProductsInternal(prisma, store.id, curated.sections || []);
  return prisma.microStore.findUnique({
    where: { id: store.id },
    include: defaultInclude,
  });
}
