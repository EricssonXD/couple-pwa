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
	import GhostIcon from 'phosphor-svelte/lib/GhostIcon';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import UserIcon from 'phosphor-svelte/lib/UserIcon';
	import SunIcon from 'phosphor-svelte/lib/SunIcon';
	import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import TranslateIcon from 'phosphor-svelte/lib/TranslateIcon';
	import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { setUserTheme, getUserChoice, type ThemeChoice } from '$lib/theme/index.svelte';
	import { locales, getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';
	import type { PageData } from './$types';

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
	let msg = $state<string | null>(null);
	let confirmUnpair = $state(false);
	let confirmDelete = $state(false);
	let pendingDeletionAt = $state<string | null>(null);

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
	});

	function setThemeChoice(next: ThemeChoice) {
		themeChoice = next;
		setUserTheme(next);
	}

	async function saveProfile() {
		busy = 'profile';
		msg = null;
		const r = await fetch('/api/profile', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ displayName, avatarEmoji })
		});
		busy = null;
		msg = r.ok ? m.settings_saved() : `Profile save failed: ${r.status}`;
		if (r.ok) await invalidateAll();
	}

	async function saveCouple() {
		if (!data.couple) return;
		busy = 'couple';
		msg = null;
		const r = await fetch('/api/couple', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				nickname: nickname.trim() ? nickname : null,
				anniversary: anniversary || null
			})
		});
		busy = null;
		msg = r.ok ? m.settings_saved() : `Couple save failed: ${r.status}`;
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
		msg = null;
		const r = await fetch('/api/account/deletion', { method: 'POST' });
		busy = null;
		if (r.ok) {
			const body = (await r.json()) as { pendingUntil: string };
			pendingDeletionAt = body.pendingUntil;
			confirmDelete = false;
			await invalidateAll();
		} else {
			msg = `Delete failed: ${r.status}`;
		}
	}

	async function cancelDelete() {
		busy = 'delete-cancel';
		msg = null;
		const r = await fetch('/api/account/deletion', { method: 'DELETE' });
		busy = null;
		if (r.ok) {
			pendingDeletionAt = null;
			await invalidateAll();
		} else {
			msg = `Cancel failed: ${r.status}`;
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
		{#if msg}
			<div
				class="mb-4 rounded-[var(--radius-card)] bg-secondary/15 px-4 py-2.5 text-sm text-secondary-content"
			>
				{msg}
			</div>
		{/if}

		<!-- profile -->
		<section
			class="mt-2 space-y-4 rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 p-5 shadow-paper"
		>
			<header class="flex items-center gap-2">
				<Icon icon={UserIcon} size={18} weight="duotone" class="text-primary" />
				<h2 class="text-sm font-semibold tracking-wider uppercase">{m.pulse_you()}</h2>
			</header>
			<label class="block">
				<span class="mb-1.5 block text-xs text-base-content/60">{m.settings_displayname()}</span>
				<input
					bind:value={displayName}
					maxlength="40"
					class="w-full rounded-[var(--radius-card)] border border-base-content/10 bg-base-100 px-4 py-2.5 outline-none focus:border-primary"
				/>
			</label>
			<label class="block">
				<span class="mb-1.5 block text-xs text-base-content/60">{m.settings_avatar()}</span>
				<input
					bind:value={avatarEmoji}
					maxlength="8"
					class="w-full rounded-[var(--radius-card)] border border-base-content/10 bg-base-100 px-4 py-2.5 outline-none focus:border-primary"
					placeholder="🌱"
				/>
			</label>
			<button
				class="w-full rounded-full bg-primary py-2.5 text-xs font-semibold tracking-wider text-primary-content uppercase disabled:opacity-50"
				disabled={busy === 'profile'}
				onclick={saveProfile}
			>
				{busy === 'profile' ? m.settings_saving() : m.settings_save()}
			</button>
		</section>

		<!-- privacy / ghost -->
		<section
			class="mt-4 space-y-1 rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 p-5 shadow-paper"
		>
			<header class="mb-2 flex items-center gap-2">
				<Icon icon={GhostIcon} size={18} weight="duotone" class="text-base-content/70" />
				<h2 class="text-sm font-semibold tracking-wider uppercase">
					{m.settings_section_privacy()}
				</h2>
			</header>
			<Toggle
				checked={ghost}
				label={m.settings_ghost_label()}
				hint={m.settings_ghost_hint()}
				onchange={toggleGhost}
			/>
			<div class="mt-3">
				<PushSubscribeCard />
			</div>
		</section>

		<!-- theme -->
		<section
			class="mt-4 space-y-3 rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 p-5 shadow-paper"
		>
			<header class="flex items-center gap-2">
				<Icon icon={SunIcon} size={18} weight="duotone" class="text-accent" />
				<h2 class="text-sm font-semibold tracking-wider uppercase">{m.settings_section_theme()}</h2>
			</header>
			<div class="grid grid-cols-3 gap-2">
				{#each [{ k: 'auto' as const, label: m.settings_theme_auto(), icon: undefined }, { k: 'duosync-light' as const, label: m.settings_theme_light(), icon: SunIcon }, { k: 'duosync-dark' as const, label: m.settings_theme_dark(), icon: MoonIcon }] as o (o.k)}
					<button
						type="button"
						onclick={() => setThemeChoice(o.k)}
						class="rounded-[var(--radius-card)] border px-2 py-3 text-xs font-semibold tracking-wider uppercase {themeChoice ===
						o.k
							? 'border-primary bg-primary/10 text-primary'
							: 'border-base-content/10 text-base-content/60'}"
					>
						{#if o.icon}
							<Icon icon={o.icon} size={16} weight="duotone" class="mx-auto mb-1" />
						{/if}
						{o.label}
					</button>
				{/each}
			</div>
		</section>

		<!-- language -->
		<section
			class="mt-4 space-y-3 rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 p-5 shadow-paper"
		>
			<header class="flex items-center gap-2">
				<Icon icon={TranslateIcon} size={18} weight="duotone" class="text-accent" />
				<h2 class="text-sm font-semibold tracking-wider uppercase">
					{m.settings_section_language()}
				</h2>
			</header>
			<div class="grid grid-cols-2 gap-2">
				{#each locales as code (code)}
					<button
						type="button"
						onclick={() => changeLocale(code)}
						class="rounded-[var(--radius-card)] border px-2 py-3 text-xs font-semibold tracking-wider uppercase {currentLocale ===
						code
							? 'border-primary bg-primary/10 text-primary'
							: 'border-base-content/10 text-base-content/60'}"
					>
						{code === 'en' ? m.settings_language_en() : m.settings_language_zh_hant()}
					</button>
				{/each}
			</div>
		</section>

		<!-- couple -->
		{#if data.couple}
			<section
				class="mt-4 space-y-4 rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 p-5 shadow-paper"
			>
				<header class="flex items-center gap-2">
					<Icon icon={HeartIcon} size={18} weight="duotone" class="text-primary" />
					<h2 class="text-sm font-semibold tracking-wider uppercase">{m.settings_section_us()}</h2>
				</header>
				<p class="text-xs text-base-content/60">
					{m.settings_paired_with({
						emoji: data.partner?.avatarEmoji ?? '💞',
						name: data.partner?.displayName ?? m.pulse_partner_fallback()
					})}
				</p>
				<label class="block">
					<span class="mb-1.5 block text-xs text-base-content/60"
						>{m.settings_couple_nickname()}</span
					>
					<input
						bind:value={nickname}
						maxlength="60"
						class="w-full rounded-[var(--radius-card)] border border-base-content/10 bg-base-100 px-4 py-2.5 outline-none focus:border-primary"
						placeholder={m.settings_couple_nickname_placeholder()}
					/>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-xs text-base-content/60"
						>{m.settings_couple_anniversary()}</span
					>
					<input
						bind:value={anniversary}
						type="date"
						class="w-full rounded-[var(--radius-card)] border border-base-content/10 bg-base-100 px-4 py-2.5 outline-none focus:border-primary"
					/>
				</label>
				<button
					class="w-full rounded-full bg-primary py-2.5 text-xs font-semibold tracking-wider text-primary-content uppercase disabled:opacity-50"
					disabled={busy === 'couple'}
					onclick={saveCouple}
				>
					{busy === 'couple' ? m.settings_saving() : m.settings_save()}
				</button>
			</section>

			<!-- danger -->
			<section
				class="mt-4 space-y-3 rounded-[var(--radius-card)] border border-error/30 bg-error/5 p-5"
			>
				<h2 class="text-sm font-semibold tracking-wider text-error uppercase">
					{m.settings_unpair_section()}
				</h2>
				<p class="text-xs text-base-content/70">
					{m.settings_unpair_warning()}
				</p>
				{#if !confirmUnpair}
					<button
						class="w-full rounded-full border border-error/50 py-2.5 text-xs font-semibold tracking-wider text-error uppercase hover:bg-error/10"
						onclick={() => (confirmUnpair = true)}
					>
						{m.settings_unpair_open()}
					</button>
				{:else}
					<div class="flex gap-2">
						<button
							class="flex-1 rounded-full bg-error py-2.5 text-xs font-semibold tracking-wider text-error-content uppercase disabled:opacity-50"
							disabled={busy === 'unpair'}
							onclick={doUnpair}
						>
							{busy === 'unpair' ? m.settings_unpairing() : m.settings_unpair_confirm()}
						</button>
						<button
							class="flex-1 rounded-full py-2.5 text-xs font-semibold tracking-wider text-base-content/60 uppercase"
							onclick={() => (confirmUnpair = false)}
						>
							{m.common_cancel()}
						</button>
					</div>
				{/if}
			</section>
		{/if}

		<!-- diagnostics -->
		<section
			class="mt-4 space-y-2 rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 p-5 shadow-paper"
		>
			<header class="mb-1 flex items-center gap-2">
				<Icon icon={WrenchIcon} size={18} weight="duotone" class="text-base-content/70" />
				<h2 class="text-sm font-semibold tracking-wider uppercase">
					{m.settings_section_diagnostics()}
				</h2>
			</header>
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
		</section>

		<!-- delete account (H4) -->
		<section
			class="mt-4 space-y-3 rounded-[var(--radius-card)] border border-error/30 bg-error/5 p-5"
		>
			<h2 class="text-sm font-semibold tracking-wider text-error uppercase">
				{m.settings_delete_section()}
			</h2>
			{#if pendingDeletionAt}
				<p class="text-xs text-base-content/80">
					{m.settings_delete_pending({ date: new Date(pendingDeletionAt).toLocaleDateString() })}
				</p>
				<button
					class="w-full rounded-full border border-base-content/20 py-2.5 text-xs font-semibold tracking-wider uppercase hover:bg-base-content/5 disabled:opacity-50"
					disabled={busy === 'delete-cancel'}
					onclick={cancelDelete}
				>
					{busy === 'delete-cancel' ? m.settings_delete_cancelling() : m.settings_delete_cancel()}
				</button>
			{:else}
				<p class="text-xs text-base-content/70">{m.settings_delete_warning()}</p>
				{#if !confirmDelete}
					<button
						class="w-full rounded-full border border-error/50 py-2.5 text-xs font-semibold tracking-wider text-error uppercase hover:bg-error/10"
						onclick={() => (confirmDelete = true)}
					>
						{m.settings_delete_open()}
					</button>
				{:else}
					<div class="flex gap-2">
						<button
							class="flex-1 rounded-full bg-error py-2.5 text-xs font-semibold tracking-wider text-error-content uppercase disabled:opacity-50"
							disabled={busy === 'delete'}
							onclick={requestDelete}
						>
							{busy === 'delete' ? m.settings_deleting() : m.settings_delete_confirm()}
						</button>
						<button
							class="flex-1 rounded-full py-2.5 text-xs font-semibold tracking-wider text-base-content/60 uppercase"
							onclick={() => (confirmDelete = false)}
						>
							{m.common_cancel()}
						</button>
					</div>
				{/if}
			{/if}
		</section>

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
