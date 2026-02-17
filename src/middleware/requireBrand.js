import { getBearerToken } from "../core/getBearerToken.js";
import { verifyToken, getUser } from "../domain/user/auth.js";

/**
 * Require valid JWT with role === 'admin' or role === 'brand'.
 * Sets req.user, req.userId; for brand users also sets req.brandId.
 * Otherwise 401 or 403.
 */
export function requireBrand(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "No token" });
  }
  const payload = verifyToken(token);
  if (!payload?.userId) {
    return res.status(401).json({ error: "Invalid token" });
  }
  getUser(payload.userId)
    .then((user) => {
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role !== "admin" && user.role !== "brand") {
        return res.status(403).json({ error: "Admin or brand only" });
      }
      req.user = user;
      req.userId = user.id;
      if (user.role === "brand" && user.brandId) req.brandId = user.brandId;
      next();
    })
    .catch((err) => {
      console.error("[requireBrand]", err);
      res.status(500).json({ error: "Auth check failed" });
    });
}
