-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
