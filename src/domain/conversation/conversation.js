import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

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
 * @param {string} userId
 * @param {Object} [options] - { title?, metadata? }
 * @returns {Promise<Object>} New conversation (id, userId, title, createdAt, updatedAt)
 */
export async function createConversation(userId, options = {}) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("Invalid userId");
  const prisma = getPrisma();
  const data = { userId: uid };
  if (options.title != null) data.title = String(options.title);
  if (options.metadata != null) data.metadata = typeof options.metadata === "string" ? options.metadata : JSON.stringify(options.metadata);
  const conv = await prisma.conversation.create({ data });
  return toConversationSummary(conv);
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
 * @param {Object} [opts] - { recentMessagesLimit?, router? }
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

  // 1. Persist user message
  await appendMessage(cid, { role: "user", content: message, imageUrls }, uid);

  // 2. Load context (includes the message we just appended)
  const history = await getRecentMessages(cid, recentLimit, uid);

  // 3. Route and run agent
  const context = { userId: uid };
  const agentResult = await router({ message, imageUrls, history }, context);

  const reply = agentResult.reply ?? "I'm here to help with styling. How can I assist you?";
  const flowType = agentResult.flowType ?? null;
  const flowContext = agentResult.flowContext ?? null;

  // 4. Persist assistant message (flowContext stored as JSON string)
  const assistantMsg = await appendMessage(
    cid,
    { role: "assistant", content: reply, flowType, flowContext },
    uid
  );

  // 5. Return for API
  return {
    reply,
    flowType: flowType ?? undefined,
    flowContext: typeof flowContext === "object" ? flowContext : flowContext != null ? JSON.parse(flowContext) : undefined,
    messageId: assistantMsg.id,
  };
}

// --- Helpers ---

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
  if (msg.metadata != null) out.metadata = msg.metadata;
  return out;
}

