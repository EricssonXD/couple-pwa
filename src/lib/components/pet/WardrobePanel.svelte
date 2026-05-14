<!--
  WardrobePanel — the /pet "Wardrobe" tab.

  Renders the couple's owned items grouped by kind. Cosmetics get an
  Equip/Unequip toggle (with aria-pressed); Treats get a Feed button
  with an aria-live announcement on success. Furniture and Buffs are
  read-only chips today (Phase-future will make them interactive).

  This panel does not own state — it receives the current snapshot,
  the inventory, and the shop catalogue (used for kind/name lookups
  since PetInventoryEntry only carries itemId/qty/equipped/slot).

  Mutation handlers receive the itemId only; the parent owns the
  fetch + per-item pending tracking + state replacement so the
  tabs can stay coherent.
-->
<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import { shopItemName } from './shop-i18n';
	import type { PetInventoryEntry, ShopItemView, ShopItemKind } from '$lib/pet.constants';
	import type { SvelteSet } from 'svelte/reactivity';
	import * as m from '$lib/paraglide/messages.js';

	interface Props {
		inventory: PetInventoryEntry[];
		shopItems: ShopItemView[];
		pendingIds: SvelteSet<string> | Set<string>;
		treatAnnouncement: string;
		onEquip: (itemId: string, equipped: boolean) => void;
		onFeed: (itemId: string) => void;
	}

	let { inventory, shopItems, pendingIds, treatAnnouncement, onEquip, onFeed }: Props = $props();

	type WardrobeRow = PetInventoryEntry & {
		kind: ShopItemKind;
		nameKey: string;
	};

	const catalogueById = $derived(new Map(shopItems.map((s) => [s.id, s] as const)));

	// Join inventory with catalogue. Drop entries whose item is no longer
	// in the catalogue (shouldn't happen but never trust foreign data).
	const rows = $derived<WardrobeRow[]>(
		inventory
			.map((entry) => {
				const meta = catalogueById.get(entry.itemId);
				if (!meta) return null;
				return { ...entry, kind: meta.kind, nameKey: meta.nameKey };
			})
			.filter((r): r is WardrobeRow => r !== null)
	);

	const treats = $derived(rows.filter((r) => r.kind === 'treat'));
	const cosmetics = $derived(rows.filter((r) => r.kind === 'cosmetic'));
	const furniture = $derived(rows.filter((r) => r.kind === 'furniture'));
	const buffs = $derived(rows.filter((r) => r.kind === 'buff'));
</script>

<div class="space-y-6">
	<div role="status" aria-live="polite" class="sr-only">{treatAnnouncement}</div>

	{#if rows.length === 0}
		<Card padding="md">
			<p class="text-sm leading-relaxed text-base-content/70">{m.pet_wardrobe_empty()}</p>
		</Card>
	{/if}

	{#if treats.length > 0}
		<section>
			<h2 class="mb-2 text-xs font-semibold tracking-wider text-base-content/60 uppercase">
				{m.pet_wardrobe_section_treats()}
			</h2>
			<div class="grid grid-cols-2 gap-3">
				{#each treats as t (t.itemId)}
					{@const pending = pendingIds.has(t.itemId)}
					{@const empty = t.qty <= 0}
					<Card padding="sm">
						<div class="flex flex-col gap-2">
							<div class="text-sm leading-tight font-semibold">{shopItemName(t.nameKey)}</div>
							<div class="flex items-center justify-between gap-2">
								<span class="text-xs font-semibold text-base-content/60 tabular-nums">
									{empty ? m.pet_wardrobe_out_of_stock() : m.pet_wardrobe_qty({ qty: t.qty })}
								</span>
								<PillButton
									size="sm"
									variant={empty || pending ? 'subtle' : 'primary'}
									disabled={empty || pending}
									onclick={() => onFeed(t.itemId)}
								>
									{#if pending}<Spinner size={12} />{/if}
									{m.pet_wardrobe_eat()}
								</PillButton>
							</div>
						</div>
					</Card>
				{/each}
			</div>
		</section>
	{/if}

	{#if cosmetics.length > 0}
		<section>
			<h2 class="mb-2 text-xs font-semibold tracking-wider text-base-content/60 uppercase">
				{m.pet_wardrobe_section_cosmetics()}
			</h2>
			<div class="grid grid-cols-2 gap-3">
				{#each cosmetics as c (c.itemId)}
					{@const pending = pendingIds.has(c.itemId)}
					<Card padding="sm">
						<div class="flex flex-col gap-2">
							<div class="text-[11px] font-semibold tracking-wider text-base-content/60 uppercase">
								{c.slot ?? ''}
							</div>
							<div class="text-sm leading-tight font-semibold">{shopItemName(c.nameKey)}</div>
							<PillButton
								size="sm"
								variant={c.equipped ? 'primary' : 'subtle'}
								disabled={pending}
								ariaPressed={c.equipped}
								onclick={() => onEquip(c.itemId, !c.equipped)}
							>
								{#if pending}<Spinner size={12} />{/if}
								{c.equipped ? m.pet_wardrobe_unequip() : m.pet_wardrobe_equip()}
							</PillButton>
						</div>
					</Card>
				{/each}
			</div>
		</section>
	{/if}

	{#if furniture.length > 0}
		<section>
			<h2 class="mb-2 text-xs font-semibold tracking-wider text-base-content/60 uppercase">
				{m.pet_wardrobe_section_furniture()}
			</h2>
			<div class="flex flex-wrap gap-2">
				{#each furniture as f (f.itemId)}
					<span
						class="rounded-full bg-base-200 px-3 py-1 text-xs font-semibold text-base-content/70"
					>
						{shopItemName(f.nameKey)}
					</span>
				{/each}
			</div>
		</section>
	{/if}

	{#if buffs.length > 0}
		<section>
			<h2 class="mb-2 text-xs font-semibold tracking-wider text-base-content/60 uppercase">
				{m.pet_wardrobe_section_buffs()}
			</h2>
			<div class="flex flex-wrap gap-2">
				{#each buffs as b (b.itemId)}
					<span
						class="rounded-full bg-base-200 px-3 py-1 text-xs font-semibold text-base-content/70"
					>
						{shopItemName(b.nameKey)}
					</span>
				{/each}
			</div>
		</section>
	{/if}
</div>
