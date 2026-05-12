// PWA widget data endpoint — surfaces the partner's latest mood +
// most recent location ping into Adaptive Cards-friendly fields. See
// `static/widgets/partner-pulse.template.json` for the placeholder
// keys this payload hydrates.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { moodPulse, profile, locationPing } from '$lib/server/db/app.schema';
import { and, desc, eq, ne } from 'drizzle-orm';

const MOOD_EMOJI: Record<string, string> = {
	joyful: '😄',
	happy: '🙂',
	neutral: '😐',
	sad: '😔',
	upset: '😢'
};

function relTime(d: Date): string {
	const diff = Date.now() - d.getTime();
	const m = Math.floor(diff / 60_000);
	if (m < 1) return 'just now';
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const day = Math.floor(h / 24);
	return `${day}d ago`;
}

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(404, 'no_couple');

	const me = locals.user.id;
	const partnerId = locals.couple.partnerA === me ? locals.couple.partnerB : locals.couple.partnerA;

	const [partnerProfile] = await db
		.select({ displayName: profile.displayName })
		.from(profile)
		.where(eq(profile.userId, partnerId))
		.limit(1);

	const [latestMood] = await db
		.select({ mood: moodPulse.mood, setAt: moodPulse.setAt })
		.from(moodPulse)
		.where(and(eq(moodPulse.coupleId, locals.couple.id), eq(moodPulse.userId, partnerId)))
		.orderBy(desc(moodPulse.setAt))
		.limit(1);

	const [latestPing] = await db
		.select({ capturedAt: locationPing.capturedAt })
		.from(locationPing)
		.where(and(eq(locationPing.coupleId, locals.couple.id), ne(locationPing.userId, me)))
		.orderBy(desc(locationPing.capturedAt))
		.limit(1);

	const moodEmoji = latestMood ? (MOOD_EMOJI[latestMood.mood] ?? '💗') : '💗';
	const statusLine = latestMood ? `Feeling ${latestMood.mood}` : 'No mood yet';
	const lastSeenLine = latestPing
		? `Last seen ${relTime(new Date(latestPing.capturedAt))}`
		: 'No recent location';

	return json(
		{
			nickname: partnerProfile?.displayName ?? 'Your partner',
			moodEmoji,
			statusLine,
			lastSeenLine,
			openUrl: `${url.origin}/pulse`
		},
		{
			headers: {
				// Manifest declares update=900 so cap cache at 15 min.
				'cache-control': 'private, max-age=900'
			}
		}
	);
};
