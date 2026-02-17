/**
 * User-scoped routes: /api/user/feed-posts
 */
import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as contentFeed from "../domain/contentFeed/contentFeed.js";

const router = Router();
router.use(requireAuth);

/** GET /api/user/feed-posts — list current user's posts */
router.get(
  "/feed-posts",
  asyncHandler(async (req, res) => {
    const result = await contentFeed.listFeedPosts({
      userId: req.userId,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json({ posts: result.items, total: result.total });
  })
);

/** POST /api/user/feed-posts — user create (draft, pending approval) */
router.post(
  "/feed-posts",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const post = await contentFeed.createFeedPost({
      ...body,
      createdBy: "user",
      createdByUserId: req.userId,
      approvalStatus: "pending",
    });
    res.status(201).json({ post });
  })
);

export default router;
