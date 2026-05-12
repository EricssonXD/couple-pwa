// F7 — couple-only chat shared constants.
// 7-day TTL is enforced both at the SQL read layer (RLS SELECT policy
// in 0020_chat_messages.sql) and by the hourly cron purge in
// 0021_chat_messages_purge_cron.sql. The constant here is the source
// of truth for the read-time service filter and any UI copy.

export const CHAT_BODY_MIN_LEN = 1;
export const CHAT_BODY_MAX_LEN = 2000;
export const CHAT_RETENTION_DAYS = 7;
export const CHAT_HISTORY_DEFAULT_LIMIT = 50;
export const CHAT_HISTORY_MAX_LIMIT = 100;
