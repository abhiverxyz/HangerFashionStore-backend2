import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

/** Default: last 90 days, max 200 events for "recent events" in combined profile */
const RECENT_EVENTS_DAYS = 90;
const RECENT_EVENTS_LIMIT = 200;

/**
 * Build overall and section summaries from a profile object (no DB, no LLM).
 * @param {Object} profile - Result of getUserProfile (before summary is attached)
 * @returns {{ overall: string, sections: { history: string, styleProfile: string, fashionNeed: string, fashionMotivation: string } }}
 */
function buildProfileSummaries(profile) {
  if (!profile) {
    return {
      overall: "No profile data.",
      sections: {
        history: "No history.",
        styleProfile: "No style profile yet.",
        fashionNeed: "Not yet generated.",
        fashionMotivation: "Not yet generated.",
      },
    };
  }

  let historySummary = "No recent activity.";
  const storedHistory = profile.history?.summary;
  if (storedHistory != null && typeof storedHistory === "string" && storedHistory.trim()) {
    historySummary = storedHistory.trim();
  } else if (Array.isArray(profile.history?.recentEvents) && profile.history.recentEvents.length > 0) {
    const events = profile.history.recentEvents;
    const byType = {};
    for (const e of events) {
      const t = e?.eventType ?? "unknown";
      byType[t] = (byType[t] || 0) + 1;
    }
    const parts = Object.entries(byType).map(([t, n]) => `${n} ${t}`);
    historySummary = `${events.length} events in last 90 days: ${parts.join(", ")}.`;
  }

  let styleProfileSummary = "No style profile yet.";
  const styleData = profile.styleProfile?.data;
  if (styleData != null && typeof styleData === "object") {
    const parts = [];
    if (Array.isArray(styleData.styleKeywords) && styleData.styleKeywords.length > 0) {
      parts.push(styleData.styleKeywords.slice(0, 8).join(", "));
    }
    if (styleData.formalityRange && String(styleData.formalityRange).trim()) {
      parts.push(`Formality: ${String(styleData.formalityRange).trim()}`);
    }
    if (styleData.oneLiner && String(styleData.oneLiner).trim()) {
      parts.push(String(styleData.oneLiner).trim());
    }
    const comp = styleData.comprehensive;
    if (comp?.synthesis?.style_descriptor_short && String(comp.synthesis.style_descriptor_short).trim()) {
      parts.push(String(comp.synthesis.style_descriptor_short).trim());
    }
    if (parts.length > 0) styleProfileSummary = parts.join(". ");
  } else if (styleData != null && typeof styleData === "string" && styleData.trim()) {
    styleProfileSummary = styleData.trim().slice(0, 300);
  }

  const fashionNeedSummary =
    (profile.fashionNeed?.text && String(profile.fashionNeed.text).trim()) || "Not yet generated.";
  const fashionMotivationSummary =
    (profile.fashionMotivation?.text && String(profile.fashionMotivation.text).trim()) || "Not yet generated.";

  const overall = [
    `Style: ${styleProfileSummary}`,
    `Recent activity: ${historySummary}`,
    `Current focus: ${fashionNeedSummary}`,
    `Motivation: ${fashionMotivationSummary}`,
  ].join(" ");

  return {
    overall,
    sections: {
      history: historySummary,
      styleProfile: styleProfileSummary,
      fashionNeed: fashionNeedSummary,
      fashionMotivation: fashionMotivationSummary,
    },
  };
}

/**
 * Get or create UserProfile row for a user. Does not create User.
 */
const USER_PROFILE_SELECT_SAFE = {
  userId: true,
  profileJson: true,
  updatedAt: true,
  fashionMotivation: true,
  fashionMotivationUpdatedAt: true,
  fashionNeed: true,
  fashionNeedUpdatedAt: true,
  historySummary: true,
  quizResponses: true,
  quizSubmittedAt: true,
  quizVersion: true,
  styleProfileData: true,
  styleProfileSource: true,
  styleProfileUpdatedAt: true,
  latestStyleReportData: true,
  latestStyleReportGeneratedAt: true,
  preferenceGraphJson: true,
  preferenceGraphUpdatedAt: true,
};

