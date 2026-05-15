// DuoSync — F8 v2 recurrence helper.
//
// Wraps rrule.js with a tight allow-list of frequencies and a hard cap
// on expansion to keep the calendar load query bounded. The library is
// pure JS (no Node-specific deps) so it runs cleanly inside Cloudflare
// Workers.
//
// We accept *minimal* RFC 5545 rules: FREQ + INTERVAL + BYDAY +
// BYMONTHDAY + COUNT + UNTIL. DTSTART is always derived from the
// event's `startsAt` — never trusted from the client string — so
// timezone semantics stay anchored to the original event.

// rrule ships dual cjs/esm. Under Node ESM (and Cloudflare Workers),
// the namespace import exposes the real exports under `.default` —
// `rruleNs.rrulestr` is undefined and only `rruleNs.default.rrulestr`
// is a function. Vitest's resolver flattens this, which is why the
// spec passed while production 500'd. Bun also flattens. Always read
// through `.default ?? namespace` so every runtime works.
import * as rruleNs from 'rrule';
import type { RRule, RRuleSet } from 'rrule';
type RruleModule = { rrulestr: typeof import('rrule').rrulestr };
const rruleModule: RruleModule =
	(rruleNs as unknown as { default?: RruleModule }).default ?? (rruleNs as unknown as RruleModule);
const { rrulestr } = rruleModule;

export const ALLOWED_FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type RecurrenceFreq = (typeof ALLOWED_FREQS)[number];

export const MAX_OCCURRENCES_PER_EXPAND = 200;
export const MAX_RRULE_LEN = 200;

export class RruleValidationError extends Error {
	constructor(
		message: string,
		readonly code:
			| 'too_long'
			| 'unparseable'
			| 'missing_freq'
			| 'unsupported_freq'
			| 'unsupported_part'
	) {
		super(message);
		this.name = 'RruleValidationError';
	}
}

const ALLOWED_PARTS = new Set([
	'FREQ',
	'INTERVAL',
	'BYDAY',
	'BYMONTHDAY',
	'BYMONTH',
	'COUNT',
	'UNTIL',
	'WKST'
]);

/**
 * Normalise + validate a user-supplied RRULE fragment (no DTSTART, no
 * `RRULE:` prefix). Returns the canonical string we'll persist, or
 * throws `RruleValidationError`.
 */
export function normalizeRrule(raw: unknown): string {
	if (raw === undefined || raw === null) {
		throw new RruleValidationError('rrule is required', 'unparseable');
	}
	if (typeof raw !== 'string') {
		throw new RruleValidationError('rrule must be a string', 'unparseable');
	}
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		throw new RruleValidationError('rrule is empty', 'unparseable');
	}
	if (trimmed.length > MAX_RRULE_LEN) {
		throw new RruleValidationError(`rrule exceeds ${MAX_RRULE_LEN} chars`, 'too_long');
	}

	// Strip leading `RRULE:` if present so we have a bare param list.
	const body = trimmed.replace(/^RRULE:/i, '');
	const parts = body.split(';');
	const seen = new Set<string>();
	let freq: string | null = null;

	for (const part of parts) {
		const eq = part.indexOf('=');
		if (eq < 1) {
			throw new RruleValidationError(`rrule part "${part}" is malformed`, 'unparseable');
		}
		const key = part.slice(0, eq).toUpperCase();
		const value = part.slice(eq + 1);
		if (!ALLOWED_PARTS.has(key)) {
			throw new RruleValidationError(`rrule part ${key} is not supported`, 'unsupported_part');
		}
		if (seen.has(key)) {
			throw new RruleValidationError(`rrule part ${key} repeats`, 'unparseable');
		}
		seen.add(key);
		if (key === 'FREQ') {
			const upper = value.toUpperCase();
			if (!ALLOWED_FREQS.includes(upper as RecurrenceFreq)) {
				throw new RruleValidationError(`FREQ=${value} is not supported`, 'unsupported_freq');
			}
			freq = upper;
		}
	}

	if (!freq) {
		throw new RruleValidationError('rrule missing FREQ', 'missing_freq');
	}

	// Defer the final structural check to rrule.js — it's the source
	// of truth for COUNT/UNTIL/BYDAY etc. Combine with a synthetic
	// DTSTART so the parser sees a complete spec.
	try {
		rrulestr(`DTSTART:20240101T000000Z\nRRULE:${body}`);
	} catch (err) {
		throw new RruleValidationError(
			`rrule rejected by parser: ${(err as Error).message}`,
			'unparseable'
		);
	}

	return body.toUpperCase();
}

/**
 * Expand a stored RRULE into concrete UTC instants within `[from, to]`.
 * The inclusive range follows ICS semantics (an event whose start equals
 * `to` is included). Capped at MAX_OCCURRENCES_PER_EXPAND to bound the
 * /calendar load query.
 */
export function expandOccurrences(input: {
	rrule: string;
	dtstart: Date;
	from: Date;
	to: Date;
	limit?: number;
}): Date[] {
	const limit = Math.min(input.limit ?? MAX_OCCURRENCES_PER_EXPAND, MAX_OCCURRENCES_PER_EXPAND);
	let set: RRuleSet | RRule;
	try {
		set = rrulestr(`DTSTART:${toBasic(input.dtstart)}\nRRULE:${input.rrule}`, {
			forceset: false
		});
	} catch {
		// Defensive: if a stored rule is somehow corrupt (schema drift,
		// manual db edit) treat it as a single-occurrence event so the
		// calendar view doesn't blow up.
		return [input.dtstart];
	}

	const occurrences = set.between(input.from, input.to, true);
	if (occurrences.length > limit) {
		return occurrences.slice(0, limit);
	}
	return occurrences;
}

/**
 * Format a Date as a basic-format UTC ICS timestamp (YYYYMMDDTHHmmssZ).
 * rrule.js accepts only basic format in DTSTART strings.
 */
function toBasic(d: Date): string {
	const pad = (n: number, w = 2) => String(n).padStart(w, '0');
	return (
		`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
		`T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
	);
}
