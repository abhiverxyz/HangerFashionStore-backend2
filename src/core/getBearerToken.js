/**
 * Extract Bearer token from request. Shared by auth middleware and auth routes.
 * @param {import('express').Request} req
 * @returns {string | null}
 */
export function getBearerToken(req) {
  const auth = req.headers.authorization;
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}
