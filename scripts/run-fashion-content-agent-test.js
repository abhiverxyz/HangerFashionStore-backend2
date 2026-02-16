/**
 * One-off test: run the Fashion Content Agent and print the result.
 * Usage: node --env-file=.env scripts/run-fashion-content-agent-test.js
 */

import { runFashionContentAgent } from "../src/agents/fashionContentAgent.js";

async function main() {
  console.log("Running Fashion Content Agent...\n");
  const result = await runFashionContentAgent({ seed: "" });
  console.log("Result:");
  console.log("  trendsCreated:", result.trendsCreated);
  console.log("  trendsUpdated:", result.trendsUpdated);
  console.log("  droppedTrends:", result.droppedTrends);
  console.log("  rulesCreated:", result.rulesCreated);
  console.log("  rulesUpdated:", result.rulesUpdated);
  console.log("  droppedRules:", result.droppedRules);
  console.log("  trendsPruned:", result.trendsPruned);
  console.log("  rulesPruned:", result.rulesPruned);
  console.log("  webUrlsFetched:", result.webUrlsFetched?.length ?? 0, "URL(s)");
  if (result.webUrlsFetched?.length) {
    result.webUrlsFetched.slice(0, 3).forEach((u) => console.log("    -", u));
    if (result.webUrlsFetched.length > 3) console.log("    ...");
  }
  if (result.errors?.length) {
    console.log("  errors:", result.errors);
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