async function getOrCreateProfileRow(prisma, userId) {
  const uid = normalizeId(userId);
  if (!uid) return null;
  let row = await prisma.userProfile.findUnique({
    where: { userId: uid },
    select: { id: true, userId: true },
  });
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
    prisma.userProfile.findUnique({
      where: { userId: uid },
      select: USER_PROFILE_SELECT_SAFE,
    }),
    prisma.userEvent.findMany({
      where: { userId: uid, timestamp: { gte: since } },
      orderBy: { timestamp: "desc" },
      take: limit,
    }),
  ]);

  if (!row) {
    const defaultProfile = {
      userId: uid,
      styleProfile: { updatedAt: null, source: null, data: null },
      history: { summary: null, recentEvents: [] },
      fashionNeed: { text: null, updatedAt: null },
      fashionMotivation: { text: null, updatedAt: null },
      quiz: { responses: null, submittedAt: null, version: null },
      personalInsight: null,
      personalInsightUpdatedAt: null,
    };
    return { ...defaultProfile, summary: buildProfileSummaries(defaultProfile) };
  }

  // Backward compat: use profileJson as style data when styleProfileData not set.
  // styleProfileData = from Style Report Agent (user images). profileJson = legacy from old backend (wishlist/cart/wardrobe/signals).
  const styleData = row.styleProfileData ?? row.profileJson ?? null;
  const profile = {
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
    personalInsight: row.personalInsight ?? null,
    personalInsightUpdatedAt: row.personalInsightUpdatedAt?.toISOString?.() ?? null,
  };
  return { ...profile, summary: buildProfileSummaries(profile) };
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
 * Write personal insight (Personal Insight Agent). Internal only; no HTTP route.
 * @param {string} userId
 * @param {Object} payload - { insight: string }
 */
export async function writePersonalInsight(userId, payload = {}) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");
  if (typeof payload.insight !== "string" || !payload.insight.trim()) return;
  const prisma = getPrisma();
  const row = await getOrCreateProfileRow(prisma, uid);
  if (!row) throw new Error("User profile not found");
  const now = new Date();
  await prisma.userProfile.update({
    where: { id: row.id },
    data: {
      personalInsight: payload.insight.trim(),
      personalInsightUpdatedAt: now,
    },
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

/**
 * Save latest style report data (Style Report Agent). B4.
 * @param {string} userId
 * @param {Object} reportData - JSON-serializable report payload for rendering
 */
export async function saveLatestStyleReport(userId, reportData) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");
  const prisma = getPrisma();
  const row = await getOrCreateProfileRow(prisma, uid);
  if (!row) throw new Error("User profile not found");
  const now = new Date();
  await prisma.userProfile.update({
    where: { id: row.id },
    data: {
      latestStyleReportData: reportData ?? null,
      latestStyleReportGeneratedAt: now,
    },
  });
}

/**
 * Get latest style report for a user (for GET /api/style-report).
 * @param {string} userId
 * @returns {Promise<{ reportData: object | null, generatedAt: string | null } | null>}
 */
export async function getLatestStyleReport(userId) {
  const uid = normalizeId(userId);
  if (!uid) return null;
  const prisma = getPrisma();
  const row = await prisma.userProfile.findUnique({
    where: { userId: uid },
    select: { latestStyleReportData: true, latestStyleReportGeneratedAt: true },
  });
  if (!row) return null;
  return {
    reportData: row.latestStyleReportData ?? null,
    generatedAt: row.latestStyleReportGeneratedAt?.toISOString?.() ?? null,
  };
}

/**
 * Set preference graph (C+ Phase 2). Used by preferenceGraph.buildPreferenceGraph.
 * @param {string} userId
 * @param {Object} graph - JSON-serializable graph object
 */
export async function setPreferenceGraph(userId, graph) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");
  const prisma = getPrisma();
  const row = await getOrCreateProfileRow(prisma, uid);
  if (!row) throw new Error("User profile not found");
  const now = new Date();
  await prisma.userProfile.update({
    where: { id: row.id },
    data: {
      preferenceGraphJson: graph ?? null,
      preferenceGraphUpdatedAt: now,
    },
  });
}

/**
 * Get stored preference graph for a user (C+ Phase 2).
 * @param {string} userId
 * @returns {Promise<{ graph: object | null, updatedAt: string | null } | null>}
 */
export async function getPreferenceGraphStored(userId) {
  const uid = normalizeId(userId);
  if (!uid) return null;
  const prisma = getPrisma();
  const row = await prisma.userProfile.findUnique({
    where: { userId: uid },
    select: { preferenceGraphJson: true, preferenceGraphUpdatedAt: true },
  });
  if (!row) return null;
  return {
    graph: row.preferenceGraphJson ?? null,
    updatedAt: row.preferenceGraphUpdatedAt?.toISOString?.() ?? null,
  };
}
