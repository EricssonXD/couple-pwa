// Maps shop item nameKey/descriptionKey strings (as stored in
// pet_shop_item.name_key / description_key) to their compiled
// paraglide message functions. Maps by *key string* — not by item id —
// so the seed and i18n stay decoupled (rubber-duck P4 critique).
//
// The Record is exhaustive over the 12 currently-seeded items; if the
// seed adds a new item without adding both messages, the typed lookup
// falls back to the raw key so the UI degrades visibly rather than
// silently rendering blank.

import * as m from '$lib/paraglide/messages.js';

type MessageFn = () => string;

const NAMES: Record<string, MessageFn> = {
	shop_item_hat_paper_crown_name: m.shop_item_hat_paper_crown_name,
	shop_item_hat_beanie_name: m.shop_item_hat_beanie_name,
	shop_item_scarf_red_name: m.shop_item_scarf_red_name,
	shop_item_scarf_dotted_name: m.shop_item_scarf_dotted_name,
	shop_item_expr_sleepy_name: m.shop_item_expr_sleepy_name,
	shop_item_treat_strawberry_name: m.shop_item_treat_strawberry_name,
	shop_item_treat_dumpling_name: m.shop_item_treat_dumpling_name,
	shop_item_treat_cake_name: m.shop_item_treat_cake_name,
	shop_item_furn_rug_name: m.shop_item_furn_rug_name,
	shop_item_furn_window_name: m.shop_item_furn_window_name,
	shop_item_buff_doublecoin_name: m.shop_item_buff_doublecoin_name,
	shop_item_buff_xpboost_name: m.shop_item_buff_xpboost_name
};

const DESCRIPTIONS: Record<string, MessageFn> = {
	shop_item_hat_paper_crown_desc: m.shop_item_hat_paper_crown_desc,
	shop_item_hat_beanie_desc: m.shop_item_hat_beanie_desc,
	shop_item_scarf_red_desc: m.shop_item_scarf_red_desc,
	shop_item_scarf_dotted_desc: m.shop_item_scarf_dotted_desc,
	shop_item_expr_sleepy_desc: m.shop_item_expr_sleepy_desc,
	shop_item_treat_strawberry_desc: m.shop_item_treat_strawberry_desc,
	shop_item_treat_dumpling_desc: m.shop_item_treat_dumpling_desc,
	shop_item_treat_cake_desc: m.shop_item_treat_cake_desc,
	shop_item_furn_rug_desc: m.shop_item_furn_rug_desc,
	shop_item_furn_window_desc: m.shop_item_furn_window_desc,
	shop_item_buff_doublecoin_desc: m.shop_item_buff_doublecoin_desc,
	shop_item_buff_xpboost_desc: m.shop_item_buff_xpboost_desc
};

export function shopItemName(nameKey: string): string {
	return NAMES[nameKey]?.() ?? nameKey;
}

export function shopItemDesc(descriptionKey: string): string {
	return DESCRIPTIONS[descriptionKey]?.() ?? descriptionKey;
}
