import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { getBearerToken } from "../core/getBearerToken.js";
import { validateLogin, getUser, createToken, verifyToken } from "../domain/user/auth.js";

const router = Router();

/** POST /api/auth/login - body: { email, password } */
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    const user = await validateLogin(email, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = createToken({
      userId: user.id,
      role: user.role,
      brandId: user.brandId,
    });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, brandId: user.brandId } });
  })
);

/** GET /api/auth/session - Authorization: Bearer <token> */
router.get(
  "/session",
  asyncHandler(async (req, res) => {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "No token" });
    const payload = verifyToken(token);
    if (!payload?.userId) return res.status(401).json({ error: "Invalid token" });
    const user = await getUser(payload.userId);
    if (!user) return res.status(401).json({ error: "User not found" });
    res.json({ user });
  })
);

export default router;
