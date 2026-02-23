/**
 * One-off: get user profile by email (backend2 UserProfile + UserEvent history).
 * Usage: node scripts/get-profile-by-email.js <email>
 */
import { getPrisma } from "../src/core/db.js";
import { getUserProfile } from "../src/domain/userProfile/userProfile.js";

const email = process.argv[2] || "abhishekv04@gmail.com";

async function main() {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, lastName: true, createdAt: true },
  });
  if (!user) {
    console.log("User not found:", email);
    return;
  }
  console.log("User:", user);

  const profile = await getUserProfile(user.id, { recentEventsDays: 365, recentEventsLimit: 500 });
  console.log("\n--- Combined profile (style, history, need/motivation, quiz) ---");
  console.log(JSON.stringify(profile, null, 2));

  const eventCounts = await prisma.userEvent.groupBy({
    by: ["eventType"],
    where: { userId: user.id },
    _count: { id: true },
  });
  console.log("\n--- UserEvent counts by type ---");
  console.log(eventCounts);
}

main().catch((e) => { console.error(e); process.exit(1); });
