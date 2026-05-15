<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LedgerStrip from './LedgerStrip.svelte';

	const { Story } = defineMeta({
		title: 'Pet/LedgerStrip',
		component: LedgerStrip,
		tags: ['autodocs']
	});

	const now = Date.now();
	const minutesAgo = (n: number) => new Date(now - n * 60 * 1000).toISOString();

	const populated: import('$lib/pet.constants').PetLedgerEntry[] = [
		{
			id: '1',
			kind: 'earn',
			source: 'daily_send',
			coinsDelta: 12,
			xpDelta: 2,
			createdAt: minutesAgo(8)
		},
		{
			id: '2',
			kind: 'earn',
			source: 'quiz_complete',
			coinsDelta: 18,
			xpDelta: 4,
			createdAt: minutesAgo(45)
		},
		{
			id: '3',
			kind: 'spend',
			source: 'buy:hat_party',
			coinsDelta: -25,
			xpDelta: 0,
			createdAt: minutesAgo(120)
		},
		{
			id: '4',
			kind: 'earn',
			source: 'mood_log',
			coinsDelta: 6,
			xpDelta: 1,
			createdAt: minutesAgo(300)
		},
		{
			id: '5',
			kind: 'adjust',
			source: 'reconcile:+3',
			coinsDelta: 0,
			xpDelta: 0,
			createdAt: minutesAgo(60 * 24)
		}
	];
</script>

<Story name="Loading" args={{ entries: null }} />

<Story name="Empty" args={{ entries: [] }} />

<Story name="Populated" args={{ entries: populated }} />

<Story
	name="WithFullViewLink"
	args={{ entries: populated, fullViewHref: '/settings/diagnostics/pet-ledger' }}
/>
