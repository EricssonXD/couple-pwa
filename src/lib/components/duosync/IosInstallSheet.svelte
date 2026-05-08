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

<BottomSheet bind:open title="Install DuoSync">
	{#if mode === 'safari'}
		<p class="text-base-content/70 mb-4 text-sm">
			Add DuoSync to your Home Screen for instant launch, full-screen view, and push
			notifications when your partner pings you.
		</p>

		<ol class="space-y-4">
			<li class="flex items-start gap-3">
				<span class="step">1</span>
				<div class="flex-1">
					<p class="text-sm">
						Tap the <strong>Share</strong> button in Safari's bottom bar.
					</p>
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
					<p class="text-sm">
						Scroll and choose <strong>Add to Home Screen</strong>.
					</p>
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
					<p class="text-sm">
						Tap <strong>Add</strong> in the top-right corner.
					</p>
				</div>
			</li>
		</ol>
	{:else}
		<p class="text-base-content/70 mb-3 text-sm">
			This browser can't add apps to the iPhone Home Screen — only Safari can. Open this page
			in Safari to install.
		</p>
		<p class="text-base-content/50 text-xs">
			Tip: tap the <strong>···</strong> menu, then <strong>Open in Safari</strong>.
		</p>
	{/if}

	<div class="mt-5 flex gap-2">
		<button class="btn btn-ghost flex-1" onclick={() => (open = false)}>Maybe later</button>
		<button class="btn btn-primary flex-1" onclick={dismiss}>Got it</button>
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
