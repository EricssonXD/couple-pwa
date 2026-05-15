<!--
  HubChips stories.

  Demonstrates the chip-row used at the top of hub pages (/daily,
  /moments). See docs/ui-design.md §7.1 for the contract.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import HubChips from './HubChips.svelte';
	import { ChatCircleIcon, BookOpenIcon, CalendarIcon, ListChecksIcon, PulseIcon } from './icons';

	const { Story } = defineMeta({
		title: 'UI/HubChips',
		component: HubChips,
		tags: ['autodocs']
	});

	const todayChips = [
		{ href: '/daily', label: () => 'Daily', icon: PulseIcon, exact: true },
		{ href: '/chat', label: () => 'Chat', icon: ChatCircleIcon },
		{ href: '/quiz', label: () => 'Quiz', icon: BookOpenIcon },
		{ href: '/repair', label: () => 'Repair' },
		{ href: '/pet', label: () => 'Pet' }
	];

	const momentsChips = [
		{ href: '/moments', label: () => 'Feed', icon: BookOpenIcon, exact: true },
		{ href: '/timeline', label: () => 'Timeline' },
		{ href: '/notes', label: () => 'Notes' },
		{ href: '/calendar', label: () => 'Calendar', icon: CalendarIcon },
		{ href: '/bucket', label: () => 'Bucket', icon: ListChecksIcon }
	];
</script>

<Story name="TodayHub_DailyActive">
	<HubChips chips={todayChips} current="/daily" />
</Story>

<Story name="TodayHub_QuizActive">
	<HubChips chips={todayChips} current="/quiz" />
</Story>

<Story name="MomentsHub_FeedActive">
	<HubChips chips={momentsChips} current="/moments" />
</Story>

<Story name="MomentsHub_CalendarActive">
	<HubChips chips={momentsChips} current="/calendar" />
</Story>

<Story name="ManyChips_OverflowScrolls">
	<HubChips
		chips={[
			...todayChips,
			...momentsChips.slice(1),
			{ href: '/settings', label: () => 'Settings' }
		]}
		current="/timeline"
	/>
</Story>
