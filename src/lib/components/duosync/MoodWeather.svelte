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
	import SunIcon from 'phosphor-svelte/lib/SunIcon';
	import CloudIcon from 'phosphor-svelte/lib/CloudIcon';
	import CloudRainIcon from 'phosphor-svelte/lib/CloudRainIcon';
	import MoonIcon from 'phosphor-svelte/lib/MoonIcon';

	export type Mood = 'sunny' | 'cloudy' | 'rainy' | 'night';

	type Props = {
		mood: Mood;
		partnerName?: string;
		caption?: string | null;
	};

	let { mood, partnerName, caption = null }: Props = $props();

	const config: Record<Mood, { icon: typeof SunIcon; tone: string; label: string }> = {
		sunny: { icon: SunIcon, tone: 'text-accent', label: '晴 · sunny' },
		cloudy: { icon: CloudIcon, tone: 'text-info', label: '陰 · cloudy' },
		rainy: { icon: CloudRainIcon, tone: 'text-info', label: '雨 · rainy' },
		night: { icon: MoonIcon, tone: 'text-base-content/60', label: '夜 · resting' }
	};

	const c = $derived(config[mood]);
	const text = $derived(caption ?? (partnerName ? `${partnerName} · ${c.label}` : c.label));
</script>

<div
	class="bg-base-200/60 inline-flex items-center gap-2 rounded-full px-3 py-1.5 backdrop-blur"
	aria-label="Partner mood: {c.label}"
>
	<Icon icon={c.icon} size={20} weight="duotone" class={c.tone} />
	<span class="text-base-content/80 text-sm">{text}</span>
</div>
