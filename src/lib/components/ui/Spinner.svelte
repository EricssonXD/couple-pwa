<!--
  Spinner — small inline busy indicator for buttons + inline loading text.

  Hand-feel: a dotted ring (4 dots) that fades around, instead of the generic
  CSS border-spinner that screams "framework default". Animation respects
  prefers-reduced-motion via the global reset in src/routes/layout.css.

  Props:
    - size  number  diameter in px (default 14, matching icon sizes used in
                    PillButton). 14/16/20 are the common values.
    - class string  passthrough for color (default `currentColor`) and margin.
-->
<script lang="ts">
	interface Props {
		size?: number;
		class?: string;
	}
	let { size = 14, class: className = '' }: Props = $props();
</script>

<svg
	class="spinner {className}"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="currentColor"
	role="img"
	aria-hidden="true"
>
	<circle cx="12" cy="3" r="2" opacity="0.95" />
	<circle cx="21" cy="12" r="2" opacity="0.7" />
	<circle cx="12" cy="21" r="2" opacity="0.45" />
	<circle cx="3" cy="12" r="2" opacity="0.2" />
</svg>

<style>
	.spinner {
		display: inline-block;
		flex-shrink: 0;
		animation: spinner-rotate 0.9s linear infinite;
	}

	@keyframes spinner-rotate {
		to {
			transform: rotate(360deg);
		}
	}
</style>
