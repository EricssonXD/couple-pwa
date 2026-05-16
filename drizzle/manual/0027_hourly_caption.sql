-- 0027 — F11 hourly clip captions.
--
-- Adds an optional short caption (≤ 280 chars) to hourly_clip so the
-- owner can annotate their 2-second moment. NULL = no caption.

ALTER TABLE hourly_clip
  ADD COLUMN IF NOT EXISTS caption text;

ALTER TABLE hourly_clip
  DROP CONSTRAINT IF EXISTS hourly_clip_caption_len_chk;

ALTER TABLE hourly_clip
  ADD CONSTRAINT hourly_clip_caption_len_chk
  CHECK (caption IS NULL OR char_length(caption) <= 280);
