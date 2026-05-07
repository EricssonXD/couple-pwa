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
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import GhostIcon from 'phosphor-svelte/lib/GhostIcon';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import UserIcon from 'phosphor-svelte/lib/UserIcon';
	import SunIcon from 'phosphor-svelte/lib/SunIcon';
	import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import { setTheme, clearTheme, type DuoSyncTheme } from '$lib/theme';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	// 用 derived 包初值, 避 state_referenced_locally warn.
	let displayName = $state('');
	let avatarEmoji = $state('');
	let nickname = $state('');
	let anniversary = $state('');
	let ghost = $state(false);
	let themeChoice = $state<'auto' | DuoSyncTheme>('auto');

	let busy = $state<string | null>(null);
	let msg = $state<string | null>(null);
	let confirmUnpair = $state(false);

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
		const stored = localStorage.getItem('duosync-theme');
		if (stored === 'duosync-light' || stored === 'duosync-dark') {
			themeChoice = stored;
			setTheme(stored);
		}
	});

	function setThemeChoice(next: 'auto' | DuoSyncTheme) {
		themeChoice = next;
		if (next === 'auto') {
			localStorage.removeItem('duosync-theme');
			clearTheme();
		} else {
			localStorage.setItem('duosync-theme', next);
			setTheme(next);
		}
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
		await goto('/onboarding/link');
	}
</script>

<svelte:head>
	<title>{m.settings_title()} · DuoSync</title>
</svelte:head>

