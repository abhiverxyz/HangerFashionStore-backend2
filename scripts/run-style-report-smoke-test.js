/**
 * Smoke test: run Style Report Agent for a user and confirm report + profile
 * include comprehensive block when the LLM step succeeds.
 * Usage: node scripts/run-style-report-smoke-test.js <userId>
 * Or: USER_ID=xxx node scripts/run-style-report-smoke-test.js
 *
 * Requires backend2 .env (DATABASE_URL, LLM env vars). User must have at least
 * minLooks (default 1) in Look table.
 */

import { run as runStyleReportAgent } from "../src/agents/styleReportAgent.js";
import * as userProfile from "../src/domain/userProfile/userProfile.js";

const userId = process.argv[2] || process.env.USER_ID;

async function main() {
  if (!userId) {
    console.error("Usage: node scripts/run-style-report-smoke-test.js <userId>");
    console.error("   or: USER_ID=xxx node scripts/run-style-report-smoke-test.js");
    process.exit(1);
  }

  console.log("Running Style Report Agent for userId:", userId, "\n");
  const result = await runStyleReportAgent({ userId });

  if (result.notEnoughLooks) {
    console.log("OK (no run): not enough looks.", result.message);
    console.log("To test comprehensive, use a user with at least minLooks (see admin style-report settings).");
    return;
  }

  if (!result.reportData) {
    console.error("FAIL: expected reportData when not notEnoughLooks");
    process.exit(1);
  }

  const rd = result.reportData;
  if (rd.version == null || !rd.byLooks || !rd.byItems) {
    console.error("FAIL: reportData missing version, byLooks, or byItems");
    process.exit(1);
  }

  const hasComprehensive = rd.comprehensive && typeof rd.comprehensive === "object";
  if (hasComprehensive) {
    const c = rd.comprehensive;
    const hasSynthesis = c.synthesis && typeof c.synthesis === "object";
    const hasStyleDna = c.style_dna && typeof c.style_dna === "object";
    console.log("reportData.comprehensive: present");
    console.log("  meta.generated_from_looks:", c.meta?.generated_from_looks);
    console.log("  synthesis:", hasSynthesis ? "present" : "absent");
    console.log("  style_dna:", hasStyleDna ? "present" : "absent");
    if (!hasSynthesis && !hasStyleDna) {
      console.warn("WARN: comprehensive has neither synthesis nor style_dna (partial LLM output).");
    }
  } else {
    console.log("reportData.comprehensive: absent (LLM step may have failed or returned invalid JSON).");
  }

  const latest = await userProfile.getLatestStyleReport(userId);
  if (!latest?.reportData) {
    console.error("FAIL: getLatestStyleReport returned no reportData after run");
    process.exit(1);
  }
  if (hasComprehensive && !latest.reportData.comprehensive) {
    console.error("FAIL: stored latestStyleReportData missing comprehensive");
    process.exit(1);
  }

  const profile = await userProfile.getUserProfile(userId);
  const profileData = profile?.styleProfile?.data;
  if (hasComprehensive) {
    if (!profileData?.comprehensive) {
      console.error("FAIL: styleProfileData missing comprehensive after run");
      process.exit(1);
    }
    console.log("styleProfileData.comprehensive: present (stored).");
  }

  console.log("\nSmoke test passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
