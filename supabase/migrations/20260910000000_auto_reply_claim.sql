-- A conditional UPDATE ... WHERE cta_reply_claimed_at IS NULL claims a post atomically.
-- Keep claims on uncertain send/persistence outcomes; do not retry blindly.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS cta_reply_claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN posts.cta_reply_claimed_at IS
  'Auto-reply attempt claim. Unreplied claims require reconciliation before clearing; never expire automatically.';