<div class="bg-base-100 min-h-screen">
	<header class="mx-auto max-w-md px-5 pt-6 pb-4">
		<h1 class="text-display text-2xl font-semibold tracking-wide">{m.settings_title()}</h1>
		<p class="text-base-content/50 mt-1 text-xs">{data.me.email}</p>
	</header>

	<main class="mx-auto max-w-md px-5 pb-32">
		{#if msg}
			<div class="bg-secondary/15 text-secondary-content mb-4 rounded-[var(--radius-card)] px-4 py-2.5 text-sm">
				{msg}
			</div>
		{/if}

		<!-- profile -->
		<section
			class="bg-base-200 shadow-paper border-base-content/5 mt-2 space-y-4 rounded-[var(--radius-card)] border p-5"
		>
			<header class="flex items-center gap-2">
				<Icon icon={UserIcon} size={18} weight="duotone" class="text-primary" />
				<h2 class="text-sm font-semibold tracking-wider uppercase">{m.pulse_you()}</h2>
			</header>
			<label class="block">
				<span class="text-base-content/60 mb-1.5 block text-xs">{m.settings_displayname()}</span>
				<input
					bind:value={displayName}
					maxlength="40"
					class="bg-base-100 border-base-content/10 focus:border-primary w-full rounded-[var(--radius-card)] border px-4 py-2.5 outline-none"
				/>
			</label>
			<label class="block">
				<span class="text-base-content/60 mb-1.5 block text-xs">{m.settings_avatar()}</span>
				<input
					bind:value={avatarEmoji}
					maxlength="8"
					class="bg-base-100 border-base-content/10 focus:border-primary w-full rounded-[var(--radius-card)] border px-4 py-2.5 outline-none"
					placeholder="🌱"
				/>
			</label>
			<button
				class="bg-primary text-primary-content w-full rounded-full py-2.5 text-xs font-semibold tracking-wider uppercase disabled:opacity-50"
				disabled={busy === 'profile'}
				onclick={saveProfile}
			>
				{busy === 'profile' ? m.settings_saving() : m.settings_save()}
			</button>
		</section>

		<!-- privacy / ghost -->
		<section
			class="bg-base-200 shadow-paper border-base-content/5 mt-4 space-y-1 rounded-[var(--radius-card)] border p-5"
		>
			<header class="mb-2 flex items-center gap-2">
				<Icon icon={GhostIcon} size={18} weight="duotone" class="text-base-content/70" />
				<h2 class="text-sm font-semibold tracking-wider uppercase">{m.settings_section_privacy()}</h2>
			</header>
			<Toggle
				checked={ghost}
				label={m.settings_ghost_label()}
				hint={m.settings_ghost_hint()}
				onchange={toggleGhost}
			/>
		</section>

		<!-- theme -->
		<section
			class="bg-base-200 shadow-paper border-base-content/5 mt-4 space-y-3 rounded-[var(--radius-card)] border p-5"
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

		<!-- couple -->
		{#if data.couple}
			<section
				class="bg-base-200 shadow-paper border-base-content/5 mt-4 space-y-4 rounded-[var(--radius-card)] border p-5"
			>
				<header class="flex items-center gap-2">
					<Icon icon={HeartIcon} size={18} weight="duotone" class="text-primary" />
					<h2 class="text-sm font-semibold tracking-wider uppercase">{m.settings_section_us()}</h2>
				</header>
				<p class="text-base-content/60 text-xs">
					{m.settings_paired_with({ emoji: data.partner?.avatarEmoji ?? '💞', name: data.partner?.displayName ?? m.pulse_partner_fallback() })}
				</p>
				<label class="block">
					<span class="text-base-content/60 mb-1.5 block text-xs">{m.settings_couple_nickname()}</span>
					<input
						bind:value={nickname}
						maxlength="60"
						class="bg-base-100 border-base-content/10 focus:border-primary w-full rounded-[var(--radius-card)] border px-4 py-2.5 outline-none"
						placeholder={m.settings_couple_nickname_placeholder()}
					/>
				</label>
				<label class="block">
					<span class="text-base-content/60 mb-1.5 block text-xs">{m.settings_couple_anniversary()}</span>
					<input
						bind:value={anniversary}
						type="date"
						class="bg-base-100 border-base-content/10 focus:border-primary w-full rounded-[var(--radius-card)] border px-4 py-2.5 outline-none"
					/>
				</label>
				<button
					class="bg-primary text-primary-content w-full rounded-full py-2.5 text-xs font-semibold tracking-wider uppercase disabled:opacity-50"
					disabled={busy === 'couple'}
					onclick={saveCouple}
				>
					{busy === 'couple' ? m.settings_saving() : m.settings_save()}
				</button>
			</section>

			<!-- danger -->
			<section
				class="border-error/30 bg-error/5 mt-4 space-y-3 rounded-[var(--radius-card)] border p-5"
			>
				<h2 class="text-error text-sm font-semibold tracking-wider uppercase">{m.settings_unpair_section()}</h2>
				<p class="text-base-content/70 text-xs">
					{m.settings_unpair_warning()}
				</p>
				{#if !confirmUnpair}
					<button
						class="border-error/50 text-error hover:bg-error/10 w-full rounded-full border py-2.5 text-xs font-semibold tracking-wider uppercase"
						onclick={() => (confirmUnpair = true)}
					>
						{m.settings_unpair_open()}
					</button>
				{:else}
					<div class="flex gap-2">
						<button
							class="bg-error text-error-content flex-1 rounded-full py-2.5 text-xs font-semibold tracking-wider uppercase disabled:opacity-50"
							disabled={busy === 'unpair'}
							onclick={doUnpair}
						>
							{busy === 'unpair' ? m.settings_unpairing() : m.settings_unpair_confirm()}
						</button>
						<button
							class="text-base-content/60 flex-1 rounded-full py-2.5 text-xs font-semibold tracking-wider uppercase"
							onclick={() => (confirmUnpair = false)}
						>
							{m.common_cancel()}
						</button>
					</div>
				{/if}
			</section>
		{/if}

		<form method="POST" action="/auth/sign-out" class="mt-6">
			<button
				class="text-base-content/60 hover:text-base-content inline-flex w-full items-center justify-center gap-2 py-3 text-xs font-semibold tracking-wider uppercase"
				type="submit"
			>
				<Icon icon={SignOutIcon} size={14} weight="duotone" /> {m.settings_signout()}
			</button>
		</form>
	</main>
</div>
