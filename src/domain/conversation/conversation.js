import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";
import { getAvatarByIdOrSlug, getDefaultAvatar } from "../stylingAgentConfig/stylingAgentConfig.js";

/** Thrown when conversation is not found or user does not own it; API should respond with 404. */
export class ConversationNotFoundError extends Error {
  constructor(message = "Conversation not found or access denied") {
    super(message);
    this.name = "ConversationNotFoundError";
    this.statusCode = 404;
  }
}

const DEFAULT_RECENT_MESSAGES_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;

/**
 * Create a new conversation for the user.
 * D.3.2: Optional source, prefillMessage, entryPoint for embedded flows (e.g. Concierge from Looks).
 * @param {string} userId
 * @param {Object} [options] - { title?, metadata?, source?, prefillMessage?, entryPoint? }
 * @returns {Promise<Object>} New conversation (id, userId, title, createdAt, updatedAt, metadata)
 */
export async function createConversation(userId, options = {}) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("Invalid userId");
  const prisma = getPrisma();
  const data = { userId: uid };
  if (options.title != null) data.title = String(options.title);
  let metadata = options.metadata;
  if (options.source != null || options.prefillMessage != null || options.entryPoint != null) {
    const parsed = typeof metadata === "string" ? (tryParseJson(metadata) || {}) : { ...(metadata && typeof metadata === "object" ? metadata : {}) };
    if (options.source != null) parsed.source = options.source;
    if (options.prefillMessage != null) parsed.prefillMessage = options.prefillMessage;
    if (options.entryPoint != null) parsed.entryPoint = options.entryPoint;
    metadata = parsed;
  }
  if (metadata != null) data.metadata = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
  const conv = await prisma.conversation.create({ data });
  return toConversationSummary(conv);
}

function tryParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * List conversations for the user, ordered by updatedAt desc.
 * @param {string} userId
 * @param {Object} [opts] - { limit?, offset? }
 * @returns {Promise<{ conversations: Object[], nextOffset?: number }>}
 */
export async function listConversations(userId, opts = {}) {
  const uid = normalizeId(userId);
  if (!uid) return { conversations: [], nextOffset: null };
  const prisma = getPrisma();
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIST_LIMIT), 100);
  const offset = Math.max(0, opts.offset ?? 0);

  const conversations = await prisma.conversation.findMany({
    where: { userId: uid },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: offset,
    take: limit + 1,
  });

  const hasMore = conversations.length > limit;
  const list = (hasMore ? conversations.slice(0, limit) : conversations).map(toConversationSummary);
  const nextOffset = hasMore ? offset + limit : null;
  return { conversations: list, nextOffset };
}

/**
 * Update a conversation's title (and optionally metadata) if it belongs to the user.
 * @param {string} conversationId
 * @param {string} userId
 * @param {Object} updates - { title?, metadata? }
 * @returns {Promise<Object>} Updated conversation summary
 * @throws {ConversationNotFoundError} If not found or not owned
 */
export async function updateConversation(conversationId, userId, updates = {}) {
  const cid = normalizeId(conversationId);
  const uid = normalizeId(userId);
  if (!cid || !uid) throw new Error("Invalid conversationId or userId");
  const prisma = getPrisma();
  const conv = await prisma.conversation.findFirst({
    where: { id: cid, userId: uid },
    select: { id: true, title: true, metadata: true },
  });
  if (!conv) throw new ConversationNotFoundError();
  const data = {};
  if (updates.title !== undefined) data.title = updates.title == null ? null : String(updates.title).trim() || null;
  if (updates.metadata !== undefined) data.metadata = typeof updates.metadata === "string" ? updates.metadata : updates.metadata == null ? null : JSON.stringify(updates.metadata);
  if (Object.keys(data).length === 0) return toConversationSummary({ ...conv, ...data });
  const updated = await prisma.conversation.update({
    where: { id: cid },
    data,
  });
  return toConversationSummary(updated);
}

/**
 * Delete a conversation if it belongs to the user. Messages cascade.
 * @param {string} conversationId
 * @param {string} userId
 * @throws {ConversationNotFoundError} If not found or not owned
 */
export async function deleteConversation(conversationId, userId) {
  const cid = normalizeId(conversationId);
  const uid = normalizeId(userId);
  if (!cid || !uid) throw new Error("Invalid conversationId or userId");
  const prisma = getPrisma();
  const conv = await prisma.conversation.findFirst({
    where: { id: cid, userId: uid },
    select: { id: true },
  });
  if (!conv) throw new ConversationNotFoundError();
  await prisma.conversation.delete({ where: { id: cid } });
}

/**
 * Get a single conversation by id if it belongs to the user. Optionally include messages.
 * @param {string} conversationId
 * @param {string} userId
 * @param {Object} [opts] - { includeMessages?: boolean }
 * @returns {Promise<Object|null>} Conversation or null if not found / not owned
 */
