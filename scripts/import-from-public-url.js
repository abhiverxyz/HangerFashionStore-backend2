#!/usr/bin/env node

/**
 * Import products from a Shopify store's public products.json and send to backend2.
 * Fetches the store in Node (no CORS; uses this machine's DNS) then POSTs to
 * /api/admin/import-public-payload. Use when the UI fails (e.g. store CORS or server DNS).
 *
 * Usage:
 *   node scripts/import-from-public-url.js <store-url> [brand-name]
 *
 * Examples:
 *   node scripts/import-from-public-url.js https://thejulymuse.in
 *   node scripts/import-from-public-url.js https://thejulymuse.in "The July Muse"
 *
 * Environment:
 *   - API_BASE_URL or NEXT_PUBLIC_API_BASE_URL (default: http://localhost:3002)
 *   - ADMIN_SECRET: optional; send as X-Admin-Secret header (set same in backend2 .env)
 *   - ADMIN_TOKEN: optional; JWT from login, send as Authorization: Bearer <token>
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve hostname via DNS-over-HTTPS (bypasses broken system DNS). Returns first A record IP or null. */
async function resolveWithDoH(hostname) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
  const res = await fetch(url, { headers: { Accept: "application/dns-json" } });
  if (!res.ok) return null;
  const data = await res.json();
  const answer = data?.Answer?.find((a) => a.type === 1 && a.data);
  return answer ? answer.data : null;
}

/** Fetch JSON from a URL using a pre-resolved IP (for when system DNS fails but DoH works). */
function fetchJsonOverHttps(hostname, ip, path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: ip,
        path,
        port: 443,
        servername: hostname,
        headers: {
          Host: hostname,
          "User-Agent": "Mozilla/5.0 (compatible; HangerImport/1.0)",
          Accept: "application/json",
        },
        rejectUnauthorized: true,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }
        let body = "";
        res.on("data", (ch) => (body += ch));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("Request timeout"));
    });
  });
}

const envPath = join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  try {
    const dotenv = await import("dotenv");
    dotenv.config({ path: envPath });
  } catch (_) {}
}

const websiteUrl = process.argv[2];
const brandName = process.argv[3];

if (!websiteUrl) {
  console.error("❌ Error: Store URL is required");
  console.error("");
  console.error("Usage: node scripts/import-from-public-url.js <store-url> [brand-name]");
  console.error("Example: node scripts/import-from-public-url.js https://thejulymuse.in \"The July Muse\"");
  process.exit(1);
}

let baseUrl = websiteUrl.trim().replace(/\/+$/, "");
if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
  baseUrl = `https://${baseUrl}`;
}

const API_BASE_URL = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3002";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

/** Fetch all products from store's products.json. Uses DoH if system DNS fails (ENOTFOUND). */
async function fetchProductsFromStore(base) {
  const urlObj = new URL(base);
  const hostname = urlObj.hostname;
  const all = [];
  let page = 1;
  let useDoH = false;
  let dohIp = null;

  const fetchOnePage = async (pageNum) => {
    const path = `/products.json?page=${pageNum}&limit=250`;
    if (useDoH && dohIp) {
      return fetchJsonOverHttps(hostname, dohIp, path);
    }
    const url = `${base}${path}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HangerImport/1.0)",
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  };

  for (;;) {
    try {
      const data = await fetchOnePage(page);
      const products = data?.products && Array.isArray(data.products) ? data.products : [];
      all.push(...products);
      if (products.length < 250) break;
      page++;
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      const isDns = err.cause?.code === "ENOTFOUND" || err.code === "ENOTFOUND" || err.cause?.syscall === "getaddrinfo";
      if (page === 1 && isDns && !useDoH) {
        const ip = await resolveWithDoH(hostname);
        if (ip) {
          console.log("   (Using DNS-over-HTTPS to resolve " + hostname + " → " + ip + ")");
          useDoH = true;
          dohIp = ip;
          continue;
        }
      }
      if (page === 1) throw err;
      break;
    }
  }
  return all;
}

console.log("🚀 Importing products from Shopify store...");
console.log(`   Store: ${baseUrl}`);
console.log(`   API: ${API_BASE_URL}`);
console.log("");

try {
  console.log("   Fetching products from store...");
  const products = await fetchProductsFromStore(baseUrl);
  if (products.length === 0) {
    console.error("❌ No products found at", baseUrl + "/products.json");
    process.exit(1);
  }
  console.log(`   Fetched ${products.length} products. Sending to API...`);

  const payloadUrl = `${API_BASE_URL}/api/admin/import-public-payload`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (ADMIN_SECRET) {
    headers["X-Admin-Secret"] = ADMIN_SECRET;
  } else if (ADMIN_TOKEN) {
    headers["Authorization"] = `Bearer ${ADMIN_TOKEN}`;
  }

  const res = await fetch(payloadUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      url: baseUrl,
      brandName: brandName ? brandName.trim() : undefined,
      products,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const msg = (err && err.error) || res.statusText;
    console.error(`❌ API error (${res.status}):`, msg);
    if (res.status === 401) {
      console.error("");
      console.error("   Auth failed. Add ADMIN_SECRET=yourSecret to backend2/.env, restart backend2, then run this script again from the backend2 directory.");
    }
    process.exit(1);
  }

  const data = await res.json();
  if (data.success) {
    console.log("✅ Import completed successfully!");
    console.log("");
    console.log("📊 Summary:");
    console.log(`   - Total: ${data.summary.total}`);
    console.log(`   - New: ${data.summary.newProducts}`);
    console.log(`   - Updated: ${data.summary.updatedProducts}`);
    console.log(`   - Errors: ${data.summary.errors}`);
    console.log(`   - Enqueued for enrichment: ${data.summary.enqueuedForEnrichment}`);
    console.log("");
    console.log("🏷️  Brand:", data.brand.name, `(${data.brand.shopDomain})`);
    console.log(`   Total products in DB: ${data.brand.totalProducts}`);
  } else {
    console.error("❌ Import failed:", data.error || data.message);
    process.exit(1);
  }
} catch (err) {
  console.error("❌ Error:", err.message);
  const cause = err.cause || err;
  if (cause.message && cause.message !== err.message) console.error("   Cause:", cause.message);
  const isDns = cause.code === "ENOTFOUND" || cause.syscall === "getaddrinfo";
  console.error("");
  if (isDns) {
    console.error("This machine cannot resolve the store hostname (DNS/network). Try:");
    console.error("  1. Check internet: ping thejulymuse.in or open https://thejulymuse.in in a browser");
    console.error("  2. Try another network or DNS (e.g. 8.8.8.8)");
    console.error("  3. Run this script from a server that can reach the store (e.g. cloud)");
  } else {
    console.error("Troubleshooting:");
    console.error("  1. Ensure backend2 is running (e.g. npm run dev in backend2)");
    console.error("  2. Set API_BASE_URL if backend is not at http://localhost:3002");
    console.error("  3. Set ADMIN_SECRET in backend2 .env and same value when running this script");
    console.error("     (or use ADMIN_TOKEN with a JWT from admin login)");
  }
  process.exit(1);
}
