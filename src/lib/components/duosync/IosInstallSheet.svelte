<!--
  DuoSync IosInstallSheet — guided Add-to-Home-Screen for iOS.

  Apple's Safari does not fire `beforeinstallprompt`, so installing a
  PWA on iPhone/iPad is a 3-tap manual flow. This sheet walks the user
  through it with inline SVG glyphs of the actual iOS UI affordances
  (share-arrow box, Add-to-Home icon).

  Two modes:
    - 'safari'      → 3 numbered steps + tappable share/add icons
    - 'non-safari'  → soft prompt to switch to Safari (Chrome/Firefox
                      iOS can't install — Apple-only restriction)

  Props:
    open  (bindable boolean) — sheet visibility
    mode  ('safari' | 'non-safari') — which copy + glyphs to render

  Dismissal is persisted by the caller via dismissIosInstallHint().
-->
<script lang="ts">
	import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
	import { dismissIosInstallHint } from '$lib/pwa/ios-install';
	import * as m from '$lib/paraglide/messages.js';

	type Props = {
		open: boolean;
		mode: 'safari' | 'non-safari';
	};

	let { open = $bindable(false), mode }: Props = $props();

	function dismiss() {
		dismissIosInstallHint();
		open = false;
	}
</script>

<BottomSheet bind:open title={m.welcome_install()}>
	{#if mode === 'safari'}
		<p class="mb-4 text-sm text-base-content/70">
			{m.ios_install_intro()}
		</p>

		<ol class="space-y-4">
			<li class="flex items-start gap-3">
				<span class="step">1</span>
				<div class="flex-1">
					<!-- Translated copy intentionally contains <strong> markup. -->
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<p class="text-sm">{@html m.ios_install_step1_inline_html()}</p>
					<div class="glyph mt-2">
						<!-- iOS share-arrow box -->
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path
								d="M12 3v12m0-12-3.5 3.5M12 3l3.5 3.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</div>
				</div>
			</li>

			<li class="flex items-start gap-3">
				<span class="step">2</span>
				<div class="flex-1">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<p class="text-sm">{@html m.ios_install_step2_inline_html()}</p>
					<div class="glyph mt-2">
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<rect
								x="4"
								y="4"
								width="16"
								height="16"
								rx="3.5"
								stroke="currentColor"
								stroke-width="1.6"
							/>
							<path
								d="M12 8v8M8 12h8"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
							/>
						</svg>
					</div>
				</div>
			</li>

			<li class="flex items-start gap-3">
				<span class="step">3</span>
				<div class="flex-1">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<p class="text-sm">{@html m.ios_install_step3_inline_html()}</p>
				</div>
			</li>
		</ol>
	{:else}
		<p class="mb-3 text-sm text-base-content/70">
			{m.ios_install_non_safari()}
		</p>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<p class="text-xs text-base-content/50">{@html m.ios_install_inapp_hint_html()}</p>
	{/if}

	<div class="mt-5 flex gap-2">
		<button class="btn flex-1 btn-ghost" onclick={() => (open = false)}
			>{m.ios_install_later()}</button
		>
		<button class="btn flex-1 btn-primary" onclick={dismiss}>{m.ios_install_got_it()}</button>
	</div>
</BottomSheet>

<style>
	.step {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9999px;
		background: var(--color-primary);
		color: var(--color-primary-content);
		font-weight: 600;
		font-size: 0.85rem;
		flex-shrink: 0;
	}
	.glyph {
		display: inline-grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0.35rem;
		border-radius: var(--radius-card);
		background: var(--color-base-200);
		color: var(--color-primary);
	}
	.glyph svg {
		width: 100%;
		height: 100%;
	}
</style>
