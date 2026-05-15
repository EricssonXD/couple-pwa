<!--
  /settings — profile + ghost + couple + theme + sign out (U6f).

  Server load is unchanged. All mutations go through existing JSON
  endpoints (/api/profile, /api/couple, /api/location/ghost). We add
  a client-side theme override (localStorage 'duosync-theme') —
  layout.svelte will already clear data-theme for non-mapped routes,
  so once the user toggles, we set data-theme directly here AND
  persist; the layout's effect won't override on /settings since this
  route isn't in ROUTE_THEME.

  Pre-existing $state(data.x) "state_referenced_locally" warns are
  fixed in this rebuild by sourcing initial values via $state.snapshot
  inside an init helper (no direct prop deref in $state init).
-->
<script lang="ts">
	import { invalidateAll, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PushSubscribeCard from '$lib/components/duosync/PushSubscribeCard.svelte';
	import { MoodTrendStrip } from '$lib/components/duosync';
	import GhostIcon from 'phosphor-svelte/lib/GhostIcon';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import UserIcon from 'phosphor-svelte/lib/UserIcon';
	import SunIcon from 'phosphor-svelte/lib/SunIcon';
	import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import TranslateIcon from 'phosphor-svelte/lib/TranslateIcon';
	import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import FlameIcon from 'phosphor-svelte/lib/FlameIcon';
	import VideoCameraIcon from 'phosphor-svelte/lib/VideoCameraIcon';
	import { setUserTheme, getUserChoice, type ThemeChoice } from '$lib/theme/index.svelte';
	import { locales, getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';
	import type { PageData } from './$types';
	import Card from '$lib/components/ui/Card.svelte';
	import SectionHeader from '$lib/components/ui/SectionHeader.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import InputField from '$lib/components/ui/InputField.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import ChoiceChip from '$lib/components/ui/ChoiceChip.svelte';
	import Notice from '$lib/components/ui/Notice.svelte';

	const { data }: { data: PageData } = $props();

	// 用 derived 包初值, 避 state_referenced_locally warn.
	let displayName = $state('');
	let avatarEmoji = $state('');
	let nickname = $state('');
	let anniversary = $state('');
	let ghost = $state(false);
	let themeChoice = $state<ThemeChoice>('auto');
	let currentLocale = $state<Locale>(getLocale());

	function changeLocale(next: Locale) {
		if (next === currentLocale) return;
		currentLocale = next;
		// setLocale persists via cookie + globalVariable; default reload re-renders all messages.
		setLocale(next);
	}

	let busy = $state<string | null>(null);
	let toast = $state<{ kind: 'success' | 'error'; text: string } | null>(null);
	let confirmUnpair = $state(false);
	let confirmDelete = $state(false);
	let pendingDeletionAt = $state<string | null>(null);

	// F11 H6 — hourly capture reminder waking window.
	let hourlyWindow = $state<{ startHour: number; endHour: number; tz: string } | null>(null);
	let hourlyStart = $state(9);
	let hourlyEnd = $state(22);
	const HOURS = Array.from({ length: 24 }, (_, i) => i);

	onMount(() => {
		displayName = data.me.displayName ?? '';
		avatarEmoji = data.me.avatarEmoji ?? '';
		nickname = data.couple?.nickname ?? '';
		const ann = data.couple?.anniversary;
		anniversary =
			typeof ann === 'string'
				? ann
				: ann
					? new Date(ann as unknown as string).toISOString().slice(0, 10)
					: '';
		ghost = data.me.ghostMode;
		pendingDeletionAt = data.me.pendingDeletionAt
			? new Date(data.me.pendingDeletionAt as unknown as string).toISOString()
			: null;
		// Theme is initialised globally in +layout.svelte via initTheme();
		// here we just sync the radio-group selection to the persisted choice.
		themeChoice = getUserChoice();

		void (async () => {
			try {
				const r = await fetch(resolve('/api/hourly/push-window'));
				if (!r.ok) return;
				const w = (await r.json()) as { startHour: number; endHour: number; tz: string };
				hourlyWindow = w;
				hourlyStart = w.startHour;
				hourlyEnd = w.endHour;
			} catch {
				// non-fatal
			}
		})();
	});

	async function saveHourlyWindow() {
		busy = 'hourly-window';
		toast = null;
		const tz =
			hourlyWindow?.tz ??
			(typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
		const r = await fetch(resolve('/api/hourly/push-window'), {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ startHour: hourlyStart, endHour: hourlyEnd, tz })
		});
		busy = null;
		if (r.ok) {
			hourlyWindow = (await r.json()) as { startHour: number; endHour: number; tz: string };
			toast = { kind: 'success', text: m.settings_saved() };
		} else {
			toast = { kind: 'error', text: m.settings_save_failed({ status: r.status }) };
		}
	}

	function setThemeChoice(next: ThemeChoice) {
		themeChoice = next;
		setUserTheme(next);
	}

	async function saveProfile() {
		busy = 'profile';
		toast = null;
		const r = await fetch('/api/profile', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ displayName, avatarEmoji })
		});
		busy = null;
		toast = r.ok
			? { kind: 'success', text: m.settings_saved() }
			: { kind: 'error', text: m.settings_save_failed({ status: r.status }) };
		if (r.ok) await invalidateAll();
	}

	async function saveCouple() {
		if (!data.couple) return;
		busy = 'couple';
		toast = null;
		const r = await fetch('/api/couple', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				nickname: nickname.trim() ? nickname : null,
				anniversary: anniversary || null
			})
		});
		busy = null;
		toast = r.ok
			? { kind: 'success', text: m.settings_saved() }
			: { kind: 'error', text: m.settings_save_failed({ status: r.status }) };
		if (r.ok) await invalidateAll();
	}

	async function toggleGhost(next: boolean) {
		ghost = next;
		await fetch('/api/location/ghost', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ enabled: next })
		});
	}

	async function doUnpair() {
		busy = 'unpair';
		await fetch('/api/couple', { method: 'DELETE' });
		busy = null;
		await goto(resolve('/onboarding/link'));
	}

	async function requestDelete() {
		busy = 'delete';
		toast = null;
		const r = await fetch('/api/account/deletion', { method: 'POST' });
		busy = null;
		if (r.ok) {
			const body = (await r.json()) as { pendingUntil: string };
			pendingDeletionAt = body.pendingUntil;
			confirmDelete = false;
			await invalidateAll();
		} else {
			toast = { kind: 'error', text: m.settings_delete_failed({ status: r.status }) };
		}
	}

	async function cancelDelete() {
		busy = 'delete-cancel';
		toast = null;
		const r = await fetch('/api/account/deletion', { method: 'DELETE' });
		busy = null;
		if (r.ok) {
			pendingDeletionAt = null;
			await invalidateAll();
		} else {
			toast = { kind: 'error', text: m.settings_cancel_failed({ status: r.status }) };
		}
	}
