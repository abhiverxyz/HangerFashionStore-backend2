#!/usr/bin/env node
/**
 * Phase 2 worker: processes enrich-product and sync-shopify jobs from Redis.
 * Run: node scripts/worker.js   (or npm run worker with REDIS_URL set)
 */
import "dotenv/config";
import {
  getNextJob,
  markEnrichmentProcessing,
  markEnrichmentCompleted,
  markEnrichmentFailed,
} from "../src/utils/queue.js";
import { enrichProduct } from "../src/domain/product/enrichment.js";
import { syncBrandFromShopify } from "../src/domain/product/sync.js";

const POLL_MS = 2000;

async function runOne() {
  const job = await getNextJob();
  if (!job) return false;

  if (job.type === "enrich-product") {
    const { productId } = job.payload;
    try {
      await markEnrichmentProcessing(productId);
      await enrichProduct(productId);
      await markEnrichmentCompleted(productId);
      console.log(`[worker] Enriched product ${productId}`);
    } catch (err) {
      const canRetry = await markEnrichmentFailed(productId, err.message);
      console.error(`[worker] Enrich failed ${productId}:`, err.message, canRetry ? "(will retry)" : "(max attempts)");
    }
    return true;
  }

  if (job.type === "sync-shopify") {
    const { brandId, accessToken } = job.payload;
    try {
      const result = await syncBrandFromShopify(brandId, accessToken);
      console.log(`[worker] Sync brand ${brandId}: synced=${result.synced} errors=${result.errors}`);
    } catch (err) {
      console.error(`[worker] Sync failed brand ${brandId}:`, err.message);
    }
    return true;
  }

  return false;
}

async function loop() {
  let cycle = 0;
  while (true) {
    try {
      const didWork = await runOne();
      if (!didWork) {
        cycle++;
        if (cycle % 30 === 0) console.log("[worker] Idle, waiting for jobs...");
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (err) {
      console.error("[worker] Error:", err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

loop();
