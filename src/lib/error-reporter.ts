/**
 * Shared error reporter — emits a single line of structured JSON per crash.
 *
 * Sink: stdout/stderr. On Cloudflare Workers this is captured by Workers
 * Logs (free, no SaaS, viewable via `wrangler tail` or the dashboard); in
 * the browser it shows up in DevTools and can be tailed by users when we
 * ask for a bug report. Either way, we never ship PII off-device.
 *
 * PII scrubbing strips the bits that, by themselves or in combination,
 * could deanonymise a couple: emails, lat/lon coordinates, raw cookies,
 * Supabase JWTs, and any value under a key matching the sensitive list.
 */

const SENSITIVE_KEY =
	/(?:^|_)(?:email|password|token|jwt|cookie|session|lat|lng|lon|longitude|latitude|address|phone)(?:$|_)/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const COORD_RE = /-?\d{1,3}\.\d{4,}/g;

export function scrub(value: unknown, depth = 0): unknown {
	if (depth > 6) return '[truncated]';
	if (value == null) return value;
	if (typeof value === 'string') return scrubString(value);
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	if (value instanceof Error) {
		return {
			name: value.name,
			message: scrubString(value.message ?? ''),
			stack: value.stack ? scrubString(value.stack) : undefined
		};
	}
	if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
	if (typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (SENSITIVE_KEY.test(k)) {
				out[k] = '[redacted]';
			} else {
				out[k] = scrub(v, depth + 1);
			}
		}
		return out;
	}
	return String(value);
}

function scrubString(s: string): string {
	return s.replace(EMAIL_RE, '[email]').replace(JWT_RE, '[jwt]').replace(COORD_RE, '[coord]');
}

export interface ReportContext {
	side: 'server' | 'client';
	url?: string;
	route?: string | null;
	status?: number;
	message?: string;
	digest?: string;
	[key: string]: unknown;
}

export function report(error: unknown, ctx: ReportContext): { id: string; message: string } {
	const id = crypto.randomUUID();
	const payload = {
		ts: new Date().toISOString(),
		id,
		level: 'error',
		...(scrub(ctx) as Record<string, unknown>),
		error: scrub(error)
	};
	try {
		console.error(JSON.stringify(payload));
	} catch {
		// Fallback if a circular ref slips through — emit a minimal record.
		console.error(JSON.stringify({ ts: payload.ts, id, level: 'error', side: ctx.side }));
	}
	return { id, message: 'Something went wrong. Please try again.' };
}
