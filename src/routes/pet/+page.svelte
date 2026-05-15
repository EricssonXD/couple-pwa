<!--
  /pet — habitat / hatch screen with three tabs: Habitat, Shop, Wardrobe.

  Reads initial snapshot, shop catalogue, and inventory from
  +page.server.ts (single round-trip; no lazy fetch on tab switch —
  rubber-duck CONSIDER). Then on the client:

    - if snapshot.pet === null → render <HatchFlow>; on submit POST
      /api/pet/hatch and replace the snapshot.
    - else → Tabs:
        Habitat   PetSprite + MoodHungerBars + name/rename + stage chip
        Shop      ShopCard grid grouped by kind (Treats, Cosmetics, …)
        Wardrobe  Owned items + Equip/Unequip + Feed actions

  Mutations (buy / equip / treat) all hit their REST endpoint, then
  replace `snapshot` and `inventory` atomically from the response so
  the UI stays consistent across tabs without an extra GET. Per-item
  pending Set blocks double-submits and disables sibling buttons for
  the target item.

  A 30 s $effect re-projects mood/hunger decay locally so the bars
  feel alive between reloads. Treat consumption bumps a `pulse`
  counter to play the bar bounce animation.

  Realtime / partner-action animation is intentionally descoped from
  this PR — own-action animation only. Subscribing to
  pet_state_changed for partner mutations is tracked as future work.
