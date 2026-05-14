<!--
  ShopCard — one tile in the /pet shop grid.

  Takes a ShopItemView (catalogue row joined with this couple's
  ownership/lock state) and resolves the visible name via
  shopItemName(nameKey) so the seed and i18n stay decoupled.

  Renders a visible Notice for locked items so the unlock condition
  is human-readable rather than just a dimmed tile.

  Props:
    item        ShopItemView
    coins       current wallet balance
    pending     true while the buy POST is in flight
    onBuy       () => void
-->
<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import Notice from '$lib/components/ui/Notice.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import CoinIcon from './CoinIcon.svelte';
	import { shopItemName } from './shop-i18n';
	import type { ShopItemView } from '$lib/pet.constants';
	import * as m from '$lib/paraglide/messages.js';

	interface Props {
		item: ShopItemView;
		coins: number;
		pending?: boolean;
		onBuy: () => void;
	}

	let { item, coins, pending = false, onBuy }: Props = $props();

	const displayName = $derived(shopItemName(item.nameKey));
	const affordable = $derived(coins >= item.priceCoins);
	const locked = $derived(!item.unlocked);
	// Cosmetics/furniture/buffs are one-and-done; treats can re-buy.
	const ownedAndUnique = $derived(item.kind !== 'treat' && item.ownedQty > 0);
	const buyDisabled = $derived(pending || locked || !affordable || ownedAndUnique);
	const slotLabel = $derived(item.slot ?? m.pet_shop_misc());
	const lockedMsg = $derived(
		item.minStage === 'baby' ? m.pet_shop_unlocks_at_baby() : m.pet_shop_unlocks_at_grown()
	);
</script>

<Card padding="sm" class="relative {locked ? 'opacity-60' : ''}">
	<div class="flex flex-col gap-2">
		<div class="text-[11px] font-semibold tracking-wider text-base-content/60 uppercase">
			{slotLabel}
		</div>
		<div class="text-sm leading-tight font-semibold">{displayName}</div>
		<div class="flex items-center justify-between gap-2">
			<span class="inline-flex items-center gap-1 text-sm font-semibold tabular-nums">
				<CoinIcon size={14} />
				{item.priceCoins}
			</span>
			<PillButton
				size="sm"
				variant={!buyDisabled ? 'primary' : 'subtle'}
				disabled={buyDisabled}
				onclick={onBuy}
			>
				{#if pending}<Spinner size={12} />{/if}
				<span class="sr-only">{m.pet_shop_buy_label({ name: displayName })}</span>
				<span aria-hidden="true">
					{ownedAndUnique ? m.pet_shop_owned_label({ qty: item.ownedQty }) : m.pet_shop_buy()}
				</span>
			</PillButton>
		</div>
		{#if locked}
			<Notice tone="info" class="!mt-1 !py-1.5 !text-xs">{lockedMsg}</Notice>
		{:else if !affordable && !ownedAndUnique}
			<Notice tone="info" class="!mt-1 !py-1.5 !text-xs">{m.pet_shop_unaffordable()}</Notice>
		{/if}
	</div>
	{#if item.kind === 'treat' && item.ownedQty > 0}
		<span
			class="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-content shadow-paper"
			aria-label={m.pet_shop_owned_label({ qty: item.ownedQty })}
		>
			{item.ownedQty}
		</span>
	{/if}
</Card>
