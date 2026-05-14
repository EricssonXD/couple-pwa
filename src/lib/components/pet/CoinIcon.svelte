<!--
  CoinIcon — single source of truth for the Cozy Coin glyph.

  Hand-drawn paper coin with a soft inner gleam. Inline SVG (no asset
  fetch) so it can sit next to numbers without layout shift. Always
  pair with an adjacent number — this icon is decorative, the number
  is the meaning, so we ship it `aria-hidden="true"`.

  Props:
    - size   diameter in px (default 16, matching tabular-nums baseline)
    - class  passthrough for tint / margin
-->
<script lang="ts">
	interface Props {
		size?: number;
		class?: string;
	}
	let { size = 16, class: className = '' }: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	class={className}
	aria-hidden="true"
	focusable="false"
>
	<circle cx="12" cy="12" r="9.5" fill="#f4c66b" stroke="#b9881f" stroke-width="1.4" />
	<circle cx="12" cy="12" r="6.5" fill="none" stroke="#b9881f" stroke-width="1" opacity="0.5" />
	<path
		d="M9 9.5q3-1.5 6 0M9 14.5q3 1.5 6 0"
		fill="none"
		stroke="#7a5a13"
		stroke-width="1.2"
		stroke-linecap="round"
		opacity="0.55"
	/>
	<text
		x="12"
		y="15.5"
		font-family="ui-sans-serif, system-ui, sans-serif"
		font-size="9"
		font-weight="700"
		fill="#5a4209"
		text-anchor="middle">¢</text
	>
</svg>
