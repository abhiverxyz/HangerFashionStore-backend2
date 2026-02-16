import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

/** Default: last 90 days, max 200 events for "recent events" in combined profile */
const RECENT_EVENTS_DAYS = 90;
const RECENT_EVENTS_LIMIT = 200;

/**
 * Get or create UserProfile row for a user. Does not create User.
 */
async function getOrCreateProfileRow(prisma, userId) {
  const uid = normalizeId(userId);
  if (!uid) return null;
  let row = await prisma.userProfile.findUnique({ where: { userId: uid } });
  if (!row) {
    row = await prisma.userProfile.create({
      data: { userId: uid },
    });
  }
  return row;
}

/**
 * Get combined user profile for agents and API.
 * Builds view from UserProfile + recent UserEvent rows.
 * @param {string} userId
 * @param {Object} opts - { recentEventsDays?, recentEventsLimit? }
 * @returns {Promise<Object|null>} Combined profile or null if userId invalid
 */
export async function getUserProfile(userId, opts = {}) {
  const uid = normalizeId(userId);
  if (!uid) return null;
  const prisma = getPrisma();
  const days = opts.recentEventsDays ?? RECENT_EVENTS_DAYS;
  const limit = opts.recentEventsLimit ?? RECENT_EVENTS_LIMIT;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [row, recentEvents] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId: uid } }),
    prisma.userEvent.findMany({
      where: { userId: uid, timestamp: { gte: since } },
      orderBy: { timestamp: "desc" },
      take: limit,
    }),
  ]);

  if (!row) {
    return {
      userId: uid,
      styleProfile: { updatedAt: null, source: null, data: null },
      history: { summary: null, recentEvents: [] },
      fashionNeed: { text: null, updatedAt: null },
      fashionMotivation: { text: null, updatedAt: null },
      quiz: { responses: null, submittedAt: null, version: null },
    };
  }

  // Backward compat: use profileJson as style data when styleProfileData not set
  const styleData = row.styleProfileData ?? row.profileJson ?? null;
  return {
    userId: row.userId,
    styleProfile: {
      updatedAt: row.styleProfileUpdatedAt?.toISOString() ?? null,
      source: row.styleProfileSource ?? null,
      data: styleData,
    },
    history: {
      summary: row.historySummary,
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        sessionId: e.sessionId ?? null,
        productId: e.productId ?? null,
        metadata: e.metadata,
        timestamp: e.timestamp?.toISOString() ?? null,
      })),
    },
    fashionNeed: {
      text: row.fashionNeed ?? null,
      updatedAt: row.fashionNeedUpdatedAt?.toISOString() ?? null,
    },
    fashionMotivation: {
      text: row.fashionMotivation ?? null,
      updatedAt: row.fashionMotivationUpdatedAt?.toISOString() ?? null,
    },
    quiz: {
      responses: row.quizResponses,
      submittedAt: row.quizSubmittedAt?.toISOString() ?? null,
      version: row.quizVersion ?? null,
    },
  };
}

/**
 * Write style profile (Style Report Agent). Internal only; no HTTP route.
 * @param {string} userId
 * @param {Object} payload - { source?, data } data = JSON-serializable blob
 */
export async function writeStyleProfile(userId, payload = {}) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");
  const prisma = getPrisma();
  const row = await getOrCreateProfileRow(prisma, uid);
  if (!row) throw new Error("User profile not found");
  await prisma.userProfile.update({
    where: { id: row.id },
    data: {
      styleProfileUpdatedAt: new Date(),
      styleProfileSource: payload.source ?? row.styleProfileSource ?? null,
      styleProfileData: payload.data ?? row.styleProfileData,
    },
  });
}

/**
 * Append one event to user history (event pipeline / Conversation). Internal only.
 * Uses existing UserEvent model.
 * @param {string} userId
 * @param {Object} event - { eventType, sessionId?, productId?, metadata? } (entityType/entityId from Signal-style optional)
 */
export async function appendHistory(userId, event = {}) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");
  if (!event.eventType) throw new Error("eventType required");
  const prisma = getPrisma();
  await prisma.userEvent.create({
    data: {
      userId: uid,
      sessionId: event.sessionId ?? null,
      eventType: String(event.eventType),
      productId: event.productId ?? null,
      metadata: event.metadata ?? undefined,
    },
  });
}

/**
 * Set aggregated history summary (e.g. from a job). Internal only.
 * @param {string} userId
 * @param {Object} summary - JSON-serializable object
 */
export async function setHistorySummary(userId, summary) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");
  const prisma = getPrisma();
  const row = await getOrCreateProfileRow(prisma, uid);
  if (!row) throw new Error("User profile not found");
  await prisma.userProfile.update({
    where: { id: row.id },
    data: { historySummary: summary ?? null },
  });
}

/**
 * Write fashion need and/or motivation (User Profile Agent). Internal only.
 * @param {string} userId
 * @param {Object} payload - { need?, motivation? }
 */
export async function writeNeedMotivation(userId, payload = {}) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");
  const prisma = getPrisma();
  const row = await getOrCreateProfileRow(prisma, uid);
  if (!row) throw new Error("User profile not found");
  const now = new Date();
  const data = {};
  if (payload.need !== undefined) {
    data.fashionNeed = payload.need;
    data.fashionNeedUpdatedAt = now;
  }
  if (payload.motivation !== undefined) {
    data.fashionMotivation = payload.motivation;
    data.fashionMotivationUpdatedAt = now;
  }
  if (Object.keys(data).length === 0) return;
  await prisma.userProfile.update({
    where: { id: row.id },
    data,
  });
}

/**
 * Submit quiz (API). Creates or updates UserProfile quiz fields.
 * @param {string} userId
 * @param {Object} payload - { responses, version? }
 */
export async function submitQuiz(userId, payload = {}) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");
  if (payload.responses === undefined) throw new Error("responses required");
  const prisma = getPrisma();
  const row = await getOrCreateProfileRow(prisma, uid);
  if (!row) throw new Error("User profile not found");
  await prisma.userProfile.update({
    where: { id: row.id },
    data: {
      quizResponses: payload.responses,
      quizSubmittedAt: new Date(),
      quizVersion: payload.version ?? row.quizVersion ?? null,
    },
  });
}
