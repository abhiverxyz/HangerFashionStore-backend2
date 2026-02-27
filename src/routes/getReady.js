/**
 * Get Ready With Me API
 * Mount at: app.use('/api/get-ready', getReadyRouter)
 * All routes require auth (req.userId).
 */

import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getVibeOptions, getStyleTips, evaluateHowDoILook, getOutfitSuggestionsFromAgent } from "../agents/getReadyAgent.js";
import * as lookDomain from "../domain/looks/look.js";
import * as wardrobeDomain from "../domain/wardrobe/wardrobe.js";
import { getLatestStyleReport } from "../domain/userProfile/userProfile.js";

const router = Router();

const MOOD_EMOJIS = [
  "😊", "😎", "✨", "💪", "🌸", "🔥", "😌", "💫", "🌟", "💕",
  "🦋", "🌈", "☀️", "🌙", "🎯", "💼", "🧘", "🎉", "🤗", "😏",
];

/** GET /api/get-ready/vibe-options — returns { options: string[] }. Query: ?timeOfDay=morning|afternoon|evening */
router.get(
  "/vibe-options",
  requireAuth,
  asyncHandler(async (req, res) => {
    const timeOfDay = req.query.timeOfDay || undefined;
    const result = await getVibeOptions(req.userId, { timeOfDay });
    res.json(result);
  })
);

/** GET /api/get-ready/mood-options — returns { emojis: string[] } */
router.get(
  "/mood-options",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ emojis: MOOD_EMOJIS });
  })
);

/** GET /api/get-ready/outfit-suggestions — returns { suggestedLooks: [], fromWardrobe: [] }. fromWardrobe = real wardrobe items first, then style report/looks. */
router.get(
  "/outfit-suggestions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const vibe = req.query.vibe || "";
    const mood = req.query.mood || "";
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const query = req.query.query || "";

    const [agentResult, looksResult, styleReportResult, wardrobeResult] = await Promise.all([
      getOutfitSuggestionsFromAgent(req.userId, { vibe, mood, limit, query }),
      lookDomain.listLooks({ userId: req.userId, limit: 20, offset: 0 }),
      getLatestStyleReport(req.userId),
      wardrobeDomain.listWardrobe({ userId: req.userId, limit: 8, offset: 0 }),
    ]);

    const suggestedLooks = agentResult.suggestedLooks || [];
    const maxFromWardrobe = 8;

    let fromWardrobe = [];
    if (wardrobeResult?.items?.length) {
      fromWardrobe = wardrobeResult.items.slice(0, maxFromWardrobe).map((item) => ({
        id: item.id,
        imageUrl: item.imageUrl || null,
        title: item.category?.trim() || item.tags?.trim() || "Wardrobe item",
      }));
    }
    if (fromWardrobe.length < maxFromWardrobe && styleReportResult?.reportData?.byLooks?.length) {
      const fill = styleReportResult.reportData.byLooks
        .slice(0, maxFromWardrobe - fromWardrobe.length)
        .map((entry, i) => ({
          id: entry.lookId || `report-look-${i}`,
          imageUrl: entry.imageUrl || null,
          title: entry.pairingSummary || "From style report",
        }));
      fromWardrobe = fromWardrobe.concat(fill);
    }
    if (fromWardrobe.length < maxFromWardrobe && looksResult?.items?.length) {
      const fill = looksResult.items
        .slice(0, maxFromWardrobe - fromWardrobe.length)
        .map((look) => ({
          id: look.id,
          imageUrl: look.imageUrl || null,
          title: look.vibe || look.occasion || "Look",
        }));
      fromWardrobe = fromWardrobe.concat(fill);
    }

    res.json({ suggestedLooks, fromWardrobe });
  })
);

/** GET /api/get-ready/style-tips — returns { tips: string[], suggestedProductsOrLooks: [] }. Query: vibe, mood, outfitId */
router.get(
  "/style-tips",
  requireAuth,
  asyncHandler(async (req, res) => {
    const vibe = req.query.vibe || "";
    const mood = req.query.mood || "";
    const outfitId = req.query.outfitId || "";
    const result = await getStyleTips(req.userId, { vibe, mood, outfitId });
    res.json(result);
  })
);

/** POST /api/get-ready/how-do-i-look — body: { text?: string, imageUrl?: string, vibe?: string }. Returns { response: string } */
router.post(
  "/how-do-i-look",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { text, imageUrl, vibe } = req.body || {};
    const result = await evaluateHowDoILook(req.userId, { text, imageUrl, vibe });
    res.json(result);
  })
);

export default router;
