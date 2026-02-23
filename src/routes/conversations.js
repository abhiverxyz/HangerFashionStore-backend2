import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as conversation from "../domain/conversation/conversation.js";

const router = Router();

/** POST /api/conversations — create a new conversation. D.3: optional source, prefillMessage, metadata.entryPoint for embedded flows. */
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { title, metadata, source, prefillMessage } = req.body ?? {};
    const entryPoint = req.body?.metadata?.entryPoint;
    const conv = await conversation.createConversation(req.userId, {
      title,
      metadata,
      source,
      prefillMessage,
      ...(entryPoint != null && { entryPoint }),
    });
    res.status(201).json(conv);
  })
);

/** GET /api/conversations — list conversations for the user (paginated) */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = req.query.limit != null ? parseInt(req.query.limit, 10) : undefined;
    const offset = req.query.offset != null ? parseInt(req.query.offset, 10) : undefined;
    const result = await conversation.listConversations(req.userId, { limit, offset });
    res.json(result);
  })
);

/** GET /api/conversations/:id — get one conversation (with optional messages) */
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const conv = await conversation.getConversation(req.params.id, req.userId, {
      includeMessages: true,
    });
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    res.json(conv);
  })
);

/** PATCH /api/conversations/:id — update conversation (e.g. title) */
router.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { title, metadata } = req.body ?? {};
    try {
      const updated = await conversation.updateConversation(req.params.id, req.userId, {
        ...(title !== undefined && { title }),
        ...(metadata !== undefined && { metadata }),
      });
      res.json(updated);
    } catch (err) {
      if (err.name === "ConversationNotFoundError" || err.statusCode === 404) {
        return res.status(404).json({ error: err.message ?? "Conversation not found" });
      }
      throw err;
    }
  })
);

/** DELETE /api/conversations/:id — delete conversation (must own it) */
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await conversation.deleteConversation(req.params.id, req.userId);
      res.status(204).send();
    } catch (err) {
      if (err.name === "ConversationNotFoundError" || err.statusCode === 404) {
        return res.status(404).json({ error: err.message ?? "Conversation not found" });
      }
      throw err;
    }
  })
);

/** POST /api/conversations/:id/messages — send a message and get assistant reply (handleTurn).
 * Body: { message, imageUrl? } (legacy) or { message, imageUrls? } (array of image URLs). Optional: avatarId or avatarSlug for tone/personality.
 */
router.post(
  "/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { message, imageUrl, imageUrls, avatarId, avatarSlug } = req.body ?? {};
    if (message == null || String(message).trim() === "") {
      return res.status(400).json({ error: "message is required" });
    }
    const imagePayload =
      Array.isArray(imageUrls) && imageUrls.length > 0
        ? imageUrls
        : imageUrl != null && String(imageUrl).trim() !== ""
          ? String(imageUrl).trim()
          : null;
    const avatarIdOrSlug = avatarId != null && String(avatarId).trim() !== "" ? String(avatarId).trim() : avatarSlug != null && String(avatarSlug).trim() !== "" ? String(avatarSlug).trim() : null;
    try {
      const result = await conversation.handleTurn(
        req.userId,
        req.params.id,
        String(message).trim(),
        imagePayload,
        { avatarIdOrSlug }
      );
      res.json(result);
    } catch (err) {
      if (err.name === "ConversationNotFoundError" || err.statusCode === 404) {
        return res.status(404).json({ error: err.message ?? "Conversation not found" });
      }
      throw err;
    }
  })
);

export default router;
