<script lang="ts">
	type Memory =
		| {
				kind: 'moment';
				id: string;
				authorId: string;
				body: string;
				lat: number;
				lon: number;
				createdAt: Date | string;
				daysAgo: number;
		  }
		| { kind: 'first_ping'; capturedAt: Date | string; daysAgo: number };

	interface Props {
		memory: Memory | null;
		viewerId: string;
		partnerName: string;
	}
	const { memory, viewerId, partnerName }: Props = $props();

	function fmtAgo(days: number): string {
		if (days < 60) return `${days} days ago`;
		if (days < 365) return `${Math.round(days / 30)} months ago`;
		const years = days / 365;
		return years >= 1.95
			? `${Math.round(years)} years ago`
			: `${Math.round(years * 10) / 10} years ago`;
	}

	function fmtDate(d: Date | string): string {
		const dt = typeof d === 'string' ? new Date(d) : d;
		return dt.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

{#if memory}
	<aside
		class="card border border-base-300/40 bg-gradient-to-br from-secondary/10 via-base-100 to-accent/10 shadow-sm"
	>
		<div class="card-body p-4">
			<header class="flex items-baseline justify-between gap-2">
				<p class="text-xs font-semibold tracking-wider text-secondary uppercase">On this day</p>
				<time class="text-xs text-base-content/60">{fmtAgo(memory.daysAgo)}</time>
			</header>
			{#if memory.kind === 'moment'}
				<p class="mt-1 text-sm leading-relaxed">
					<span class="text-base-content/70">
						{memory.authorId === viewerId ? 'You' : partnerName} dropped a moment on
						{fmtDate(memory.createdAt)}:
					</span>
					<span class="mt-1 block whitespace-pre-wrap italic">"{memory.body}"</span>
				</p>
				<a class="mt-2 link self-end text-xs link-primary" href="/moments">View moments →</a>
			{:else}
				<p class="mt-1 text-sm">
					<span class="text-base-content/70">
						You started syncing on {fmtDate(memory.capturedAt)}.
					</span>
					Still here. 💞
				</p>
			{/if}
		</div>
	</aside>
{/if}
