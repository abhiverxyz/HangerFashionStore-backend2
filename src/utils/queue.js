import Redis from "ioredis";

const PREFIX = "backend2";
const KEYS = {
  ENRICH_QUEUE: `${PREFIX}:enrichment:queue`,
  ENRICH_PROCESSING: `${PREFIX}:enrichment:processing`,
  ENRICH_FAILED: `${PREFIX}:enrichment:failed`,
  ENRICH_RESULTS: `${PREFIX}:enrichment:results`,
  ENRICH_ATTEMPTS: `${PREFIX}:enrichment:attempts`,
  SYNC_QUEUE: `${PREFIX}:sync:queue`,
  SYNC_PROCESSING: `${PREFIX}:sync:processing`,
};
const MAX_ATTEMPTS = Number(process.env.ENRICHMENT_MAX_ATTEMPTS || "3");
const PROCESSING_TTL = 300;

let redisClient = null;

export function getRedisClient() {
  if (!redisClient) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    redisClient = new Redis(url, {
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    });
    redisClient.on("error", (err) => {
      const msg = err?.message || err?.code || String(err);
      console.error("[QUEUE] Redis error:", msg || "connection failed (is Redis running?)");
    });
    redisClient.on("connect", () => console.log("[QUEUE] Redis connected"));
  }
  return redisClient;
}

// --- Enrichment queue (sorted set: score = priority, member = productId) ---

export async function enqueueEnrichment(productId, priority = 100) {
  const id = String(productId);
  if (!id || id === "undefined" || id === "null") throw new Error(`Invalid productId: ${productId}`);
  const redis = getRedisClient();
  await Promise.all([
    redis.hdel(KEYS.ENRICH_FAILED, id),
    redis.srem(KEYS.ENRICH_PROCESSING, id),
  ]);
  await redis.zadd(KEYS.ENRICH_QUEUE, priority, id);
  await redis.hset(KEYS.ENRICH_ATTEMPTS, id, "0");
  return id;
}

export async function getNextEnrichmentJob() {
  const redis = getRedisClient();
  const result = await redis.zpopmin(KEYS.ENRICH_QUEUE, 1);
  if (!result?.length) return null;
  return String(result[0]);
}

export async function markEnrichmentProcessing(productId) {
  const redis = getRedisClient();
  await redis.sadd(KEYS.ENRICH_PROCESSING, productId);
  await redis.expire(KEYS.ENRICH_PROCESSING, PROCESSING_TTL);
  return await redis.hincrby(KEYS.ENRICH_ATTEMPTS, productId, 1);
}

export async function markEnrichmentCompleted(productId) {
  const redis = getRedisClient();
  await redis.srem(KEYS.ENRICH_PROCESSING, productId);
  await redis.hset(KEYS.ENRICH_RESULTS, productId, Date.now().toString());
  await redis.hdel(KEYS.ENRICH_ATTEMPTS, productId);
}

export async function markEnrichmentFailed(productId, error) {
  const redis = getRedisClient();
  await redis.srem(KEYS.ENRICH_PROCESSING, productId);
  const attemptsStr = await redis.hget(KEYS.ENRICH_ATTEMPTS, productId);
  const attempts = parseInt(attemptsStr || "0", 10);
  await redis.hset(KEYS.ENRICH_FAILED, productId, JSON.stringify({ error, attempts, failedAt: Date.now() }));
  if (attempts >= MAX_ATTEMPTS) await redis.hdel(KEYS.ENRICH_ATTEMPTS, productId);
  return attempts < MAX_ATTEMPTS;
}

export async function getEnrichmentJobStatus(productId) {
  const redis = getRedisClient();
  const score = await redis.zscore(KEYS.ENRICH_QUEUE, productId);
  if (score != null) return { status: "pending", priority: parseFloat(score) };
  if (await redis.sismember(KEYS.ENRICH_PROCESSING, productId)) {
    const a = await redis.hget(KEYS.ENRICH_ATTEMPTS, productId);
    return { status: "processing", attempts: parseInt(a || "0", 10) };
  }
  const completed = await redis.hget(KEYS.ENRICH_RESULTS, productId);
  if (completed) return { status: "completed", completedAt: parseInt(completed, 10) };
  const failedStr = await redis.hget(KEYS.ENRICH_FAILED, productId);
  if (failedStr) {
    const d = JSON.parse(failedStr);
    return { status: "failed", error: d.error, attempts: d.attempts, failedAt: d.failedAt };
  }
  return { status: "unknown" };
}

export async function getEnrichmentQueueStats() {
  const redis = getRedisClient();
  try {
    const [pending, processing, failed, completed] = await Promise.all([
      redis.zcard(KEYS.ENRICH_QUEUE),
      redis.scard(KEYS.ENRICH_PROCESSING),
      redis.hlen(KEYS.ENRICH_FAILED),
      redis.hlen(KEYS.ENRICH_RESULTS),
    ]);
    return { pending, processing, failed, completed };
  } catch (e) {
    return { pending: 0, processing: 0, failed: 0, completed: 0 };
  }
}

// --- Sync queue (list of JSON jobs: { brandId, accessToken }) ---

export async function enqueueSyncShopify(brandId, accessToken) {
  const payload = JSON.stringify({ brandId: String(brandId), accessToken: String(accessToken) });
  const redis = getRedisClient();
  await redis.rpush(KEYS.SYNC_QUEUE, payload);
  return brandId;
}

export async function getNextSyncJob() {
  const redis = getRedisClient();
  const payload = await redis.lpop(KEYS.SYNC_QUEUE);
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

// --- Unified job API for worker ---

/**
 * Get next job: enrichment first, then sync. Returns { type: 'enrich-product' | 'sync-shopify', payload } or null.
 */
export async function getNextJob() {
  const productId = await getNextEnrichmentJob();
  if (productId) return { type: "enrich-product", payload: { productId } };
  const syncPayload = await getNextSyncJob();
  if (syncPayload) return { type: "sync-shopify", payload: syncPayload };
  return null;
}