export async function getConversation(conversationId, userId, opts = {}) {
  const cid = normalizeId(conversationId);
  const uid = normalizeId(userId);
  if (!cid || !uid) return null;
  const prisma = getPrisma();
  const conv = await prisma.conversation.findFirst({
    where: { id: cid, userId: uid },
    include: opts.includeMessages ? { messages: { orderBy: { createdAt: "asc" } } } : undefined,
  });
  if (!conv) return null;
  const out = toConversationSummary(conv);
  if (opts.includeMessages && conv.messages) {
    out.messages = conv.messages.map(toMessageSummary);
  }
  return out;
}

/**
 * Normalize to an array of image URLs (strings).
 * @param {string|string[]|null|undefined} imageUrlOrUrls - Single URL, array of URLs, or null
 * @returns {string[]}
 */
function normalizeImageUrls(imageUrlOrUrls) {
  if (Array.isArray(imageUrlOrUrls)) {
    return imageUrlOrUrls.filter((u) => u != null && String(u).trim() !== "").map(String);
  }
  if (imageUrlOrUrls != null && String(imageUrlOrUrls).trim() !== "") {
    return [String(imageUrlOrUrls).trim()];
  }
  return [];
}

/**
 * Append a message to a conversation. Updates conversation.updatedAt for list ordering.
 * @param {string} conversationId
 * @param {Object} payload - { role, content, imageUrl?, imageUrls?, flowType?, flowContext?, metadata? }
 * @param {string} [userId] - If provided, enforces that the conversation belongs to this user.
 * @returns {Promise<Object>} Created message (id, role, content, imageUrl, imageUrls, flowType, flowContext, createdAt)
 */
export async function appendMessage(conversationId, payload, userId = null) {
  const cid = normalizeId(conversationId);
  if (!cid) throw new Error("Invalid conversationId");
  const prisma = getPrisma();

  const imageUrls = normalizeImageUrls(payload.imageUrls ?? payload.imageUrl);

  const data = {
    conversationId: cid,
    role: String(payload.role),
    content: String(payload.content ?? ""),
    imageUrls,
  };
  if (imageUrls.length > 0) data.imageUrl = imageUrls[0];
  if (payload.flowType != null) data.flowType = String(payload.flowType);
  if (payload.flowContext != null) {
    data.flowContext = typeof payload.flowContext === "string" ? payload.flowContext : JSON.stringify(payload.flowContext);
  }
  if (payload.metadata != null) {
    data.metadata = typeof payload.metadata === "string" ? payload.metadata : JSON.stringify(payload.metadata);
  }

  const message = await prisma.$transaction(async (tx) => {
    if (userId) {
      const conv = await tx.conversation.findFirst({ where: { id: cid, userId: normalizeId(userId) } });
      if (!conv) throw new Error("Conversation not found or access denied");
    } else {
      const conv = await tx.conversation.findUnique({ where: { id: cid } });
      if (!conv) throw new Error("Conversation not found");
    }
    const msg = await tx.conversationMessage.create({ data });
    await tx.conversation.update({ where: { id: cid }, data: { updatedAt: new Date() } });
    return msg;
  });

  return toMessageSummary(message);
}

/**
 * Get the last N messages for a conversation in chronological order (oldest first).
 * @param {string} conversationId
 * @param {number} limit
 * @param {string} [userId] - If provided, enforces that the conversation belongs to this user.
 * @returns {Promise<Object[]>} Array of message summaries
 */
export async function getRecentMessages(conversationId, limit, userId = null) {
  const cid = normalizeId(conversationId);
  if (!cid) return [];
  const prisma = getPrisma();
  const take = Math.min(Math.max(1, limit), 100);
  const where = { conversationId: cid };
  if (userId) {
    const conv = await prisma.conversation.findFirst({ where: { id: cid, userId: normalizeId(userId) }, select: { id: true } });
    if (!conv) return [];
  }
  const messages = await prisma.conversationMessage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
  });
  return messages.reverse().map(toMessageSummary);
}

/**
 * Single entry for a user turn: validate, persist user message, load context, call Router, persist assistant message, return.
 * @param {string} userId
 * @param {string} conversationId
 * @param {string} message
 * @param {string|string[]|null} [imageUrlOrUrls] - Single image URL or array of image URLs
 * @param {Object} [opts] - { recentMessagesLimit?, router?, avatarIdOrSlug? }
 * @returns {Promise<{ reply: string, flowType?: string, flowContext?: object, messageId: string }>}
 */
