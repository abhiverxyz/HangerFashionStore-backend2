-- Enable pgvector extension (required for vector type and similarity search)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding_vector column if missing (Prisma schema has Unsupported("vector"); we manage it here for search)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'embedding_vector'
  ) THEN
    ALTER TABLE "Product" ADD COLUMN embedding_vector vector(1536);
  END IF;
END $$;

-- Backfill embedding_vector from embedding (text column storing JSON array e.g. '[0.1,0.2,...]').
-- pgvector accepts that format as text cast to vector(1536).
UPDATE "Product"
SET embedding_vector = embedding::vector(1536)
WHERE embedding IS NOT NULL
  AND TRIM(embedding) <> ''
  AND TRIM(embedding) <> '[]';

-- Create HNSW index for fast approximate nearest neighbor (cosine distance).
-- Not using CONCURRENTLY so migration can run in a transaction.
CREATE INDEX IF NOT EXISTS "Product_embedding_vector_hnsw_idx"
  ON "Product"
  USING hnsw (embedding_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding_vector IS NOT NULL;
