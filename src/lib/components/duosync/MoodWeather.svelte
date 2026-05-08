<!--
  MoodWeather — partner's mood expressed as a weather glyph.

  The brief positions mood as ambient texture, not data — the couple
  shouldn't have to interpret an emoji decision tree. Four buckets:

    sunny   — content / happy
    cloudy  — neutral / tired
    rainy   — sad / low
    night   — sleeping / quiet

  Use a `partnerName` prop so the caption naturally reads
  "Mira feels sunny" without coupling to i18n keys here. The parent
  page is responsible for localizing the mood label if needed.
-->
<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { SunIcon, CloudIcon, CloudRainIcon, MoonIcon } from '$lib/components/ui/icons';
	import * as m from '$lib/paraglide/messages.js';

	export type Mood = 'sunny' | 'cloudy' | 'rainy' | 'night';

	type Props = {
		mood: Mood;
		partnerName?: string;
		caption?: string | null;
	};

	let { mood, partnerName, caption = null }: Props = $props();

	const config: Record<Mood, { icon: typeof SunIcon; tone: string }> = {
		sunny: { icon: SunIcon, tone: 'text-accent' },
		cloudy: { icon: CloudIcon, tone: 'text-info' },
		rainy: { icon: CloudRainIcon, tone: 'text-info' },
		night: { icon: MoonIcon, tone: 'text-base-content/60' }
	};

	const c = $derived(config[mood]);
	const label = $derived(
		mood === 'sunny'
			? m.mood_sunny()
			: mood === 'cloudy'
				? m.mood_cloudy()
				: mood === 'rainy'
					? m.mood_rainy()
					: m.mood_night()
	);
	const text = $derived(caption ?? (partnerName ? `${partnerName} · ${label}` : label));
</script>

<div
	class="bg-base-200/60 inline-flex items-center gap-2 rounded-full px-3 py-1.5 backdrop-blur"
	aria-label="Partner mood: {label}"
>
	<Icon icon={c.icon} size={20} weight="duotone" class={c.tone} />
	<span class="text-base-content/80 text-sm">{text}</span>
</div>
