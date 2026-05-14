<!--
  ShopCard — one tile in the /pet shop grid.

  Shows item name, price (paired with CoinIcon), an owned-quantity
  badge if the user has stock, and a locked overlay when stage-gated
  or unaffordable. Pet shop items are seeded in
  drizzle/manual/0022_pet.sql; the type is intentionally loose here so
  this component lands before the Phase 4 service ships.

  Props:
    - item        { id, name, price, slot? }
    - ownedQty    number
    - affordable  boolean
    - locked      boolean
    - onBuy       () => void
-->
<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import CoinIcon from './CoinIcon.svelte';
	import * as m from '$lib/paraglide/messages.js';

	interface ShopItem {
		name: string;
		price: number;
		slot?: string | null;
	}

	interface Props {
		item: ShopItem;
		ownedQty?: number;
		affordable: boolean;
		locked?: boolean;
		onBuy: () => void;
	}

	let { item, ownedQty = 0, affordable, locked = false, onBuy }: Props = $props();
</script>

<Card padding="sm" class="relative {locked ? 'opacity-50' : ''}">
	<div class="flex flex-col gap-2">
		<div class="text-[11px] font-semibold tracking-wider text-base-content/60 uppercase">
			{item.slot ?? m.pet_shop_misc()}
		</div>
		<div class="text-sm leading-tight font-semibold">{item.name}</div>
		<div class="flex items-center justify-between gap-2">
			<span class="inline-flex items-center gap-1 text-sm font-semibold tabular-nums">
				<CoinIcon size={14} />
				{item.price}
			</span>
			<PillButton
				size="sm"
				variant={affordable && !locked ? 'primary' : 'subtle'}
				disabled={!affordable || locked}
				onclick={onBuy}
			>
				<span class="sr-only">{m.pet_shop_buy_label({ name: item.name })}</span>
				<span aria-hidden="true">{m.pet_shop_buy()}</span>
			</PillButton>
		</div>
	</div>
	{#if ownedQty > 0}
		<span
			class="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-content shadow-paper"
			aria-label={m.pet_shop_owned_label({ qty: ownedQty })}
		>
			{ownedQty}
		</span>
	{/if}
	{#if locked}
		<span class="sr-only">{m.pet_shop_locked()}</span>
	{/if}
</Card>
