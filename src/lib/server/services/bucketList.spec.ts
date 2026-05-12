// Pure-surface tests for the bucketList service. DB-touching paths
// (createItem, updateItem, markDone, etc.) are exercised in
// integration tests; here we only assert the validation invariants
// and exported constants.

import { describe, it, expect } from 'vitest';
import {
	MAX_TITLE_LEN,
	MAX_NOTES_LEN,
	MAX_ITEMS_PER_COUPLE,
	BucketItemValidationError
} from './bucketList';

describe('bucketList constants', () => {
	it('MAX_TITLE_LEN matches the SQL CHECK constraint', () => {
		expect(MAX_TITLE_LEN).toBe(200);
	});
	it('MAX_NOTES_LEN matches the SQL CHECK constraint', () => {
		expect(MAX_NOTES_LEN).toBe(2000);
	});
	it('MAX_ITEMS_PER_COUPLE caps the couple backlog', () => {
		expect(MAX_ITEMS_PER_COUPLE).toBe(500);
	});
});

describe('BucketItemValidationError', () => {
	it('preserves the error code for clients to discriminate on', () => {
		const e = new BucketItemValidationError('x', 'title_empty');
		expect(e.code).toBe('title_empty');
		expect(e.name).toBe('BucketItemValidationError');
		expect(e instanceof Error).toBe(true);
	});

	it('supports all documented codes', () => {
		const codes: BucketItemValidationError['code'][] = [
			'title_empty',
			'title_too_long',
			'notes_too_long',
			'invalid_target_date',
			'quota_exceeded'
		];
		for (const c of codes) {
			expect(new BucketItemValidationError('x', c).code).toBe(c);
		}
	});
});
