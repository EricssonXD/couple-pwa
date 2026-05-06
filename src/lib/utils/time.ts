/** Format a Date as a coarse "x ago" string. Returns "" for null/undefined. */
export function relativeTime(d: Date | string | null | undefined, now = Date.now()): string {
	if (!d) return '';
	const t = typeof d === 'string' ? new Date(d).getTime() : d.getTime();
	const sec = Math.max(0, Math.round((now - t) / 1000));
	if (sec < 30) return 'just now';
	if (sec < 60) return `${sec}s ago`;
	const min = Math.round(sec / 60);
	if (min < 60) return `${min} min ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr} h ago`;
	const day = Math.round(hr / 24);
	if (day < 7) return `${day} d ago`;
	return new Date(t).toLocaleDateString();
}
