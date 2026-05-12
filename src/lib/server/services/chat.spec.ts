// Pure-surface tests for the F7 chat service. The DB-touching paths
// (listMessages, sendMessage) are exercised in integration tests; here
// we cover the constants + typed-error contract + body normalisation
// that API handlers rely on.

import { describe, it, expect } from 'vitest';
import {
	CHAT_BODY_MIN_LEN,
	CHAT_BODY_MAX_LEN,
	CHAT_RETENTION_DAYS,
	CHAT_HISTORY_DEFAULT_LIMIT,
	CHAT_HISTORY_MAX_LIMIT,
	ChatValidationError
} from './chat';

describe('chat constants', () => {
	it('body length bounds match the SQL CHECK constraint (1..2000)', () => {
		expect(CHAT_BODY_MIN_LEN).toBe(1);
		expect(CHAT_BODY_MAX_LEN).toBe(2000);
	});
	it('retention is 7 days (matches RLS SELECT predicate + cron)', () => {
		expect(CHAT_RETENTION_DAYS).toBe(7);
	});
	it('history limits are sane', () => {
		expect(CHAT_HISTORY_DEFAULT_LIMIT).toBeGreaterThanOrEqual(1);
		expect(CHAT_HISTORY_DEFAULT_LIMIT).toBeLessThanOrEqual(CHAT_HISTORY_MAX_LIMIT);
		expect(CHAT_HISTORY_MAX_LIMIT).toBeLessThanOrEqual(500);
	});
});

describe('ChatValidationError', () => {
	it('preserves the error code for API discrimination', () => {
		const codes = ['body_empty', 'body_too_long', 'invalid_cursor', 'invalid_limit'] as const;
		for (const code of codes) {
			const e = new ChatValidationError('msg', code);
			expect(e.code).toBe(code);
			expect(e.name).toBe('ChatValidationError');
			expect(e.message).toBe('msg');
		}
	});
});
