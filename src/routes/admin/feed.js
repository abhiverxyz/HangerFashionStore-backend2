/**
 * Admin: Content Feed approve and Feed Agent routes.
 */
import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler.js";
import * as contentFeed from "../../domain/contentFeed/contentFeed.js";
import { runFeedAgent, runFeedAgentVideoIdeas } from "../../agents/feedAgent.js";

const router = Router();

router.post(
  "/feed-posts/approve",
  asyncHandler(async (req, res) => {
    const { postId, action, rejectionReason } = req.body || {};
    if (!postId || !action) {
      return res.status(400).json({ error: "postId and action are required" });
    }
    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ error: "action must be approve or reject" });
    }
    const post = await contentFeed.approveFeedPost(
      postId,
      action,
      req.user?.id ?? null,
      rejectionReason ?? null
    );
    if (!post) return res.status(404).json({ error: "Feed post not found" });
    res.json({ post });
  })
);

router.post(
  "/feed-agent/run",
  asyncHandler(async (req, res) => {
    const { seed, videoIdeas, maxVideoSuggestions } = req.body || {};
    if (videoIdeas === true) {
      const result = await runFeedAgentVideoIdeas({
        seed: seed || "",
        maxVideoSuggestions: maxVideoSuggestions ? Number(maxVideoSuggestions) : undefined,
      });
      return res.json({ success: true, mode: "video_ideas", result });
    }
    const result = await runFeedAgent({ seed: seed || "" });
    res.json({ success: true, mode: "ideas", result });
  })
);

router.post(
  "/feed-agent/video-ideas",
  asyncHandler(async (req, res) => {
    const { seed, maxVideoSuggestions } = req.body || {};
    const result = await runFeedAgentVideoIdeas({
      seed: seed || "",
      maxVideoSuggestions: maxVideoSuggestions ? Number(maxVideoSuggestions) : undefined,
    });
    res.json({ success: true, result });
  })
);

export default router;