-->
<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import InputField from '$lib/components/ui/InputField.svelte';
	import Notice from '$lib/components/ui/Notice.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import Tabs from '$lib/components/ui/Tabs.svelte';
	import {
		PetSprite,
		MoodHungerBars,
		HatchFlow,
		CoinIcon,
		LedgerStrip,
		ShopCard,
		WardrobePanel
	} from '$lib/components/pet';
	import {
		projectDecay,
		type PetSnapshot,
		type PetInventoryEntry,
		type PetLedgerEntry,
		type PetMutationResult,
		type ShopItemView,
		type Species
	} from '$lib/pet.constants';
	import { createRealtimeClient } from '$lib/client/realtime.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let snapshot = $state<PetSnapshot>(untrack(() => data.snapshot));
	let inventory = $state<PetInventoryEntry[]>(untrack(() => data.inventory));
	let shopItems = $state<ShopItemView[]>(untrack(() => data.shopItems));
	let ledger = $state<PetLedgerEntry[]>(untrack(() => data.ledger));

	// ── decay re-projection (unchanged) ─────────────────────────────────
	let liveMood = $state(untrack(() => data.snapshot.pet?.mood ?? 0));
	let liveHunger = $state(untrack(() => data.snapshot.pet?.hunger ?? 0));

	function reproject() {
		const p = snapshot.pet;
		if (!p) return;
		const out = projectDecay(
			{
				mood: p.mood,
				hunger: p.hunger,
				moodUpdatedAt: new Date(p.moodUpdatedAt),
				hungerUpdatedAt: new Date(p.hungerUpdatedAt)
			},
			new Date()
		);
		liveMood = out.mood;
		liveHunger = out.hunger;
	}

	$effect(() => {
		reproject();
	});

	const tickTimer = setInterval(reproject, 30_000);
	onDestroy(() => clearInterval(tickTimer));

	// ── re-derive shop ownership/lock from latest inventory + stage ─────
	// The server-provided shopItems carries ownedQty/equipped/unlocked
	// frozen at load time. After a mutation we replace the catalogue's
	// dynamic fields from the fresh snapshot+inventory so cards update
	// without a re-fetch.
	const stageOrder: Record<string, number> = { egg: 0, baby: 1, grown: 2 };
	const liveShopItems = $derived<ShopItemView[]>(
		shopItems.map((s) => {
			const owned = inventory.find((i) => i.itemId === s.id);
			const petStage = snapshot.pet?.stage ?? 'egg';
			const unlocked = stageOrder[petStage] >= stageOrder[s.minStage];
			return {
				...s,
				ownedQty: owned?.qty ?? 0,
				equipped: owned?.equipped ?? false,
				unlocked
			};
		})
	);

	const treats = $derived(liveShopItems.filter((s) => s.kind === 'treat'));
	const cosmetics = $derived(liveShopItems.filter((s) => s.kind === 'cosmetic'));
	const furniture = $derived(liveShopItems.filter((s) => s.kind === 'furniture'));
	const buffs = $derived(liveShopItems.filter((s) => s.kind === 'buff'));

	// ── hatch flow (unchanged) ──────────────────────────────────────────
	let hatching = $state(false);
	let hatchError = $state<string | null>(null);

	async function onHatch(payload: { species: Species; name: string }) {
		hatching = true;
		hatchError = null;
		try {
			const res = await fetch('/api/pet/hatch', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				hatchError = body.message ?? 'Could not hatch right now.';
				return;
			}
			// Hatch goes from pet=null → pet=non-null; the gate in
			// applyPetSnapshot accepts because the cur.pet branch is null
			// (no version to compare).
			applyPetSnapshot((await res.json()) as PetSnapshot);
		} catch {
			hatchError = m.pet_action_error_network();
		} finally {
			hatching = false;
		}
	}

	// ── rename (unchanged) ──────────────────────────────────────────────
	let renaming = $state(false);
	let renameValue = $state('');
	let renameError = $state<string | null>(null);
	let renameSubmitting = $state(false);

	function startRename() {
		renameValue = snapshot.pet?.name ?? '';
		renameError = null;
		renaming = true;
	}

	async function submitRename() {
		renameSubmitting = true;
		renameError = null;
		try {
			const res = await fetch('/api/pet', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: renameValue })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				renameError = body.message ?? 'Could not rename.';
				return;
			}
			applyPetSnapshot((await res.json()) as PetSnapshot);
			renaming = false;
		} catch {
			renameError = m.pet_action_error_network();
		} finally {
			renameSubmitting = false;
		}
	}

	// ── shop / wardrobe mutations ───────────────────────────────────────
	let activeTab = $state('habitat');
	let actionError = $state<string | null>(null);
	const pending = new SvelteSet<string>();
	let treatPulse = $state(0);
	let coinPulse = $state(0);
	let coinBouncing = $state(false);
	let treatAnnouncement = $state('');

	// Restart-the-class trick so the same CSS animation can replay on
	// every coinPulse bump. Same shape as MoodHungerBars treat-bounce.
	$effect(() => {
		const pulse = coinPulse;
		if (pulse === 0) return;
		coinBouncing = false;
		queueMicrotask(() => {
			coinBouncing = true;
		});
		const t = setTimeout(() => {
			coinBouncing = false;
		}, 700);
		return () => clearTimeout(t);
	});

	// ── unified snapshot apply (monotonic gate) ─────────────────────────
	// Every snapshot source — own mutation responses, realtime broadcast,
	// reconnect reseed, hatch/rename — flows through this. The composite
	// (pet.version, wallet.version) gate drops anything not strictly
	// newer so out-of-order responses can never overwrite live state.
	// Defensive: incoming `pet === null` while we already have a pet is
	// treated as suspicious and ignored — pets aren't deleted in v1
	// except via couple unlink (which switches the route to paused).
	function applyPetSnapshot(next: PetSnapshot): boolean {
		const cur = snapshot;
		if (cur.pet && next.pet) {
			if (next.pet.version <= cur.pet.version && next.wallet.version <= cur.wallet.version) {
				return false;
			}
		} else if (cur.pet && !next.pet) {
			// Don't let a stale snapshot un-hatch a live pet.
			return false;
		}
		const coinsIncreased = next.wallet.coins > cur.wallet.coins;
		snapshot = next;
		if (coinsIncreased) {
			coinPulse += 1;
		}
		return true;
	}

	// ── inventory fetch sequence ────────────────────────────────────────
	// Realtime + reseed both refetch inventory; an earlier slow request
	// must not overwrite a newer one. Each call captures a sequence
	// number and only commits when it's still the latest.
	let invFetchSeq = 0;
	async function refetchInventory(): Promise<void> {
		const my = ++invFetchSeq;
		try {
			const res = await fetch('/api/pet/inventory');
			if (!res.ok) return;
			const body = (await res.json()) as { inventory: PetInventoryEntry[] };
			if (my !== invFetchSeq) return; // a newer fetch already won
			inventory = body.inventory;
		} catch {
			/* silent — wardrobe will repair on next mutation or reconnect */
		}
	}

	// Same race-protection pattern for the ledger strip — partner
	// earnings broadcast pet_state, we then refetch /api/pet/ledger to
	// pick up the new row. (PetSnapshot doesn't carry ledger entries.)
	let ledgerFetchSeq = 0;
	async function refetchLedger(): Promise<void> {
		const my = ++ledgerFetchSeq;
		try {
			const res = await fetch('/api/pet/ledger?limit=5');
			if (!res.ok) return;
			const body = (await res.json()) as { entries: PetLedgerEntry[] };
			if (my !== ledgerFetchSeq) return;
			ledger = body.entries;
		} catch {
			/* silent — strip will repair on next mutation */
		}
	}

	function mapErrorStatus(status: number, code?: string): string {
		if (status === 402) return m.pet_action_error_402();
		if (status === 403) {
			if (code === 'item_disabled') return m.pet_action_error_403_disabled();
			return m.pet_action_error_403_baby();
		}
		if (status === 404) return m.pet_action_error_404();
		if (status === 409) {
			if (code === 'inventory_empty') return m.pet_action_error_409_empty();
			return m.pet_action_error_409_owned();
		}
		return m.pet_action_error_network();
	}

	async function postPet(
		path: string,
		itemId: string,
		extra?: Record<string, unknown>
	): Promise<PetMutationResult | null> {
		if (pending.has(itemId)) return null;
		pending.add(itemId);
		actionError = null;
		try {
			const res = await fetch(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemId, ...(extra ?? {}) })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as {
					message?: string;
					code?: string;
				};
				actionError = mapErrorStatus(res.status, body.code);
				return null;
			}
			const result = (await res.json()) as PetMutationResult;
			// Both go through the gate — realtime echo or partner write
			// can't be silently overwritten by a slow own-response.
			applyPetSnapshot(result.snapshot);
			// Inventory is non-versioned but is part of the same write
			// txn; commit it unconditionally — fresh from our own write.
			inventory = result.inventory;
			// Ledger is not part of PetMutationResult; refetch async so
			// the activity strip surfaces the new row without blocking
			// the snapshot apply.
			void refetchLedger();
			return result;
		} catch {
			actionError = m.pet_action_error_network();
			return null;
		} finally {
			pending.delete(itemId);
		}
	}

	async function buy(itemId: string) {
		await postPet('/api/pet/buy', itemId);
	}

	async function equip(itemId: string, equipped: boolean) {
		await postPet('/api/pet/equip', itemId, { equipped });
	}

	async function feed(itemId: string) {
		const r = await postPet('/api/pet/treat', itemId);
		if (r) {
			treatPulse += 1;
			treatAnnouncement = m.pet_wardrobe_treat_announce();
			// Clear announcement after a tick so repeats re-announce.
			setTimeout(() => {
				treatAnnouncement = '';
			}, 1500);
		}
	}

	// ── realtime subscription (skipped when couple is paused) ───────────
	// Server emits one `pet_state` snapshot per write on the private
	// `couple:<id>` channel; the realtime client RAF-coalesces bursts
	// and version-gates against the last applied snapshot. Locally we
	// also gate via applyPetSnapshot, then refetch inventory because
	// PetSnapshot doesn't carry inventory rows (only equipped slots).
	const realtimePaused = untrack(() => data.realtimePaused);
	const rt = realtimePaused
		? null
		: createRealtimeClient(untrack(() => ({ coupleId: data.coupleId, userId: data.userId })));

	onMount(() => {
		void rt?.start();
	});
	onDestroy(() => {
		void rt?.stop();
	});

	// Apply incoming snapshots. The realtime client only ever assigns
	// strictly-newer snapshots to its rune (RAF + composite version
	// gate) — we still re-gate here because hatch/rename/buy responses
	// race against this and applyPetSnapshot is the single source of
	// truth.
	$effect(() => {
		if (!rt) return;
		const next = rt.lastPetState;
		if (!next) return;
		if (applyPetSnapshot(next)) {
			// Bump treat-bar bounce on partner mutations as a visible
			// "something changed" signal. Cheap; reduced-motion gates
			// the actual animation.
			treatPulse += 1;
			void refetchInventory();
			void refetchLedger();
		}
	});

	// Reconnect reseed (pet-system.md §"Reconnect strategy"). Skip the
	// very first SUBSCRIBED transition because the page already booted
	// from fresh server-load data.
	let firstSubscribeSeen = false;
	$effect(() => {
		if (!rt) return;
		const ts = rt.lastSubscribedAt;
		if (ts === 0) return;
		if (!firstSubscribeSeen) {
			firstSubscribeSeen = true;
			return;
		}
		void (async () => {
			try {
				const res = await fetch('/api/pet');
				if (!res.ok) return;
				const reseed = (await res.json()) as PetSnapshot;
				applyPetSnapshot(reseed);
				await refetchInventory();
				await refetchLedger();
			} catch {
				/* silent — next mutation or visibility-change rejoin retries */
			}
		})();
	});

	// SvelteSet from svelte/reactivity is reactive; no shim needed.