export async function handleTurn(userId, conversationId, message, imageUrlOrUrls = null, opts = {}) {
  const uid = normalizeId(userId);
  const cid = normalizeId(conversationId);
  if (!uid || !cid) throw new Error("Invalid userId or conversationId");

  const prisma = getPrisma();
  const conv = await prisma.conversation.findFirst({ where: { id: cid, userId: uid } });
  if (!conv) throw new ConversationNotFoundError();

  const imageUrls = normalizeImageUrls(imageUrlOrUrls);

  const recentLimit = opts.recentMessagesLimit ?? DEFAULT_RECENT_MESSAGES_LIMIT;
  const router = opts.router ?? (await import("../../agents/router.js")).route;

  const initialMessageCount = await prisma.conversationMessage.count({ where: { conversationId: cid } });

  // 1. Persist user message
  await appendMessage(cid, { role: "user", content: message, imageUrls }, uid);

  // 2 & 3. Load context and resolve avatar in parallel (code review: speed)
  const resolveAvatar = async () => {
    const resolved =
      opts.avatarIdOrSlug != null ? await getAvatarByIdOrSlug(opts.avatarIdOrSlug) : null;
    return resolved ?? (await getDefaultAvatar());
  };
  const [history, avatar] = await Promise.all([
    getRecentMessages(cid, recentLimit, uid),
    resolveAvatar(),
  ]);
  const avatarIdForMessage = avatar?.id ?? null;

  // 4. Route and run agent (pass avatar; D.3: entryContext on first turn for embedded flows)
  const context = { userId: uid, avatarIdOrSlug: opts.avatarIdOrSlug ?? null };
  if (initialMessageCount === 0 && conv.metadata) {
    try {
      const meta = typeof conv.metadata === "string" ? JSON.parse(conv.metadata) : conv.metadata;
      if (meta && (meta.source != null || meta.prefillMessage != null || meta.entryPoint != null)) {
        context.entryContext = {
          source: meta.source ?? null,
          prefillMessage: meta.prefillMessage ?? null,
          entryPoint: meta.entryPoint ?? null,
        };
      }
    } catch (_) {
      // ignore invalid metadata
    }
  }
  const agentResult = await router({ message, imageUrls, history }, context);

  const reply = agentResult.reply ?? "I'm here to help with styling. How can I assist you?";
  const flowType = agentResult.flowType ?? null;
  const flowContext = agentResult.flowContext ?? null;

  // 5. Persist assistant message (flowContext as JSON; metadata.avatarId for per-message avatar)
  const assistantPayload = {
    role: "assistant",
    content: reply,
    flowType,
    flowContext,
  };
  if (avatarIdForMessage) assistantPayload.metadata = { avatarId: avatarIdForMessage };
  const assistantMsg = await appendMessage(cid, assistantPayload, uid);

  let conversationTitle = conv.title ?? null;
  if (initialMessageCount === 0 && (conv.title == null || String(conv.title).trim() === "")) {
    const generatedTitle = generateConversationTitleFromMessage(message);
    try {
      await updateConversation(cid, uid, { title: generatedTitle });
      conversationTitle = generatedTitle;
    } catch (e) {
      console.warn("[conversation] updateConversation title failed:", e?.message);
    }
  }

  // 6. Return for API
  return {
    reply,
    flowType: flowType ?? undefined,
    flowContext: typeof flowContext === "object" ? flowContext : flowContext != null ? JSON.parse(flowContext) : undefined,
    messageId: assistantMsg.id,
    conversationTitle: conversationTitle ?? undefined,
  };
}

// --- Helpers ---

const GREETING_PATTERN = /^(hi|hello|hey|how are you|what'?s your name|who are you|howdy|greetings)[.?!]?\s*$/i;
const TITLE_MAX_LEN = 48;

function generateConversationTitleFromMessage(messageText) {
  const t = (messageText || "").trim();
  if (!t) return "Style chat";
  if (GREETING_PATTERN.test(t)) return "Style chat";
  if (t.length <= TITLE_MAX_LEN) return t;
  return t.slice(0, TITLE_MAX_LEN).trim() + "…";
}

function toConversationSummary(conv) {
  return {
    id: conv.id,
    userId: conv.userId,
    title: conv.title ?? null,
    metadata: conv.metadata ?? null,
    createdAt: conv.createdAt?.toISOString?.() ?? conv.createdAt,
    updatedAt: conv.updatedAt?.toISOString?.() ?? conv.updatedAt,
  };
}

function toMessageSummary(msg) {
  const imageUrls = Array.isArray(msg.imageUrls) && msg.imageUrls.length > 0
    ? msg.imageUrls
    : msg.imageUrl != null && String(msg.imageUrl).trim() !== ""
      ? [String(msg.imageUrl)]
      : [];
  const out = {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    imageUrl: imageUrls.length > 0 ? imageUrls[0] : (msg.imageUrl ?? null),
    imageUrls,
    flowType: msg.flowType ?? null,
    flowContext: msg.flowContext ?? null,
    createdAt: msg.createdAt?.toISOString?.() ?? msg.createdAt,
  };
  if (msg.metadata != null) {
    try {
      out.metadata = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata;
    } catch {
      out.metadata = {};
    }
  }
  return out;
}

