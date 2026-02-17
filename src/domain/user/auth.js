import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";
import { IS_PRODUCTION } from "../../core/constants.js";

const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (IS_PRODUCTION && !secret) {
    throw new Error("JWT_SECRET is required in production");
  }
  return secret || "dev-secret-change-in-production";
})();

/**
 * Validate login by username (brand) or email (admin/user).
 * @param {string} identifier - Username (brand) or email (admin/user)
 * @param {string} password
 * @returns {Promise<{ id, email?, username?, role, brandId? } | null>}
 */
export async function validateLogin(identifier, password) {
  const prisma = getPrisma();
  const raw = (identifier || "").trim();
  if (!raw || !password) return null;

  let user;
  if (raw.includes("@")) {
    user = await prisma.user.findUnique({
      where: { email: raw.toLowerCase() },
      include: { brandAdmins: { select: { brandId: true } } },
    });
  } else {
    user = await prisma.user.findFirst({
      where: { username: raw },
      include: { brandAdmins: { select: { brandId: true } } },
    });
  }
  if (!user || !user.passwordHash || !user.isActive) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  const role = (user.role || "user").toLowerCase();
  let brandId = null;
  if (role === "brand" && user.brandAdmins?.length) brandId = user.brandAdmins[0].brandId;

  return {
    id: user.id,
    email: user.email ?? undefined,
    username: user.username ?? undefined,
    role,
    brandId: brandId || undefined,
  };
}

/**
 * Get user by id (safe fields only).
 */
export async function getUser(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: nid },
    include: { brandAdmins: { select: { brandId: true } } },
  });
  if (!user || !user.isActive) return null;
  const role = (user.role || "user").toLowerCase();
  let brandId = null;
  if (role === "brand" && user.brandAdmins?.length) brandId = user.brandAdmins[0].brandId;
  return {
    id: user.id,
    email: user.email ?? undefined,
    username: user.username ?? undefined,
    firstName: user.firstName,
    lastName: user.lastName,
    role,
    brandId: brandId || undefined,
  };
}

/**
 * Create JWT payload for session (userId, role, brandId).
 */
export function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

/**
 * Verify JWT and return payload or null.
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
