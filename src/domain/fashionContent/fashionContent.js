import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * List trends with optional filters. Used by Styling Agent, MicroStore Curation, and API.
 * @param {Object} opts - { limit?, offset?, category?, status?, search? }
 */
export async function listTrends(opts = {}) {
  const prisma = getPrisma();
  const limit = Math.min(Number(opts.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(0, Number(opts.offset) || 0);
  const where = {};
  if (opts.category) where.category = String(opts.category);
  if (opts.status) where.status = String(opts.status);
  if (opts.search && String(opts.search).trim()) {
    const q = `%${String(opts.search).trim()}%`;
    where.OR = [
      { trendName: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { keywords: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.trend.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        trendName: true,
        description: true,
        keywords: true,
        category: true,
        status: true,
        seasonality: true,
        region: true,
        isCurated: true,
        source: true,
        strength: true,
        parentId: true,
        impactedItemTypes: true,
        tellTaleSigns: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.trend.count({ where }),
  ]);
  return { items, total, limit, offset };
}

/**
 * Get a single trend by id.
 */
export async function getTrend(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.trend.findUnique({
    where: { id: nid },
    select: {
      id: true,
      trendName: true,
      description: true,
      keywords: true,
      category: true,
      status: true,
      seasonality: true,
      region: true,
      isCurated: true,
      source: true,
      strength: true,
      parentId: true,
      impactedItemTypes: true,
      tellTaleSigns: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Find a trend by trendName and parentId (for created vs updated counting). Returns null if not found.
 */
export async function findTrendByTrendNameParentId(trendName, parentId) {
  const prisma = getPrisma();
  const name = String(trendName || "").trim();
  if (!name) return null;
  const isRoot =
    parentId == null ||
    parentId === "" ||
    (typeof parentId === "string" && parentId.trim() === "");
  if (isRoot) {
    return prisma.trend.findFirst({
      where: { trendName: name, parentId: null },
      select: { id: true },
    });
  }
  return prisma.trend.findUnique({
    where: { trendName_parentId: { trendName: name, parentId: String(parentId).trim() } },
    select: { id: true },
  });
}

/**
 * Update a trend by id. Used when we already know the trend exists (for accurate created/updated counts).
 */
export async function updateTrend(id, data) {
  const prisma = getPrisma();
  const nid = normalizeId(id);
  if (!nid) throw new Error("Trend id required");
  const updateData = {
    description: data.description ?? undefined,
    keywords: data.keywords !== undefined ? data.keywords : undefined,
    category: data.category !== undefined ? data.category : undefined,
    status: data.status ?? undefined,
    seasonality: data.seasonality !== undefined ? data.seasonality : undefined,
    region: data.region !== undefined ? data.region : undefined,
    isCurated: data.isCurated !== undefined ? data.isCurated : undefined,
    source: data.source ?? undefined,
    strength: data.strength !== undefined && data.strength != null ? Math.min(10, Math.max(1, Number(data.strength))) : undefined,
    impactedItemTypes: data.impactedItemTypes !== undefined ? (data.impactedItemTypes != null ? String(data.impactedItemTypes) : null) : undefined,
    tellTaleSigns: data.tellTaleSigns !== undefined ? (data.tellTaleSigns != null ? String(data.tellTaleSigns) : null) : undefined,
  };
  const cleaned = Object.fromEntries(Object.entries(updateData).filter(([, v]) => v !== undefined));
  return prisma.trend.update({ where: { id: nid }, data: cleaned });
}

/**
 * Upsert a trend (create or update by trendName + parentId). Used by Fashion Content Agent.
 * Prisma compound unique does not accept null in where, so for root trends we use findFirst + create/update.
 */
export async function upsertTrend(data) {
  const prisma = getPrisma();
  const rawParentId = data.parentId;
  const isRoot =
    rawParentId == null ||
    rawParentId === "" ||
    (typeof rawParentId === "string" && rawParentId.trim() === "");
  const parentId = isRoot ? null : String(rawParentId).trim();
  const payload = {
    trendName: String(data.trendName),
    description: data.description ?? null,
    keywords: data.keywords ?? "",
    category: data.category ?? null,
    status: data.status ?? "active",
    seasonality: data.seasonality ?? null,
    region: data.region ?? null,
    isCurated: data.isCurated ?? true,
    source: data.source ?? "fashion_content_agent",
    strength: data.strength != null ? Math.min(10, Math.max(1, Number(data.strength))) : null,
    parentId,
    impactedItemTypes: data.impactedItemTypes != null ? String(data.impactedItemTypes) : null,
    tellTaleSigns: data.tellTaleSigns != null ? String(data.tellTaleSigns) : null,
  };
  const updateData = {
    description: payload.description,
    keywords: payload.keywords,
    category: payload.category,
    status: payload.status,
    seasonality: payload.seasonality,
    region: payload.region,
    isCurated: payload.isCurated,
    source: payload.source,
    strength: payload.strength,
    impactedItemTypes: payload.impactedItemTypes,
    tellTaleSigns: payload.tellTaleSigns,
  };
  if (isRoot) {
    const existing = await prisma.trend.findFirst({
      where: { trendName: payload.trendName, parentId: null },
    });
    if (existing) {
      return prisma.trend.update({ where: { id: existing.id }, data: updateData });
    }
    return prisma.trend.create({ data: payload });
  }
  return prisma.trend.upsert({
    where: {
      trendName_parentId: { trendName: payload.trendName, parentId },
    },
    create: payload,
    update: updateData,
  });
}

/**
 * Normalize rule body for deduplication: trim, collapse whitespace.
 */
function normalizeRuleBody(body) {
  if (typeof body !== "string") return "";
  return body.replace(/\s+/g, " ").trim();
}

/**
 * Find an existing styling rule by body (normalized). Used to avoid duplicate rules when agent runs.
 * Checks recent rules (by updatedAt, window 2000) and returns first with matching normalized body.
 */
export async function findStylingRuleByBody(body) {
  const normalized = normalizeRuleBody(body);
  if (!normalized) return null;
  const prisma = getPrisma();
  const RULE_BODY_DEDUP_WINDOW = 2000;
  const candidates = await prisma.stylingRule.findMany({
    orderBy: { updatedAt: "desc" },
    take: RULE_BODY_DEDUP_WINDOW,
    select: { id: true, body: true },
  });
  for (const r of candidates) {
    if (normalizeRuleBody(r.body) === normalized) return r;
  }
  return null;
}

/**
 * Find a styling rule by title (for hierarchy parent resolution).
 * Returns the most recently updated rule with that title (case-insensitive).
 * For stable hierarchy, use unique titles per rule.
 */
export async function findStylingRuleByTitle(title) {
  if (!title || String(title).trim() === "") return null;
  const prisma = getPrisma();
  return prisma.stylingRule.findFirst({
    where: { title: { equals: String(title).trim(), mode: "insensitive" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
}

/**
 * Create or update a styling rule. If id provided, update; else create. Used by Fashion Content Agent.
 */
export async function upsertStylingRule(data) {
  const prisma = getPrisma();
  const strength =
    data.strength != null ? Math.min(10, Math.max(1, Number(data.strength))) : null;
  const payload = {
    title: data.title ?? null,
    body: String(data.body),
    ruleType: data.ruleType ?? null,
    category: data.category ?? null,
    subject: data.subject ?? null,
    tags: data.tags ?? null,
    source: data.source ?? "fashion_content_agent",
    status: data.status ?? "active",
    strength,
    parentId: data.parentId ?? null,
  };
  if (data.id) {
    return prisma.stylingRule.update({
      where: { id: normalizeId(data.id) },
      data: payload,
    });
  }
  return prisma.stylingRule.create({ data: payload });
}

/**
 * Prune trends to at most `limit` by composite score: lower score = removed first.
 * Score = strength * 2 + recencyScore (0–1, newer updatedAt = higher). Keeps strong and recent content.
 * Note: Loads all rows into memory; for very large tables (e.g. 50k+), consider batch or DB-side scoring.
 */
export async function pruneTrendsToLimit(limit) {
  const prisma = getPrisma();
  const total = await prisma.trend.count();
  if (total <= limit) return { deleted: 0 };
  const toRemove = total - limit;
  const rows = await prisma.trend.findMany({
    select: { id: true, strength: true, updatedAt: true },
  });
  if (rows.length === 0) return { deleted: 0 };
  const minTs = Math.min(...rows.map((r) => r.updatedAt.getTime()));
  const maxTs = Math.max(...rows.map((r) => r.updatedAt.getTime()));
  const range = maxTs - minTs || 1;
  const withScore = rows.map((r) => ({
    id: r.id,
    score: (r.strength ?? 0) * 2 + (r.updatedAt.getTime() - minTs) / range,
  }));
  withScore.sort((a, b) => a.score - b.score);
  const idsToDelete = withScore.slice(0, toRemove).map((r) => r.id);
  await prisma.trend.deleteMany({ where: { id: { in: idsToDelete } } });
  return { deleted: idsToDelete.length };
}

/**
 * Prune styling rules to at most `limit` by composite score: lower score = removed first.
 * Score = strength * 2 + recencyScore (0–1, newer updatedAt = higher). Keeps strong and recent content.
 * Note: Loads all rows into memory; for very large tables, consider batch or DB-side scoring.
 */
export async function pruneStylingRulesToLimit(limit) {
  const prisma = getPrisma();
  const total = await prisma.stylingRule.count();
  if (total <= limit) return { deleted: 0 };
  const toRemove = total - limit;
  const rows = await prisma.stylingRule.findMany({
    select: { id: true, strength: true, updatedAt: true },
  });
  if (rows.length === 0) return { deleted: 0 };
  const minTs = Math.min(...rows.map((r) => r.updatedAt.getTime()));
  const maxTs = Math.max(...rows.map((r) => r.updatedAt.getTime()));
  const range = maxTs - minTs || 1;
  const withScore = rows.map((r) => ({
    id: r.id,
    score: (r.strength ?? 0) * 2 + (r.updatedAt.getTime() - minTs) / range,
  }));
  withScore.sort((a, b) => a.score - b.score);
  const idsToDelete = withScore.slice(0, toRemove).map((r) => r.id);
  await prisma.stylingRule.deleteMany({ where: { id: { in: idsToDelete } } });
  return { deleted: idsToDelete.length };
}

// ---------- FashionContentSource (admin inputs for agent) ----------

export async function listFashionContentSources(opts = {}) {
  const prisma = getPrisma();
  const where = {};
  if (opts.status) where.status = String(opts.status);
  const limit = Math.min(Number(opts.limit) || 100, 200);
  const items = await prisma.fashionContentSource.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const total = await prisma.fashionContentSource.count({ where });
  return { items, total };
}

export async function addFashionContentSource(data) {
  const prisma = getPrisma();
  const type = String(data.type).toLowerCase();
  if (!["url", "text", "image"].includes(type)) throw new Error("type must be url, text, or image");
  return prisma.fashionContentSource.create({
    data: {
      type,
      payload: String(data.payload ?? "").trim(),
      status: "pending",
      createdBy: data.createdBy ?? null,
    },
  });
}

export async function markFashionContentSourcesProcessed(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const prisma = getPrisma();
  await prisma.fashionContentSource.updateMany({
    where: { id: { in: ids } },
    data: { status: "processed", updatedAt: new Date() },
  });
}

// ---------- AllowedFashionDomain (safety allowlist for web fetch) ----------

export async function listAllowedFashionDomains() {
  const prisma = getPrisma();
  return prisma.allowedFashionDomain.findMany({
    orderBy: { domain: "asc" },
  });
}

export async function addAllowedFashionDomain(domain) {
  const prisma = getPrisma();
  const d = normalizeDomain(domain);
  if (!d) throw new Error("Invalid domain");
  return prisma.allowedFashionDomain.upsert({
    where: { domain: d },
    create: { domain: d },
    update: {},
  });
}

export async function removeAllowedFashionDomain(domainOrId) {
  const prisma = getPrisma();
  const id = normalizeId(domainOrId);
  if (id) {
    const byId = await prisma.allowedFashionDomain.findUnique({ where: { id } });
    if (byId) return prisma.allowedFashionDomain.delete({ where: { id } });
  }
  const d = normalizeDomain(domainOrId);
  if (d) {
    const byDomain = await prisma.allowedFashionDomain.findUnique({ where: { domain: d } });
    if (byDomain) return prisma.allowedFashionDomain.delete({ where: { domain: d } });
  }
  throw new Error("Domain not found");
}

function normalizeDomain(input) {
  if (!input || typeof input !== "string") return null;
  let s = input.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (s.startsWith("www.")) s = s.slice(4);
  return s || null;
}

/**
 * List styling rules with optional filters.
 * @param {Object} opts - { limit?, offset?, category?, status?, ruleType?, search? }
 */
export async function listStylingRules(opts = {}) {
  const prisma = getPrisma();
  const limit = Math.min(Number(opts.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(0, Number(opts.offset) || 0);
  const where = {};
  if (opts.category) where.category = String(opts.category);
  if (opts.status) where.status = String(opts.status);
  if (opts.ruleType) where.ruleType = String(opts.ruleType);
  if (opts.search && String(opts.search).trim()) {
    const q = `%${String(opts.search).trim()}%`;
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { body: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.stylingRule.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.stylingRule.count({ where }),
  ]);
  return { items, total, limit, offset };
}

/**
 * Get a single styling rule by id.
 */
export async function getStylingRule(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.stylingRule.findUnique({ where: { id: nid } });
}