</script>

<svelte:head>
	<title>{m.settings_title()} · DuoSync</title>
</svelte:head>

<div class="min-h-screen bg-base-100">
	<header class="mx-auto max-w-md px-5 pt-6 pb-4">
		<h1 class="text-display text-2xl font-semibold tracking-wide">{m.settings_title()}</h1>
		<p class="mt-1 text-xs text-base-content/50">{data.me.email}</p>
	</header>

	<main class="mx-auto max-w-md px-5 pb-32">
		{#if toast}
			<div class="mb-4">
				<Notice tone={toast.kind === 'success' ? 'success' : 'error'} role="status">
					{toast.text}
				</Notice>
			</div>
		{/if}

		<!-- profile -->
		<Card class="mt-2 space-y-4">
			<SectionHeader icon={UserIcon} tone="primary" title={m.pulse_you()} />
			<label class="block">
				<span class="mb-1.5 block text-xs text-base-content/60">{m.settings_displayname()}</span>
				<InputField bind:value={displayName} maxlength={40} />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-xs text-base-content/60">{m.settings_avatar()}</span>
				<InputField bind:value={avatarEmoji} maxlength={8} placeholder="🌱" />
			</label>
			<PillButton block disabled={busy === 'profile'} onclick={saveProfile}>
				{#if busy === 'profile'}<Spinner />{/if}
				{busy === 'profile' ? m.settings_saving() : m.settings_save()}
			</PillButton>
			<MoodTrendStrip buckets={data.moodTrend} />
		</Card>

		<!-- privacy / ghost -->
		<Card class="mt-4 space-y-1">
			<SectionHeader
				icon={GhostIcon}
				tone="muted"
				title={m.settings_section_privacy()}
				class="mb-2"
			/>
			<Toggle
				checked={ghost}
				label={m.settings_ghost_label()}
				hint={m.settings_ghost_hint()}
				onchange={toggleGhost}
			/>
			<div class="mt-3">
				<PushSubscribeCard />
			</div>
		</Card>

		<!-- F11 H6 — hourly capture reminder waking window -->
		<Card class="mt-4 space-y-3">
			<SectionHeader icon={VideoCameraIcon} tone="primary" title={m.settings_section_hourly()} />
			<p class="text-xs text-base-content/60">{m.settings_hourly_hint()}</p>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="mb-1.5 block text-xs text-base-content/60">{m.settings_hourly_start()}</span>
					<select
						bind:value={hourlyStart}
						class="w-full rounded-[var(--radius-card)] border border-base-content/10 bg-base-100 px-3 py-2.5 text-sm"
					>
						{#each HOURS as h (h)}
							<option value={h}>{String(h).padStart(2, '0')}:00</option>
						{/each}
					</select>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-xs text-base-content/60">{m.settings_hourly_end()}</span>
					<select
						bind:value={hourlyEnd}
						class="w-full rounded-[var(--radius-card)] border border-base-content/10 bg-base-100 px-3 py-2.5 text-sm"
					>
						{#each HOURS as h (h)}
							<option value={h}>{String(h).padStart(2, '0')}:00</option>
						{/each}
					</select>
				</label>
			</div>
			<PillButton block disabled={busy === 'hourly-window'} onclick={saveHourlyWindow}>
				{#if busy === 'hourly-window'}<Spinner />{/if}
				{busy === 'hourly-window' ? m.settings_saving() : m.settings_save()}
			</PillButton>
		</Card>

		<!-- theme -->
		<Card class="mt-4 space-y-3">
			<SectionHeader icon={SunIcon} tone="accent" title={m.settings_section_theme()} />
			<div class="grid grid-cols-3 gap-2">
				{#each [{ k: 'auto' as const, label: m.settings_theme_auto(), icon: undefined }, { k: 'duosync-light' as const, label: m.settings_theme_light(), icon: SunIcon }, { k: 'duosync-dark' as const, label: m.settings_theme_dark(), icon: MoonIcon }] as o (o.k)}
					<ChoiceChip
						selected={themeChoice === o.k}
						onclick={() => setThemeChoice(o.k)}
						icon={o.icon}
					>
						{o.label}
					</ChoiceChip>
				{/each}
			</div>
		</Card>

		<!-- language -->
		<Card class="mt-4 space-y-3">
			<SectionHeader icon={TranslateIcon} tone="accent" title={m.settings_section_language()} />
			<div class="grid grid-cols-2 gap-2">
				{#each locales as code (code)}
					<ChoiceChip selected={currentLocale === code} onclick={() => changeLocale(code)}>
						{code === 'en' ? m.settings_language_en() : m.settings_language_zh_hant()}
					</ChoiceChip>
				{/each}
			</div>
		</Card>

		<!-- couple -->
		{#if data.couple}
			<Card class="mt-4 space-y-4">
				<SectionHeader icon={HeartIcon} tone="primary" title={m.settings_section_us()} />
				<p class="text-xs text-base-content/60">
					{m.settings_paired_with({
						emoji: data.partner?.avatarEmoji ?? '💞',
						name: data.partner?.displayName ?? m.pulse_partner_fallback()
					})}
				</p>
				{#if data.streak && data.streak.current > 0}
					<p class="inline-flex items-center gap-1.5 text-xs text-base-content/70">
						<Icon icon={FlameIcon} size={14} weight="fill" class="text-primary" />
						<span>{m.streak_label({ n: data.streak.current })}</span>
					</p>
				{/if}
				<a
					href={resolve('/timeline')}
					class="block rounded-[var(--radius-card)] border border-base-content/10 bg-base-100 px-4 py-2.5 text-sm hover:border-primary"
				>
					{m.settings_view_timeline()} →
				</a>
				<label class="block">
					<span class="mb-1.5 block text-xs text-base-content/60"
						>{m.settings_couple_nickname()}</span
					>
					<InputField
						bind:value={nickname}
						maxlength={60}
						placeholder={m.settings_couple_nickname_placeholder()}
					/>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-xs text-base-content/60"
						>{m.settings_couple_anniversary()}</span
					>
					<InputField bind:value={anniversary} type="date" />
				</label>
				<PillButton block disabled={busy === 'couple'} onclick={saveCouple}>
					{#if busy === 'couple'}<Spinner />{/if}
					{busy === 'couple' ? m.settings_saving() : m.settings_save()}
				</PillButton>
			</Card>

			<Card tone="danger" class="mt-4 space-y-3">
				<h2 class="text-sm font-semibold tracking-wider text-error uppercase">
					{m.settings_unpair_section()}
				</h2>
				<p class="text-xs text-base-content/70">
					{m.settings_unpair_warning()}
				</p>
				{#if !confirmUnpair}
					<PillButton variant="danger" block onclick={() => (confirmUnpair = true)}>
						{m.settings_unpair_open()}
					</PillButton>
				{:else}
					<div class="flex gap-2">
						<PillButton
							variant="dangerSolid"
							class="flex-1"
							disabled={busy === 'unpair'}
							onclick={doUnpair}
						>
							{#if busy === 'unpair'}<Spinner />{/if}
							{busy === 'unpair' ? m.settings_unpairing() : m.settings_unpair_confirm()}
						</PillButton>
						<PillButton variant="ghost" class="flex-1" onclick={() => (confirmUnpair = false)}>
							{m.common_cancel()}
						</PillButton>
					</div>
				{/if}
			</Card>
		{/if}

		<!-- diagnostics -->
		<Card class="mt-4 space-y-2">
			<SectionHeader
				icon={WrenchIcon}
				tone="muted"
				title={m.settings_section_diagnostics()}
				class="mb-1"
			/>
			<a
				href={resolve('/settings/offline-queue')}
				class="-mx-2 flex items-center justify-between rounded-[var(--radius-card)] px-2 py-2.5 text-sm hover:bg-base-100"
			>
				<span>{m.settings_diagnostics_offline_queue()}</span>
				<Icon icon={CaretRightIcon} size={14} weight="bold" class="text-base-content/40" />
			</a>
			<a
				href={resolve('/settings/activity')}
				class="-mx-2 flex items-center justify-between rounded-[var(--radius-card)] px-2 py-2.5 text-sm hover:bg-base-100"
			>
				<span>{m.settings_diagnostics_activity()}</span>
				<Icon icon={CaretRightIcon} size={14} weight="bold" class="text-base-content/40" />
			</a>
			<a
				href={resolve('/settings/diagnostics/pet-ledger')}
				class="-mx-2 flex items-center justify-between rounded-[var(--radius-card)] px-2 py-2.5 text-sm hover:bg-base-100"
			>
				<span>{m.pet_diag_title()}</span>
				<Icon icon={CaretRightIcon} size={14} weight="bold" class="text-base-content/40" />
			</a>
		</Card>

		<Card tone="danger" class="mt-4 space-y-3">
			<h2 class="text-sm font-semibold tracking-wider text-error uppercase">
				{m.settings_delete_section()}
			</h2>
			{#if pendingDeletionAt}
				<p class="text-xs text-base-content/80">
					{m.settings_delete_pending({ date: new Date(pendingDeletionAt).toLocaleDateString() })}
				</p>
				<PillButton
					variant="subtle"
					block
					disabled={busy === 'delete-cancel'}
					onclick={cancelDelete}
				>
					{#if busy === 'delete-cancel'}<Spinner />{/if}
					{busy === 'delete-cancel' ? m.settings_delete_cancelling() : m.settings_delete_cancel()}
				</PillButton>
			{:else}
				<p class="text-xs text-base-content/70">{m.settings_delete_warning()}</p>
				{#if !confirmDelete}
					<PillButton variant="danger" block onclick={() => (confirmDelete = true)}>
						{m.settings_delete_open()}
					</PillButton>
				{:else}
					<div class="flex gap-2">
						<PillButton
							variant="dangerSolid"
							class="flex-1"
							disabled={busy === 'delete'}
							onclick={requestDelete}
						>
							{#if busy === 'delete'}<Spinner />{/if}
							{busy === 'delete' ? m.settings_deleting() : m.settings_delete_confirm()}
						</PillButton>
						<PillButton variant="ghost" class="flex-1" onclick={() => (confirmDelete = false)}>
							{m.common_cancel()}
						</PillButton>
					</div>
				{/if}
			{/if}
		</Card>

		<form method="POST" action="/auth/sign-out" class="mt-6">
			<button
				class="inline-flex w-full items-center justify-center gap-2 py-3 text-xs font-semibold tracking-wider text-base-content/60 uppercase hover:text-base-content"
				type="submit"
			>
				<Icon icon={SignOutIcon} size={14} weight="duotone" />
				{m.settings_signout()}
			</button>
		</form>
	</main>
</div>
