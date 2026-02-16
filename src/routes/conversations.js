import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as conversation from "../domain/conversation/conversation.js";

const router = Router();

/** POST /api/conversations — create a new conversation */
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { title, metadata } = req.body ?? {};
    const conv = await conversation.createConversation(req.userId, { title, metadata });
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

/** POST /api/conversations/:id/messages — send a message and get assistant reply (handleTurn).
 * Body: { message, imageUrl? } (legacy) or { message, imageUrls? } (array of image URLs). Both accepted; imageUrls takes precedence.
 */
router.post(
  "/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { message, imageUrl, imageUrls } = req.body ?? {};
    if (message == null || String(message).trim() === "") {
      return res.status(400).json({ error: "message is required" });
    }
    const imagePayload =
      Array.isArray(imageUrls) && imageUrls.length > 0
        ? imageUrls
        : imageUrl != null && String(imageUrl).trim() !== ""
          ? String(imageUrl).trim()
          : null;
    try {
      const result = await conversation.handleTurn(
        req.userId,
        req.params.id,
        String(message).trim(),
        imagePayload
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
