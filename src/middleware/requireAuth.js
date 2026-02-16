import { getBearerToken } from "../core/getBearerToken.js";
import { verifyToken, getUser } from "../domain/user/auth.js";

/**
 * Optional auth: set req.userId and req.user if Bearer token is valid. Never 401.
 */
export function optionalAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return next();
  const payload = verifyToken(token);
  if (!payload?.userId) return next();
  req.userId = payload.userId;
  getUser(payload.userId).then((user) => {
    req.user = user || undefined;
    next();
  }).catch(() => next());
}

/**
 * Require auth: 401 if no valid Bearer token; otherwise set req.userId and req.user.
 */
export function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Authorization required" });
  const payload = verifyToken(token);
  if (!payload?.userId) return res.status(401).json({ error: "Invalid or expired token" });
  req.userId = payload.userId;
  getUser(payload.userId).then((user) => {
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    next();
  }).catch((err) => {
    console.error("[requireAuth]", err);
    res.status(500).json({ error: "Auth check failed" });
  });
}
