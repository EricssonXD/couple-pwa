<!--
	RotatePrompt — F11 U3.

	Full-bleed overlay shown when the user wants to capture an hourly
	clip while the device is in portrait. Listens to orientation
	changes and self-dismisses by calling `onlandscape` once the device
	rotates. An "Record anyway" escape hatch keeps the path open for
	desktop / locked-orientation cases.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import DeviceMobileIcon from 'phosphor-svelte/lib/DeviceMobile';
	import { onOrientationChange, readOrientation } from '$lib/hourly/orientation';

	interface Props {
		/** Called once the device reports landscape, OR when the user taps "Record anyway". */
		onlandscape: () => void;
		oncancel?: () => void;
	}

	let { onlandscape, oncancel }: Props = $props();

	$effect(() => {
		if (readOrientation() === 'landscape') {
			onlandscape();
			return;
		}
		return onOrientationChange((next) => {
			if (next === 'landscape') onlandscape();
		});
	});
</script>

<div
	class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-base-100/95 p-8 text-center backdrop-blur-md"
	role="dialog"
	aria-modal="true"
	aria-labelledby="rotate-prompt-title"
>
	<DeviceMobileIcon size={64} class="rotate-90 text-primary" />
	<h2 id="rotate-prompt-title" class="text-lg font-semibold">
		{m.hourly_rotate_prompt_title()}
	</h2>
	<p class="max-w-xs text-sm text-base-content/70">
		{m.hourly_rotate_prompt_body()}
	</p>
	<div class="flex flex-col items-stretch gap-2">
		<PillButton variant="primary" onclick={onlandscape}>
			{m.hourly_rotate_prompt_skip()}
		</PillButton>
		{#if oncancel}
			<PillButton variant="ghost" onclick={oncancel}>{m.common_cancel()}</PillButton>
		{/if}
	</div>
</div>
