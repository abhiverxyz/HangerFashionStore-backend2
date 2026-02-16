/**
 * Storage utility — B0.4
 * Shared utility for all agents and services: upload buffer → URL (R2 or local).
 * uploadFile(buffer, key, contentType) → { url, key, hash, size }
 * Note: For R2, the bucket (or custom domain) must be configured for public read
 * for the returned URL to be usable by clients.
 */

import { createHash } from "crypto";
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

function normalizeExtension(filename, contentType) {
  if (contentType) {
    const mimeToExt = {
      "image/jpeg": "jpeg",
      "image/jpg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const n = mimeToExt[contentType.toLowerCase()];
    if (n) return `.${n}`;
  }
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const extMap = { jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", gif: "gif" };
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
