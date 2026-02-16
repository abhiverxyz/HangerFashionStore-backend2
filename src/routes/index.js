import { Router } from "express";
import products from "./products.js";
import auth from "./auth.js";
import admin from "./admin.js";
import looks from "./looks.js";
import wardrobe from "./wardrobe.js";
import userImages from "./userImages.js";
import generate from "./generate.js";
import profile from "./profile.js";
import fashionContent from "./fashionContent.js";
import conversations from "./conversations.js";
import cron from "./cron.js";

const router = Router();
router.use("/products", products);
router.use("/auth", auth);
router.use("/admin", admin);
router.use("/looks", looks);
router.use("/wardrobe", wardrobe);
router.use("/user-images", userImages);
router.use("/generate", generate);
router.use("/profile", profile);
router.use("/fashion-content", fashionContent);
router.use("/conversations", conversations);
router.use("/cron", cron);

export default router;
