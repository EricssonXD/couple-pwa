<!--
  Floating "new version available" prompt.

  Subscribes to the `needRefresh` store from $lib/pwa/register. When a
  new service-worker has finished installing and is waiting, renders a
  small bottom-right pill with a "Reload" action that calls
  applyPendingUpdate(location.href) — same flow the navigation hook
  uses, just triggered manually so the user doesn't have to navigate
  away first.

  Dismiss is purposefully NOT persisted: the next page nav will silently
  apply the update anyway via beforeNavigate, so a "remind me later"
  becomes "you'll get it on your next click" — no reason to remember a
  per-session preference.
-->
<script lang="ts">
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { applyPendingUpdate, needRefresh } from '$lib/pwa/register';

	let dismissed = $state(false);
	const visible = $derived($needRefresh && !dismissed);

	let busy = $state(false);

	async function reload() {
		if (busy) return;
		busy = true;
		await applyPendingUpdate(window.location.href);
	}

	function dismiss() {
		dismissed = true;
	}
</script>

{#if visible}
	<div class="update-pill" role="status" aria-live="polite">
		<ArrowClockwiseIcon size={16} weight="duotone" />
		<span class="label">New version ready</span>
		<button type="button" class="apply" onclick={reload} disabled={busy}>
			{busy ? 'Reloading…' : 'Reload'}
		</button>
		<button type="button" class="close" aria-label="Dismiss" onclick={dismiss}>
			<XIcon size={14} weight="bold" />
		</button>
	</div>
{/if}

<style>
	.update-pill {
		position: fixed;
		bottom: calc(env(safe-area-inset-bottom, 0) + 88px);
		left: 12px;
		z-index: 40;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px 6px 12px;
		border-radius: 999px;
		background: var(--ds-color-surface, #1f2937);
		color: var(--ds-color-text, #f9fafb);
		font:
			600 12px/1 system-ui,
			sans-serif;
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.18);
		border: 1px solid var(--ds-color-border, rgb(255 255 255 / 0.12));
	}
	.label {
		white-space: nowrap;
	}
	.apply {
		appearance: none;
		border: 0;
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--ds-color-accent, #6366f1);
		color: white;
		font: inherit;
		cursor: pointer;
	}
	.apply:disabled {
		opacity: 0.7;
		cursor: progress;
	}
	.close {
		appearance: none;
		border: 0;
		background: transparent;
		color: inherit;
		padding: 4px;
		border-radius: 999px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.close:hover {
		background: rgb(255 255 255 / 0.08);
	}
</style>
