import { getPrisma } from "../../core/db.js";

const SINGLETON_ID = "default";

/**
 * Get the Store for you construct (singleton). Creates row with defaults if missing.
 */
export async function getStoreForYouConstruct() {
  const prisma = getPrisma();
  let row = await prisma.storeForYouConstruct.findUnique({
    where: { id: SINGLETON_ID },
  });
  if (!row) {
    row = await prisma.storeForYouConstruct.create({
      data: {
        id: SINGLETON_ID,
        startingImageUrl: null,
        bannerImageUrl: null,
        styleNotesTemplate: null,
        productSelectionRules: null,
      },
    });
  }
  return {
    id: row.id,
    startingImageUrl: row.startingImageUrl ?? null,
    bannerImageUrl: row.bannerImageUrl ?? null,
    styleNotesTemplate: row.styleNotesTemplate ?? null,
    productSelectionRules: row.productSelectionRules ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Update the Store for you construct. Partial update; only provided fields are changed.
 */
export async function updateStoreForYouConstruct(data) {
  const prisma = getPrisma();
  const { startingImageUrl, bannerImageUrl, styleNotesTemplate, productSelectionRules } = data;
  const update = { updatedAt: new Date() };
  if (startingImageUrl !== undefined) update.startingImageUrl = startingImageUrl === "" ? null : startingImageUrl;
  if (bannerImageUrl !== undefined) update.bannerImageUrl = bannerImageUrl === "" ? null : bannerImageUrl;
  if (styleNotesTemplate !== undefined) update.styleNotesTemplate = styleNotesTemplate === "" ? null : styleNotesTemplate;
  if (productSelectionRules !== undefined) update.productSelectionRules = productSelectionRules === "" ? null : productSelectionRules;

  const row = await prisma.storeForYouConstruct.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      startingImageUrl: update.startingImageUrl ?? null,
      bannerImageUrl: update.bannerImageUrl ?? null,
      styleNotesTemplate: update.styleNotesTemplate ?? null,
      productSelectionRules: update.productSelectionRules ?? null,
    },
    update,
  });
  return {
    id: row.id,
    startingImageUrl: row.startingImageUrl ?? null,
    bannerImageUrl: row.bannerImageUrl ?? null,
    styleNotesTemplate: row.styleNotesTemplate ?? null,
    productSelectionRules: row.productSelectionRules ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
