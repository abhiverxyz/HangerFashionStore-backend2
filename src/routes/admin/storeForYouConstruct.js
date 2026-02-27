/**
 * Admin: Store for you construct (a) image/banner, (b) style notes template, (c) product selection rules.
 */
import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler.js";
import * as storeForYouConstruct from "../../domain/storeForYouConstruct/storeForYouConstruct.js";

const router = Router();

router.get(
  "/store-for-you-construct",
  asyncHandler(async (req, res) => {
    const config = await storeForYouConstruct.getStoreForYouConstruct();
    res.json(config);
  })
);

router.put(
  "/store-for-you-construct",
  asyncHandler(async (req, res) => {
    const config = await storeForYouConstruct.updateStoreForYouConstruct(req.body || {});
    res.json(config);
  })
);

export default router;
