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
		msg = r.ok ? '已存' : `Profile save failed: ${r.status}`;
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
		msg = r.ok ? '已存' : `Couple save failed: ${r.status}`;
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
	<title>設定 · DuoSync</title>
</svelte:head>

<div class="bg-base-100 min-h-screen">
	<header class="mx-auto max-w-md px-5 pt-6 pb-4">
		<h1 class="text-display text-2xl font-semibold tracking-wide">設定</h1>
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
				<h2 class="text-sm font-semibold tracking-wider uppercase">你</h2>
			</header>
			<label class="block">
				<span class="text-base-content/60 mb-1.5 block text-xs">顯示名</span>
				<input
					bind:value={displayName}
					maxlength="40"
					class="bg-base-100 border-base-content/10 focus:border-primary w-full rounded-[var(--radius-card)] border px-4 py-2.5 outline-none"
				/>
			</label>
			<label class="block">
				<span class="text-base-content/60 mb-1.5 block text-xs">頭像 emoji</span>
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
				{busy === 'profile' ? '存中…' : '存'}
			</button>
		</section>

		<!-- privacy / ghost -->
		<section
			class="bg-base-200 shadow-paper border-base-content/5 mt-4 space-y-1 rounded-[var(--radius-card)] border p-5"
		>
			<header class="mb-2 flex items-center gap-2">
				<Icon icon={GhostIcon} size={18} weight="duotone" class="text-base-content/70" />
				<h2 class="text-sm font-semibold tracking-wider uppercase">隱私</h2>
			</header>
			<Toggle
				checked={ghost}
				label="隱身模式"
				hint="隱藏位置. 對方只見「已隱身」, 不見距離."
				onchange={toggleGhost}
			/>
		</section>

		<!-- theme -->
		<section
			class="bg-base-200 shadow-paper border-base-content/5 mt-4 space-y-3 rounded-[var(--radius-card)] border p-5"
		>
			<header class="flex items-center gap-2">
				<Icon icon={SunIcon} size={18} weight="duotone" class="text-accent" />
				<h2 class="text-sm font-semibold tracking-wider uppercase">主題</h2>
			</header>
			<div class="grid grid-cols-3 gap-2">
				{#each [{ k: 'auto' as const, label: '系統', icon: undefined }, { k: 'duosync-light' as const, label: '日', icon: SunIcon }, { k: 'duosync-dark' as const, label: '夜', icon: MoonIcon }] as o (o.k)}
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
					<h2 class="text-sm font-semibold tracking-wider uppercase">我們</h2>
				</header>
				<p class="text-base-content/60 text-xs">
					配對於 {data.partner?.avatarEmoji ?? '💞'}
					{data.partner?.displayName ?? '夥伴'}
				</p>
				<label class="block">
					<span class="text-base-content/60 mb-1.5 block text-xs">暱稱</span>
					<input
						bind:value={nickname}
						maxlength="60"
						class="bg-base-100 border-base-content/10 focus:border-primary w-full rounded-[var(--radius-card)] border px-4 py-2.5 outline-none"
						placeholder="我們"
					/>
				</label>
				<label class="block">
					<span class="text-base-content/60 mb-1.5 block text-xs">紀念日</span>
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
					{busy === 'couple' ? '存中…' : '存'}
				</button>
			</section>

			<!-- danger -->
			<section
				class="border-error/30 bg-error/5 mt-4 space-y-3 rounded-[var(--radius-card)] border p-5"
			>
				<h2 class="text-error text-sm font-semibold tracking-wider uppercase">解除配對</h2>
				<p class="text-base-content/70 text-xs">
					斷連. 共享歷史保留至清理. 將回配對碼屏.
				</p>
				{#if !confirmUnpair}
					<button
						class="border-error/50 text-error hover:bg-error/10 w-full rounded-full border py-2.5 text-xs font-semibold tracking-wider uppercase"
						onclick={() => (confirmUnpair = true)}
					>
						解除…
					</button>
				{:else}
					<div class="flex gap-2">
						<button
							class="bg-error text-error-content flex-1 rounded-full py-2.5 text-xs font-semibold tracking-wider uppercase disabled:opacity-50"
							disabled={busy === 'unpair'}
							onclick={doUnpair}
						>
							{busy === 'unpair' ? '解除中…' : '確定解除'}
						</button>
						<button
							class="text-base-content/60 flex-1 rounded-full py-2.5 text-xs font-semibold tracking-wider uppercase"
							onclick={() => (confirmUnpair = false)}
						>
							取消
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
				<Icon icon={SignOutIcon} size={14} weight="duotone" /> 簽出
			</button>
		</form>
	</main>
</div>
