/**
 * Shared HubChips definitions for the two parent hubs.
 *
 * Centralised so every secondary route renders the SAME chip row as
 * its parent. Previously each hub page declared its own array inline
 * (`/daily` and `/moments`), and every other secondary surface had no
 * chips at all — tapping into /quiz, /chat, /repair, /pet, /calendar,
 * /timeline, /bucket, or /notes dropped the user out of the hub
 * navigation entirely.
 *
 * Usage:
 *
 *   import { todayChips, momentsChips } from '$lib/components/duosync';
 *   <HubHeader chips={todayChips} current={page.url.pathname} … />
 *
 * Keep each list ≤ 7 items (Miller's law). The chip row itself
 * scroll-snaps and won't break beyond that, but readability degrades.
 */

import * as m from '$lib/paraglide/messages.js';
import {
	BookOpenIcon,
	CalendarIcon,
	ChatCircleIcon,
	ClockCounterClockwiseIcon,
	ListChecksIcon,
	NoteIcon,
	PawPrintIcon,
	PulseIcon,
	QuestionIcon,
	VideoCameraIcon,
	WrenchIcon
} from '$lib/components/ui/icons';
import type { IconComponentProps } from 'phosphor-svelte';
import type { Component } from 'svelte';

export type HubChip = {
	href: string;
	label: () => string;
	icon: Component<IconComponentProps>;
	exact?: boolean;
};

/** Chips shown above every "Today" hub child route. */
export const todayChips: HubChip[] = [
	{ href: '/daily', label: m.hub_chip_daily, icon: PulseIcon, exact: true },
	{ href: '/chat', label: m.hub_chip_chat, icon: ChatCircleIcon },
	{ href: '/quiz', label: m.hub_chip_quiz, icon: QuestionIcon },
	{ href: '/repair', label: m.hub_chip_repair, icon: WrenchIcon },
	{ href: '/pet', label: m.hub_chip_pet, icon: PawPrintIcon }
];

/** Chips shown above every "Moments" hub child route. */
export const momentsChips: HubChip[] = [
	{ href: '/moments', label: m.hub_chip_feed, icon: BookOpenIcon, exact: true },
	{ href: '/timeline', label: m.hub_chip_timeline, icon: ClockCounterClockwiseIcon },
	{ href: '/notes', label: m.hub_chip_notes, icon: NoteIcon },
	{ href: '/calendar', label: m.hub_chip_calendar, icon: CalendarIcon },
	{ href: '/bucket', label: m.hub_chip_bucket, icon: ListChecksIcon },
	{ href: '/hourly', label: m.hub_chip_hourly, icon: VideoCameraIcon }
];
