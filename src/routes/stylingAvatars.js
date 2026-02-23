import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as stylingAgentConfig from "../domain/stylingAgentConfig/stylingAgentConfig.js";

const router = Router();

/** GET /api/styling-avatars — list avatars for Concierge (authenticated users, read-only) */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const avatars = await stylingAgentConfig.listAvatars();
    res.json(avatars);
  })
);

export default router;
