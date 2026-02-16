import { requireAdmin } from "./requireAdmin.js";

/**
 * For import endpoints only: allow either Bearer JWT (requireAdmin) or
 * X-Admin-Secret header / query param ?secret= when ADMIN_SECRET is set.
 * Use so the CLI script can auth without a JWT.
 */
export function requireAdminOrSecret(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (secret) {
    const headerSecret = req.headers["x-admin-secret"];
    const querySecret = req.query && req.query.secret;
    if (headerSecret === secret || querySecret === secret) {
      req.user = { id: "script", role: "admin" };
      return next();
    }
  }
  return requireAdmin(req, res, next);
}
