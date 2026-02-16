import { getBearerToken } from "../core/getBearerToken.js";
import { verifyToken, getUser } from "../domain/user/auth.js";

/**
 * Require valid JWT with role === 'admin'. Sets req.user; else 401 or 403.
 */
export function requireAdmin(req, res, next) {
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
      if (user.role !== "admin") return res.status(403).json({ error: "Admin only" });
      req.user = user;
      next();
    })
    .catch((err) => {
      console.error("[requireAdmin]", err);
      res.status(500).json({ error: "Auth check failed" });
    });
}
