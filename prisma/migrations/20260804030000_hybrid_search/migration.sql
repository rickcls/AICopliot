-- Supports the lexical half of hybrid retrieval. The query uses the same
-- English configuration, so PostgreSQL can use this expression index.
CREATE INDEX "DocumentChunk_content_fts_idx"
    ON "DocumentChunk" USING GIN (to_tsvector('english', "content"));
