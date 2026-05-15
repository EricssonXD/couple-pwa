// Maps ledger row sources → human paraglide strings. Source codes
// either come straight from EARN_SOURCES (e.g. 'mood_log') or are a
// composite like 'buy:hat_paper_crown', 'treat:treat_cake',
// 'buff:buff_doublecoin'. Two specials: 'welcome_back' and
// 'reconcile' (P5.3 reconciliation).
//
// Unknown codes fall back to the raw string so the strip degrades
// visibly rather than going blank — same defensive pattern as
// shop-i18n.ts.

import * as m from '$lib/paraglide/messages.js';
import { shopItemName } from './shop-i18n';

const SHOP_ITEM_NAME_KEYS: Record<string, string> = {
	hat_paper_crown: 'shop_item_hat_paper_crown_name',
	hat_beanie: 'shop_item_hat_beanie_name',
	scarf_red: 'shop_item_scarf_red_name',
	scarf_dotted: 'shop_item_scarf_dotted_name',
	expr_sleepy: 'shop_item_expr_sleepy_name',
	treat_strawberry: 'shop_item_treat_strawberry_name',
	treat_dumpling: 'shop_item_treat_dumpling_name',
	treat_cake: 'shop_item_treat_cake_name',
	furn_rug: 'shop_item_furn_rug_name',
	furn_window: 'shop_item_furn_window_name',
	buff_doublecoin: 'shop_item_buff_doublecoin_name',
	buff_xpboost: 'shop_item_buff_xpboost_name'
};

function itemDisplayName(itemId: string): string {
	const key = SHOP_ITEM_NAME_KEYS[itemId];
	return key ? shopItemName(key) : itemId;
}

export function ledgerSourceLabel(source: string): string {
	switch (source) {
		case 'daily_send':
			return m.pet_ledger_source_daily_send();
		case 'daily_reveal':
			return m.pet_ledger_source_daily_reveal();
		case 'mood_log':
			return m.pet_ledger_source_mood_log();
		case 'quiz_complete':
			return m.pet_ledger_source_quiz_complete();
		case 'bucket_complete':
			return m.pet_ledger_source_bucket_complete();
		case 'repair_complete':
			return m.pet_ledger_source_repair_complete();
		case 'anniversary':
			return m.pet_ledger_source_anniversary();
		case 'welcome_back':
			return m.pet_ledger_source_welcome_back();
		case 'reconcile':
			return m.pet_ledger_source_reconcile();
	}
	// Reconcile rows include the signed delta in the source, e.g.
	// 'reconcile:+5' or 'reconcile:-2'. Strip the suffix for display.
	if (source.startsWith('reconcile:')) {
		return m.pet_ledger_source_reconcile();
	}
	if (source.startsWith('buy:')) {
		return m.pet_ledger_source_buy({ name: itemDisplayName(source.slice(4)) });
	}
	if (source.startsWith('treat:')) {
		return m.pet_ledger_source_treat({ name: itemDisplayName(source.slice(6)) });
	}
	if (source.startsWith('buff:')) {
		return m.pet_ledger_source_buff({ name: itemDisplayName(source.slice(5)) });
	}
	return m.pet_ledger_source_unknown({ code: source });
}

/**
 * Format a ledger row's createdAt as a coarse relative-time string.
 * "just now" < 1 min, then "Nm ago", "Nh ago", "Nd ago". Anything
 * over 30d collapses to "30d+ ago" via the days bucket — fine for
 * an activity strip; the diagnostics view shows absolute timestamps.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return iso;
	const diffMs = Math.max(0, now.getTime() - then);
	const min = Math.floor(diffMs / 60_000);
	if (min < 1) return m.pet_ledger_relative_just_now();
	if (min < 60) return m.pet_ledger_relative_minutes({ n: String(min) });
	const hr = Math.floor(min / 60);
	if (hr < 24) return m.pet_ledger_relative_hours({ n: String(hr) });
	const day = Math.floor(hr / 24);
	return m.pet_ledger_relative_days({ n: String(day) });
}
