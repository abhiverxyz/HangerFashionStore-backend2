import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getPrisma } from "../core/db.js";
import { generateAndStoreImage } from "../domain/images/generate.js";

const router = Router();

/** POST /api/generate/image - body: { prompt, aspectRatio? }; returns { imageUrl, key }. Stores image in R2 and creates GeneratedImage row. */
router.post(
  "/image",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { prompt, aspectRatio } = req.body || {};
    try {
      const result = await generateAndStoreImage(prompt || "", { aspectRatio });
      const prisma = getPrisma();
      await prisma.generatedImage.create({
        data: {
          url: result.imageUrl,
          key: result.key,
          userId: req.userId ?? null,
          prompt: (prompt && String(prompt).trim()) || null,
        },
      });
      res.json(result);
    } catch (err) {
      if (err.message && err.message.includes("at most")) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  })
);

export default router;
