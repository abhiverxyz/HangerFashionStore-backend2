/**
 * Admin: allowed microstore creators (users who can create microstores).
 */
import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler.js";
import * as allowedMicrostoreCreators from "../../domain/allowedMicrostoreCreators/allowedMicrostoreCreators.js";
import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

const router = Router();

/** GET /api/admin/microstore-allowed-creators — list */
router.get(
  "/microstore-allowed-creators",
  asyncHandler(async (req, res) => {
    const { limit, offset } = req.query;
    const result = await allowedMicrostoreCreators.listAllowedMicrostoreCreators({ limit, offset });
    res.json(result);
  })
);

/** POST /api/admin/microstore-allowed-creators — add by userId or username */
router.post(
  "/microstore-allowed-creators",
  asyncHandler(async (req, res) => {
    const { userId: bodyUserId, username } = req.body || {};
    let uid = normalizeId(bodyUserId);
    if (!uid && username && String(username).trim()) {
      const prisma = getPrisma();
      const user = await prisma.user.findFirst({
        where: { username: String(username).trim() },
        select: { id: true },
      });
      if (user) uid = user.id;
    }
    if (!uid) {
      return res.status(400).json({ error: "userId or username is required" });
    }
    const row = await allowedMicrostoreCreators.addAllowedMicrostoreCreator(uid);
    if (!row) return res.status(400).json({ error: "Invalid userId" });
    res.status(201).json(row);
  })
);

/** DELETE /api/admin/microstore-allowed-creators?userId=... — remove */
router.delete(
  "/microstore-allowed-creators",
  asyncHandler(async (req, res) => {
    const userId = normalizeId(req.query.userId);
    if (!userId) {
      return res.status(400).json({ error: "userId query is required" });
    }
    await allowedMicrostoreCreators.removeAllowedMicrostoreCreator(userId);
    res.json({ removed: true });
  })
);

export default router;