</script>

<svelte:head>
	<title>{m.pet_title()} · DuoSync</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 pt-6 pb-32">
	<header class="mb-6 flex items-center justify-between">
		<a
			href={resolve('/pulse')}
			class="text-sm font-semibold text-base-content/60 transition hover:text-base-content"
		>
			← {m.pulse_title()}
		</a>
		<div
			class="coin-chip inline-flex items-center gap-1 rounded-full bg-base-200 px-3 py-1 text-sm font-semibold tabular-nums"
			class:coin-chip-pulse={coinBouncing}
		>
			<CoinIcon size={14} />
			<span>{snapshot.wallet.coins}</span>
		</div>
	</header>

	{#if realtimePaused}
		<Notice tone="info" class="mb-4">{m.pet_realtime_paused()}</Notice>
	{/if}

	{#if snapshot.welcomeBack}
		<Notice tone="success" class="mb-4">{m.pet_welcome_back()}</Notice>
	{/if}

	{#if !snapshot.pet}
		<HatchFlow submitting={hatching} error={hatchError} onSubmit={onHatch} />
	{:else}
		{@const p = snapshot.pet}

		{#if actionError}
			<Notice tone="error" class="mb-4">{actionError}</Notice>
		{/if}

		<Tabs
			bind:value={activeTab}
			items={[
				{
					id: 'habitat',
					label: m.pet_tab_habitat(),
					content: habitatTab
				},
				{
					id: 'shop',
					label: m.pet_tab_shop(),
					content: shopTab
				},
				{
					id: 'wardrobe',
					label: m.pet_tab_wardrobe(),
					content: wardrobeTab
				}
			]}
		/>

		{#snippet habitatTab()}
			<section class="flex flex-col items-center gap-3">
				<PetSprite species={p.species} stage={p.stage} mood={liveMood} size={160} />
				{#if !renaming}
					<div class="flex items-center gap-2">
						<h1 class="text-2xl font-semibold tracking-tight">{p.name}</h1>
						<button
							type="button"
							class="text-xs font-semibold text-base-content/60 underline-offset-2 hover:underline"
							onclick={startRename}
						>
							{m.pet_rename_button()}
						</button>
					</div>
				{:else}
					<form
						class="flex w-full max-w-xs flex-col gap-2"
						onsubmit={(e) => {
							e.preventDefault();
							void submitRename();
						}}
					>
						<label class="flex flex-col gap-1.5 text-left">
							<span class="text-xs font-semibold tracking-wider text-base-content/60 uppercase"
								>{m.pet_hatch_name_label()}</span
							>
							<InputField bind:value={renameValue} maxlength={24} disabled={renameSubmitting} />
						</label>
						{#if renameError}
							<Notice tone="error">{renameError}</Notice>
						{/if}
						<div class="flex justify-end gap-2">
							<PillButton
								variant="subtle"
								size="sm"
								onclick={() => (renaming = false)}
								disabled={renameSubmitting}
							>
								{m.pet_rename_cancel()}
							</PillButton>
							<PillButton type="submit" size="sm" disabled={renameSubmitting}>
								{#if renameSubmitting}<Spinner size={14} />{/if}
								{m.pet_rename_save()}
							</PillButton>
						</div>
					</form>
				{/if}
				<p class="text-xs font-semibold tracking-wider text-base-content/50 uppercase">
					{p.stage === 'egg'
						? m.pet_stage_egg()
						: p.stage === 'baby'
							? m.pet_stage_baby()
							: m.pet_stage_grown()}
					· {m.pet_xp_label({ xp: p.xp })}
				</p>
			</section>

			<section class="mt-6">
				<MoodHungerBars mood={liveMood} hunger={liveHunger} pulse={treatPulse} />
			</section>

			<section class="mt-4">
				<LedgerStrip entries={ledger} />
			</section>
		{/snippet}

		{#snippet shopGroup(label: string, items: ShopItemView[])}
			{#if items.length > 0}
				<section>
					<h2 class="mb-2 text-xs font-semibold tracking-wider text-base-content/60 uppercase">
						{label}
					</h2>
					<div class="grid grid-cols-2 gap-3">
						{#each items as item (item.id)}
							<ShopCard
								{item}
								coins={snapshot.wallet.coins}
								pending={pending.has(item.id)}
								onBuy={() => buy(item.id)}
							/>
						{/each}
					</div>
				</section>
			{/if}
		{/snippet}

		{#snippet shopTab()}
			<div class="space-y-6">
				{@render shopGroup(m.pet_wardrobe_section_treats(), treats)}
				{@render shopGroup(m.pet_wardrobe_section_cosmetics(), cosmetics)}
				{@render shopGroup(m.pet_wardrobe_section_furniture(), furniture)}
				{@render shopGroup(m.pet_wardrobe_section_buffs(), buffs)}
			</div>
		{/snippet}

		{#snippet wardrobeTab()}
			<WardrobePanel
				{inventory}
				shopItems={liveShopItems}
				pendingIds={pending}
				{treatAnnouncement}
				onEquip={equip}
				onFeed={feed}
			/>
		{/snippet}
	{/if}
</main>

<style>
	.coin-chip {
		transition: transform 200ms ease-out;
	}
	.coin-chip-pulse {
		animation: coin-bounce 600ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	@keyframes coin-bounce {
		0% {
			transform: scale(1);
		}
		35% {
			transform: scale(1.18);
		}
		70% {
			transform: scale(0.96);
		}
		100% {
			transform: scale(1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.coin-chip,
		.coin-chip-pulse {
			animation: none;
			transition: none;
		}
	}
</style>
