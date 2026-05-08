<!--
  MemoryResurface stories — U9 baseline.

  Covers the two memory.kind variants (moment vs first_ping) plus the
  null state (renders nothing). Each story uses fixed dates relative to
  today so daysAgo lands in different fmtAgo branches (days / months /
  years) — that exercises the memory_*_ago pluralisation paths.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import MemoryResurface from './MemoryResurface.svelte';

	const { Story } = defineMeta({
		title: 'DuoSync/MemoryResurface',
		component: MemoryResurface,
		tags: ['autodocs']
	});

	const today = new Date();
	function daysAgo(n: number) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- static fixture data for Storybook args
		const d = new Date(today);
		d.setDate(d.getDate() - n);
		return d.toISOString();
	}

	const VIEWER = 'viewer-1';
	const PARTNER = 'partner-1';
</script>

<Story
	name="MomentRecent_ByPartner"
	args={{
		viewerId: VIEWER,
		partnerName: 'Mira',
		memory: {
			kind: 'moment',
			id: 'm-1',
			authorId: PARTNER,
			body: 'Saw the kingfisher again at our spot. Wished you were here.',
			lat: 22.28,
			lon: 114.16,
			createdAt: daysAgo(14),
			daysAgo: 14
		}
	}}
/>

<Story
	name="MomentMonths_ByViewer"
	args={{
		viewerId: VIEWER,
		partnerName: 'Mira',
		memory: {
			kind: 'moment',
			id: 'm-2',
			authorId: VIEWER,
			body: 'First time we cooked together. Burned the eggs.',
			lat: 22.28,
			lon: 114.16,
			createdAt: daysAgo(120),
			daysAgo: 120
		}
	}}
/>

<Story
	name="MomentYears"
	args={{
		viewerId: VIEWER,
		partnerName: 'Mira',
		memory: {
			kind: 'moment',
			id: 'm-3',
			authorId: PARTNER,
			body: '今天天氣很好, 我想念你.',
			lat: 22.28,
			lon: 114.16,
			createdAt: daysAgo(800),
			daysAgo: 800
		}
	}}
/>

<Story
	name="FirstPing"
	args={{
		viewerId: VIEWER,
		partnerName: 'Mira',
		memory: {
			kind: 'first_ping',
			capturedAt: daysAgo(365),
			daysAgo: 365
		}
	}}
/>

<Story name="Empty" args={{ viewerId: VIEWER, partnerName: 'Mira', memory: null }} />
