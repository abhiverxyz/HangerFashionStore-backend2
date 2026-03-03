/**
 * Storage utility — B0.4
 * Shared utility for all agents and services: upload buffer → URL (R2 or local).
 * uploadFile(buffer, key, contentType) → { url, key, hash, size }
 * Note: For R2, the bucket (or custom domain) must be configured for public read
 * for the returned URL to be usable by clients.
 */

import { createHash } from "crypto";
import { createReadStream } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { existsSync } from "fs";

const R2_ENABLED = process.env.R2_ENABLED === "true";
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL =
  process.env.R2_PUBLIC_URL ||
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}` : null);

const STORAGE_PATH = process.env.STORAGE_PATH || join(process.cwd(), "public", "uploads");

let r2Client = null;
let awsSdkLoaded = false;

async function getR2Client() {
  if (!R2_ENABLED || !R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return null;
  }
  if (r2Client) return r2Client;
  if (!awsSdkLoaded) {
    try {
      const { S3Client } = await import("@aws-sdk/client-s3");
      r2Client = new S3Client({
        region: "auto",
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY_ID,
          secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
      });
      awsSdkLoaded = true;
      return r2Client;
    } catch (e) {
      console.warn("[Storage] AWS SDK not available, using local:", e.message);
      return null;
    }
  }
  return r2Client;
}

/**
 * Return current storage config (for admin diagnostics).
 * @returns {Promise<{ r2Enabled: boolean, r2Available: boolean }>}
 */
export async function getStorageStatus() {
  const client = await getR2Client();
  return {
    r2Enabled: R2_ENABLED,
    r2Available: !!(R2_ENABLED && client),
  };
}

/** Base URL used for R2 objects (API endpoint; not necessarily public-read). Used to detect R2 URLs in verify. */
export function getR2PublicBaseUrl() {
  return R2_PUBLIC_URL || null;
}

/**
 * Extract storage key from a stored URL (our R2 or /uploads/).
 * @param {string} url - Stored imageUrl (R2 full URL or /uploads/key)
 * @returns {string|null} - Storage key or null if not our storage
 */
export function urlToStorageKey(url) {
  if (!url || typeof url !== "string") return null;
  const u = url.trim();
  if (!u) return null;
  if (R2_PUBLIC_URL) {
    const base = R2_PUBLIC_URL.replace(/\/$/, "");
    if (u === base || u.startsWith(base + "/")) {
      return u.slice(base.length).replace(/^\//, "") || null;
    }
  }
  if (u.startsWith("/uploads/")) {
    return u.slice("/uploads/".length) || null;
  }
  return null;
}

/**
 * Get a short-lived presigned GET URL for R2 (for browser or external services).
 * For local storage returns null; caller should use /uploads/key.
 * @param {string} key - Storage key
 * @param {number} [expiresIn=3600] - Seconds until expiry (default 1 hour)
 * @returns {Promise<string|null>} - Presigned URL or null if local/R2 unavailable
 */
export async function getPresignedGetUrl(key, expiresIn = 3600) {
  if (!key || typeof key !== "string") return null;
  const client = await getR2Client();
  if (!R2_ENABLED || !client) return null;
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const signed = await getSignedUrl(client, new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    }), { expiresIn });
    return signed;
  } catch (e) {
    console.warn("[Storage] getPresignedGetUrl failed:", e?.message);
    return null;
  }
}

/**
 * Resolve an image URL for use by external services (e.g. OpenAI vision).
 * If the URL is our storage (R2 or /uploads), returns a presigned URL (R2) or same URL (local).
 * @param {string} imageUrl - Stored or external URL
 * @returns {Promise<string>} - URL that can be fetched by external services
 */
export async function resolveImageUrlForExternal(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return imageUrl || "";
  const key = urlToStorageKey(imageUrl);
  if (!key) return imageUrl;
  const presigned = await getPresignedGetUrl(key);
  if (presigned) return presigned;
  return imageUrl;
}

/**
 * Fetch a URL to a Buffer (for server-side cropping). Uses global fetch.
 * @param {string} url - Public or presigned image URL
 * @returns {Promise<Buffer>}
 */
export async function fetchUrlToBuffer(url) {
  if (!url || typeof url !== "string") throw new Error("url is required");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Check if an object exists in R2 and get its metadata (for verify without public read).
 * @param {string} key - Object key
 * @returns {Promise<{ exists: boolean, contentType?: string }>}
 */
export async function headR2Object(key) {
  const client = await getR2Client();
  if (!R2_ENABLED || !client || !key) return { exists: false };
  try {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const out = await client.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
    );
    return {
      exists: true,
      contentType: out.ContentType || undefined,
    };
  } catch (e) {
    return { exists: false };
  }
}

/**
 * Get object body from R2 (for admin proxy so preview works when bucket is not public).
 * @param {string} key - Object key
 * @returns {Promise<{ body: import('stream').Readable, contentType: string } | null>}
 */
export async function getR2Object(key) {
  const client = await getR2Client();
  if (!R2_ENABLED || !client || !key) return null;
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const out = await client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
    );
    return {
      body: out.Body,
      contentType: out.ContentType || "application/octet-stream",
    };
  } catch (e) {
    return null;
  }
}

const EXT_TO_MIME = {
  jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};

/**
 * Get object from local storage by key (for admin proxy).
 * @param {string} key - Object key
 * @returns {{ body: import('stream').Readable, contentType: string } | null}
 */
export function getLocalObject(key) {
  if (!key) return null;
  const localPath = join(STORAGE_PATH, key);
  if (!existsSync(localPath)) return null;
  const ext = key.split(".").pop()?.toLowerCase() || "";
  const contentType = EXT_TO_MIME[ext] || "application/octet-stream";
  return {
    body: createReadStream(localPath),
    contentType,
  };
}

/**
 * Get object from storage (R2 or local) by key. For admin proxy.
 * @param {string} key - Object key
 * @returns {Promise<{ body: import('stream').Readable, contentType: string } | null>}
 */
export async function getStorageObject(key) {
  const r2 = await getR2Object(key);
  if (r2) return r2;
  return getLocalObject(key);
}

/**
 * Read a stored image into a Buffer (for vision/analysis so external APIs never need to fetch our R2 URL).
 * @param {string} imageUrl - Our storage URL (R2 or /uploads/key)
 * @returns {Promise<Buffer|null>} - Image buffer or null if not our storage / read failed
 */
export async function getStoredImageAsBuffer(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return null;
  const key = urlToStorageKey(imageUrl.trim());
  if (!key) return null;
  const r2 = await getR2Object(key);
  if (r2?.body) {
    const chunks = [];
    for await (const chunk of r2.body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  const local = getLocalObject(key);
  if (local?.body) {
    const chunks = [];
    for await (const chunk of local.body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  return null;
}

function normalizeExtension(filename, contentType) {
  if (contentType) {
    const mimeToExt = {
      "image/jpeg": "jpeg",
      "image/jpg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
      "video/x-msvideo": "avi",
    };
    const n = mimeToExt[contentType.toLowerCase()];
    if (n) return `.${n}`;
  }
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const extMap = {
    jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", gif: "gif",
    mp4: "mp4", webm: "webm", mov: "mov", avi: "avi",
  };
  return extMap[ext] ? `.${extMap[ext]}` : ext ? `.${ext}` : "";
}

function computeHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * @param {Buffer} buffer
 * @param {string} key - e.g. "looks/{uuid}.jpeg" or "wardrobe/{userId}/{hash}.png"
 * @param {string} contentType
 * @param {{ requireRemote?: boolean }} options - if requireRemote true, throw when R2 is unavailable (no local fallback)
 * @returns {Promise<{ url: string, key: string, hash: string, size: number }>}
 */
export async function uploadFile(buffer, key, contentType, options = {}) {
  const hash = computeHash(buffer);
  const size = buffer.length;
  const ext = normalizeExtension(key, contentType);
  let finalKey = key.includes("{hash}") ? key.replace(/\{hash\}/g, hash) + ext : key;
  if (!finalKey.includes(".")) finalKey = finalKey + ext;

  const client = await getR2Client();
  if (R2_ENABLED && client) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: finalKey,
        Body: buffer,
        ContentType: contentType,
        Metadata: { "x-content-hash": hash },
      })
    );
    const url = `${R2_PUBLIC_URL}/${finalKey}`;
    return { url, key: finalKey, hash, size };
  }

  if (options.requireRemote) {
    throw new Error(
      "Image storage requires R2. Set R2_ENABLED=true and R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME in .env"
    );
  }

  const localPath = join(STORAGE_PATH, finalKey);
  const localDir = dirname(localPath);
  if (!existsSync(localDir)) await mkdir(localDir, { recursive: true });
  await writeFile(localPath, buffer);
  const url = `/uploads/${finalKey}`;
  return { url, key: finalKey, hash, size };
}
