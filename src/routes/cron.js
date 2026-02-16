import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { runFashionContentAgent } from "../agents/fashionContentAgent.js";

const router = Router();
const CRON_SECRET = process.env.CRON_SECRET || "";

function requireCronSecret(req, res, next) {
  const secret = req.headers["x-cron-secret"] || req.query.secret || "";
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/** POST or GET /api/cron/fashion-content-agent - run weekly (X-Cron-Secret header or ?secret=) */
const runAgentHandler = asyncHandler(async (req, res) => {
  const seed = req.method === "POST" ? req.body?.seed : req.query?.seed;
  const result = await runFashionContentAgent({ seed: seed || "" });
  res.json({ success: true, result });
});
router.get("/fashion-content-agent", requireCronSecret, runAgentHandler);
router.post("/fashion-content-agent", requireCronSecret, runAgentHandler);

export default router;
