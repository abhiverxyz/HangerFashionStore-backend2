/**
 * Styling Agent improvement loop: load avatars, playbook (goals + instructions/examples), and default avatar.
 * Used by Styling Agent to build context and by admin API for CRUD.
 */

import { getPrisma } from "../../core/db.js";

const DEFAULT_GOALS_TEXT = `Your goals: (1) Solve the user's styling intent and questions. (2) Engage and entertain in conversation. (3) Help them learn and discover something about their fashion and themselves.`;

/**
 * List all avatars, ordered by sortOrder then name.
 */
export async function listAvatars() {
  const prisma = getPrisma();
  return prisma.stylingAvatar.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * Get the default avatar (isDefault true). If none, return first by sortOrder.
 */
export async function getDefaultAvatar() {
  const prisma = getPrisma();
  let avatar = await prisma.stylingAvatar.findFirst({
    where: { isDefault: true },
  });
  if (!avatar) {
    avatar = await prisma.stylingAvatar.findFirst({
      orderBy: { sortOrder: "asc" },
    });
  }
  return avatar;
}

/**
 * Get avatar by id or slug.
 */
export async function getAvatarByIdOrSlug(idOrSlug) {
  const prisma = getPrisma();
  if (!idOrSlug || typeof idOrSlug !== "string") return null;
  const slug = idOrSlug.trim();
  return prisma.stylingAvatar.findFirst({
    where: { OR: [{ id: slug }, { slug }] },
  });
}

/**
 * Create or update avatar. If isDefault true, unset isDefault on others.
 * When id or slug matches existing, update; otherwise create.
 */
export async function upsertAvatar(data) {
  const prisma = getPrisma();
  const { id, name, slug, description, systemPromptAddition, sortOrder, isDefault } = data;
  const idOrSlug = id || slug;
  const existing = idOrSlug ? await getAvatarByIdOrSlug(idOrSlug) : null;
  if (isDefault) {
    await prisma.stylingAvatar.updateMany({ data: { isDefault: false } });
  }
  const payload = {
    name: String(name ?? existing?.name ?? ""),
    slug: String(slug ?? existing?.slug ?? ""),
    description: description !== undefined ? (description == null ? null : String(description)) : existing?.description ?? null,
    systemPromptAddition: String(systemPromptAddition ?? existing?.systemPromptAddition ?? ""),
    sortOrder: Number(sortOrder ?? existing?.sortOrder ?? 0),
    isDefault: Boolean(isDefault ?? existing?.isDefault ?? false),
  };
  if (existing) {
    return prisma.stylingAvatar.update({ where: { id: existing.id }, data: payload });
  }
  return prisma.stylingAvatar.create({
    data: payload,
  });
}

/**
 * Set default avatar by id or slug.
 */
export async function setDefaultAvatar(idOrSlug) {
  const prisma = getPrisma();
  await prisma.stylingAvatar.updateMany({ data: { isDefault: false } });
  const avatar = await getAvatarByIdOrSlug(idOrSlug);
  if (!avatar) throw new Error("Avatar not found");
  return prisma.stylingAvatar.update({
    where: { id: avatar.id },
    data: { isDefault: true },
  });
}

/**
 * List playbook entries by type and/or active. Ordered by sortOrder.
 */
export async function listPlaybook(opts = {}) {
  const prisma = getPrisma();
  const where = {};
  if (opts.type) where.type = opts.type;
  if (opts.isActive !== undefined) where.isActive = opts.isActive;
  return prisma.stylingAgentPlaybook.findMany({
    where,
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Get the single "goals" playbook entry content. If none, return default text.
 */
export async function getGoalsContent() {
  const prisma = getPrisma();
  const row = await prisma.stylingAgentPlaybook.findFirst({
    where: { type: "goals", isActive: true },
  });
  return row ? row.content : DEFAULT_GOALS_TEXT;
}

/**
 * Upsert goals playbook entry (single row for type "goals").
 */
export async function setGoalsContent(content) {
  const prisma = getPrisma();
  const existing = await prisma.stylingAgentPlaybook.findFirst({
    where: { type: "goals" },
  });
  const text = content != null ? String(content) : DEFAULT_GOALS_TEXT;
  if (existing) {
    return prisma.stylingAgentPlaybook.update({
      where: { id: existing.id },
      data: { content: text },
    });
  }
  return prisma.stylingAgentPlaybook.create({
    data: { type: "goals", content: text, sortOrder: 0, isActive: true },
  });
}

/**
 * Add or update playbook entry (instruction or example_flow).
 */
export async function upsertPlaybookEntry(data) {
  const prisma = getPrisma();
  const { id, type, content, sortOrder, isActive } = data;
  if (type === "goals") {
    return setGoalsContent(content);
  }
  const payload = {
    type: String(type),
    content: String(content || ""),
    sortOrder: Number(sortOrder) ?? 0,
    isActive: isActive !== undefined ? Boolean(isActive) : true,
  };
  if (id) {
    return prisma.stylingAgentPlaybook.upsert({
      where: { id },
      create: payload,
      update: payload,
    });
  }
  return prisma.stylingAgentPlaybook.create({ data: payload });
}

/**
 * Delete playbook entry by id.
 */
export async function deletePlaybookEntry(id) {
  const prisma = getPrisma();
  return prisma.stylingAgentPlaybook.delete({ where: { id } }).catch(() => null);
}

/**
 * Build the full context block for the Styling Agent: goals + default avatar tone + active playbook instructions/examples.
 */
export async function buildStylingAgentContext() {
  const [goals, avatar, playbookEntries] = await Promise.all([
    getGoalsContent(),
    getDefaultAvatar(),
    listPlaybook({ isActive: true }),
  ]);

  const instructionEntries = playbookEntries.filter(
    (e) => e.type === "instruction" || e.type === "example_flow"
  );

  const parts = [];
  parts.push(goals);
  if (avatar?.systemPromptAddition) {
    parts.push(`Tone and style: ${avatar.systemPromptAddition}`);
  }
  if (instructionEntries.length > 0) {
    parts.push(
      "Suggested flows and guidelines (follow when applicable):\n" +
        instructionEntries.map((e) => e.content).join("\n\n")
    );
  }
  return parts.join("\n\n");
}
