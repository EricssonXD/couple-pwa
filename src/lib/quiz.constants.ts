// Shared client+server constants for F9 quiz runs.

export const MAX_QUIZ_ID_LEN = 64;
// Mirrors the DB CHECK constraint quiz_runs_quiz_id_shape — keep
// strictly in sync with drizzle/manual/0017_quiz_runs.sql.
export const QUIZ_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const MAX_QUESTIONS_PER_PACK = 50;
export const MAX_CHOICES_PER_QUESTION = 6;
export const MAX_PROMPT_LEN = 200;
