<script lang="ts">
	import { goto } from '$app/navigation';

	let lat = $state<number | null>(null);
	let lon = $state<number | null>(null);
	let accuracyM = $state<number | null>(null);
	let radiusM = $state(100);
	let body = $state('');
	let busy = $state(false);
	let geoErr = $state<string | null>(null);
	let saveErr = $state<string | null>(null);

	function captureFix() {
		geoErr = null;
		if (!('geolocation' in navigator)) {
			geoErr = 'Geolocation not available in this browser.';
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				lat = pos.coords.latitude;
				lon = pos.coords.longitude;
				accuracyM = pos.coords.accuracy;
			},
			(err) => {
				geoErr = err.message;
			},
			{ enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
		);
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		saveErr = null;
		if (lat == null || lon == null) {
			saveErr = 'Capture a location first.';
			return;
		}
		const text = body.trim();
		if (text.length === 0) {
			saveErr = 'Write something.';
			return;
		}
		busy = true;
		try {
			const r = await fetch('/api/moments', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ lat, lon, radiusM, body: text })
			});
			if (!r.ok) {
				const t = await r.text().catch(() => '');
				saveErr = `Save failed: ${r.status} ${t}`;
				return;
			}
			await goto('/moments');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Drop a moment · DuoSync</title>
</svelte:head>

<div class="mx-auto max-w-md space-y-4 p-4">
	<header class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">Drop a moment</h1>
		<a class="btn btn-ghost btn-sm" href="/moments">Cancel</a>
	</header>

	<p class="text-sm opacity-70">
		Leave a short note pinned at your current location. Your partner will see the pin on their map
		but can only read the note once they walk into the radius.
	</p>

	<form class="space-y-4" onsubmit={submit}>
		<div class="space-y-2">
			<button type="button" class="btn w-full btn-outline" onclick={captureFix} disabled={busy}>
				{lat == null ? '📍 Capture current location' : '📍 Re-capture location'}
			</button>
			{#if lat != null && lon != null}
				<div class="text-xs opacity-70">
					{lat.toFixed(5)}, {lon.toFixed(5)}
					{#if accuracyM != null}· ±{Math.round(accuracyM)}m{/if}
				</div>
			{/if}
			{#if geoErr}<div class="alert text-xs alert-error">{geoErr}</div>{/if}
		</div>

		<label class="form-control w-full">
			<div class="label">
				<span class="label-text">Radius — how close they must be ({radiusM}m)</span>
			</div>
			<input
				type="range"
				min="50"
				max="1000"
				step="10"
				bind:value={radiusM}
				class="range range-primary"
			/>
		</label>

		<label class="form-control w-full">
			<div class="label">
				<span class="label-text">Note</span>
				<span class="label-text-alt opacity-70">{body.length}/280</span>
			</div>
			<textarea
				bind:value={body}
				maxlength="280"
				rows="4"
				class="textarea-bordered textarea"
				placeholder="A little something for them to find…"
			></textarea>
		</label>

		{#if saveErr}<div class="alert text-sm alert-error">{saveErr}</div>{/if}

		<button type="submit" class="btn w-full btn-primary" disabled={busy}>
			{busy ? 'Dropping…' : 'Drop moment'}
		</button>
	</form>
</div>
