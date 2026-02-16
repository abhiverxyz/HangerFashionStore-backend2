/**
 * Seed Styling Avatars (3 personas) and default goals.
 * Run after migration: node scripts/seed-styling-avatars.js
 */

import { getPrisma } from "../src/core/db.js";

const AVATARS = [
  {
    slug: "warm_friendly",
    name: "Warm & Friendly",
    description: "Warm, friendly, engages in conversation",
    systemPromptAddition: "Be warm and friendly. Engage in conversation naturally. Show genuine interest in the user's style and needs.",
    sortOrder: 1,
    isDefault: true,
  },
  {
    slug: "efficient_encouraging",
    name: "Efficient & Encouraging",
    description: "To the point, efficient but encouraging",
    systemPromptAddition: "Be to the point and efficient. Keep responses focused while staying encouraging and supportive.",
    sortOrder: 2,
    isDefault: false,
  },
  {
    slug: "fun_entertaining",
    name: "Fun & Entertaining",
    description: "Very helpful, chatty, digresses a bit, fun and entertaining",
    systemPromptAddition: "Be very helpful, chatty, and fun. It's okay to digress a little to entertain. Keep the user engaged and amused.",
    sortOrder: 3,
    isDefault: false,
  },
];

const DEFAULT_GOALS = `Your goals: (1) Solve the user's styling intent and questions. (2) Engage and entertain in conversation. (3) Help them learn and discover something about their fashion and themselves.`;

async function main() {
  const prisma = getPrisma();

  for (const a of AVATARS) {
    const existing = await prisma.stylingAvatar.findUnique({ where: { slug: a.slug } });
    if (existing) {
      await prisma.stylingAvatar.update({
        where: { id: existing.id },
        data: {
          name: a.name,
          description: a.description,
          systemPromptAddition: a.systemPromptAddition,
          sortOrder: a.sortOrder,
          isDefault: a.isDefault,
        },
      });
      console.log("Updated avatar:", a.slug);
    } else {
      if (a.isDefault) {
        await prisma.stylingAvatar.updateMany({ data: { isDefault: false } });
      }
      await prisma.stylingAvatar.create({
        data: {
          slug: a.slug,
          name: a.name,
          description: a.description,
          systemPromptAddition: a.systemPromptAddition,
          sortOrder: a.sortOrder,
          isDefault: a.isDefault,
        },
      });
      console.log("Created avatar:", a.slug);
    }
  }

  const goalsExisting = await prisma.stylingAgentPlaybook.findFirst({ where: { type: "goals" } });
  if (goalsExisting) {
    await prisma.stylingAgentPlaybook.update({
      where: { id: goalsExisting.id },
      data: { content: DEFAULT_GOALS },
    });
    console.log("Updated goals");
  } else {
    await prisma.stylingAgentPlaybook.create({
      data: { type: "goals", content: DEFAULT_GOALS, sortOrder: 0, isActive: true },
    });
    console.log("Created goals");
  }

  // Suggested flow for "what should I wear for office"
  const flowContent = 'When user asks "what should I wear for [occasion]?" or "outfit for [X]", use intent: suggest_look, set occasion (and vibe if clear), and lookDisplayPreference: auto (or on_model). Do not use suggest_items for these discovery-style questions.';
  const flowExisting = await prisma.stylingAgentPlaybook.findFirst({
    where: { type: "example_flow", content: flowContent },
  });
  if (!flowExisting) {
    await prisma.stylingAgentPlaybook.create({
      data: { type: "example_flow", content: flowContent, sortOrder: 10, isActive: true },
    });
    console.log("Created example flow: what should I wear");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
