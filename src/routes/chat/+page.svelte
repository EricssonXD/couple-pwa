<script lang="ts">
	// F7 — couple-only chat. Text messages, 7-day TTL.
	//
	// History is fetched client-side (never SSR'd) so the SW + browser
	// HTML cache can't preserve message bodies past retention. Realtime
	// pushes new messages from the partner via the existing couple
	// channel; our own sends are appended optimistically, then
	// reconciled when the POST returns the canonical row.

	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { createRealtimeClient } from '$lib/client/realtime.svelte';
	import {
		CHAT_BODY_MAX_LEN,
		CHAT_HISTORY_DEFAULT_LIMIT,
		CHAT_RETENTION_DAYS
	} from '$lib/chat.constants';
	import type { PageData } from './$types';

	type Message = {
		id: string;
		senderId: string;
		body: string;
		createdAt: string;
		/** Local optimistic id, present only until the server canonical id arrives. */
		clientId?: string;
		/** True while the POST is in-flight. */
		pending?: boolean;
		/** True if the POST failed and we surfaced the row as "failed". */
		failed?: boolean;
	};

	const { data }: { data: PageData } = $props();

	let messages = $state<Message[]>([]);
	let nextCursor = $state<{ createdAt: string; id: string } | null>(null);
	let loading = $state(false);
	let loadingMore = $state(false);
	let composerValue = $state('');
	let composerError = $state<string | null>(null);
	let listEl: HTMLDivElement | undefined = $state();

	const rt = createRealtimeClient(
		untrack(() => ({ coupleId: data.coupleId, userId: data.viewerId }))
	);

	onMount(() => {
		void rt.start();
		void loadInitial();
		return () => {
			void rt.stop();
		};
	});

	// Append realtime messages from the partner. We rely on Supabase's
	// `broadcast: { self: false }` to avoid receiving our own echoes,
	// but we still dedupe by id as belt-and-suspenders for multi-tab.
	$effect(() => {
		const ev = rt.lastChatMessage;
		if (!ev) return;
		if (messages.some((m) => m.id === ev.id)) return;
		messages = [
			...messages,
			{
				id: ev.id,
				senderId: ev.senderId,
				body: ev.body,
				createdAt: ev.createdAt
			}
		];
		queueScrollToBottom();
	});

	async function loadInitial(): Promise<void> {
		loading = true;
		try {
			const res = await fetch(`/api/chat?limit=${CHAT_HISTORY_DEFAULT_LIMIT}`, {
				credentials: 'same-origin'
			});
			if (!res.ok) throw new Error(`http ${res.status}`);
			const data = (await res.json()) as {
				messages: Message[];
				nextCursor: { createdAt: string; id: string } | null;
			};
			// API returns newest-first; UI shows oldest-first at the top,
			// newest at the bottom (chat-app convention).
			messages = data.messages.slice().reverse();
			nextCursor = data.nextCursor;
			queueScrollToBottom();
		} catch (e) {
			composerError = `Couldn't load chat: ${(e as Error).message}`;
		} finally {
			loading = false;
		}
	}

	async function loadMore(): Promise<void> {
		if (loadingMore || !nextCursor) return;
		loadingMore = true;
		try {
			const cursor = `${nextCursor.createdAt}:${nextCursor.id}`;
			const res = await fetch(
				`/api/chat?limit=${CHAT_HISTORY_DEFAULT_LIMIT}&before=${encodeURIComponent(cursor)}`,
				{ credentials: 'same-origin' }
			);
			if (!res.ok) throw new Error(`http ${res.status}`);
			const data = (await res.json()) as {
				messages: Message[];
				nextCursor: { createdAt: string; id: string } | null;
			};
			messages = [...data.messages.slice().reverse(), ...messages];
			nextCursor = data.nextCursor;
		} catch (e) {
			composerError = `Couldn't load older messages: ${(e as Error).message}`;
		} finally {
			loadingMore = false;
		}
	}

	function queueScrollToBottom(): void {
		queueMicrotask(() => {
			if (listEl) listEl.scrollTop = listEl.scrollHeight;
		});
	}

	function genClientId(): string {
		// Avoid crypto.randomUUID dependency (Safari < 15.4); good enough
		// as a temporary local id.
		return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	}

	async function send(): Promise<void> {
		const body = composerValue.trim();
		if (body.length === 0) return;
		if (body.length > CHAT_BODY_MAX_LEN) {
			composerError = `Message is too long (max ${CHAT_BODY_MAX_LEN} characters).`;
			return;
		}
		composerError = null;
		const clientId = genClientId();
		const optimistic: Message = {
			id: clientId,
			clientId,
			senderId: data.viewerId,
			body,
			createdAt: new Date().toISOString(),
			pending: true
		};
		messages = [...messages, optimistic];
		composerValue = '';
		queueScrollToBottom();
		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ body, clientId })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}) as Record<string, string>);
				if (res.status === 429) {
					composerError = `Slow down — try again in a moment.`;
				} else {
					composerError = err.message ?? `Send failed (HTTP ${res.status}).`;
				}
				messages = messages.map((m) =>
					m.clientId === clientId ? { ...m, pending: false, failed: true } : m
				);
				return;
			}
			const payload = (await res.json()) as {
				ok: true;
				message: Message;
				clientId: string | null;
			};
			messages = messages.map((m) =>
				m.clientId === clientId
					? {
							...payload.message,
							pending: false
						}
					: m
			);
		} catch (e) {
			composerError = `Send failed: ${(e as Error).message}`;
			messages = messages.map((m) =>
				m.clientId === clientId ? { ...m, pending: false, failed: true } : m
			);
		}
	}

	function handleKey(e: KeyboardEvent): void {
		// Enter sends; Shift+Enter inserts a newline.
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	}

	function fmtTime(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}
</script>

<svelte:head>
	<title>Chat — DuoSync</title>
</svelte:head>

<section class="chat">
	<header class="chat__header">
		<a class="chat__back" href={resolve('/pulse')} aria-label="Back to pulse">←</a>
		<h1>Chat</h1>
		<p class="chat__subtitle">Messages disappear after {CHAT_RETENTION_DAYS} days.</p>
	</header>

	<div bind:this={listEl} class="chat__list" aria-live="polite">
		{#if loading}
			<p class="chat__empty">Loading…</p>
		{:else if messages.length === 0}
			<p class="chat__empty">No messages yet. Say hi 👋</p>
		{:else}
			{#if nextCursor}
				<button
					type="button"
					class="chat__loadmore"
					disabled={loadingMore}
					onclick={() => void loadMore()}
				>
					{loadingMore ? 'Loading…' : 'Load older messages'}
				</button>
			{/if}
			<ul class="chat__bubbles">
				{#each messages as m (m.id)}
					<li class="chat__row {m.senderId === data.viewerId ? 'mine' : 'theirs'}">
						<div class="chat__bubble" class:pending={m.pending} class:failed={m.failed}>
							<p class="chat__body">{m.body}</p>
							<span class="chat__meta">
								{fmtTime(m.createdAt)}
								{#if m.pending}· sending…{/if}
								{#if m.failed}· failed{/if}
							</span>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if composerError}
		<p class="chat__error" role="alert">{composerError}</p>
	{/if}

	<form
		class="chat__composer"
		onsubmit={(e) => {
			e.preventDefault();
			void send();
		}}
	>
		<label class="chat__label" for="chat-input">Your message</label>
		<textarea
			id="chat-input"
			class="chat__input"
			bind:value={composerValue}
			onkeydown={handleKey}
			placeholder="Type a message…"
			maxlength={CHAT_BODY_MAX_LEN}
			rows="2"
		></textarea>
		<button type="submit" class="chat__send" disabled={composerValue.trim().length === 0}>
			Send
		</button>
	</form>
</section>

<style>
	.chat {
		display: flex;
		flex-direction: column;
		max-width: 640px;
		margin: 0 auto;
		padding: 1rem;
		min-height: calc(100vh - 4rem);
	}
	.chat__header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
	}
	.chat__back {
		text-decoration: none;
		color: var(--color-fg-muted, #888);
		font-size: 1.5rem;
		line-height: 1;
	}
	.chat__header h1 {
		margin: 0;
		font-size: 1.5rem;
	}
	.chat__subtitle {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-fg-muted, #888);
	}
	.chat__list {
		flex: 1 1 auto;
		overflow-y: auto;
		padding: 0.5rem 0;
		min-height: 200px;
	}
	.chat__empty {
		text-align: center;
		color: var(--color-fg-muted, #888);
		margin: 2rem 0;
	}
	.chat__loadmore {
		display: block;
		margin: 0 auto 0.75rem;
		padding: 0.35rem 0.75rem;
		background: transparent;
		border: 1px solid var(--color-border, #ccc);
		border-radius: 999px;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.chat__bubbles {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.chat__row {
		display: flex;
	}
	.chat__row.mine {
		justify-content: flex-end;
	}
	.chat__row.theirs {
		justify-content: flex-start;
	}
	.chat__bubble {
		max-width: 75%;
		padding: 0.5rem 0.75rem;
		border-radius: 1rem;
		background: var(--color-bg-elev, #f0f0f0);
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.chat__row.mine .chat__bubble {
		background: var(--color-accent, #d8b4fe);
		color: var(--color-accent-fg, #1a1a1a);
	}
	.chat__bubble.pending {
		opacity: 0.6;
	}
	.chat__bubble.failed {
		outline: 1px solid var(--color-danger, #c0392b);
	}
	.chat__body {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.95rem;
	}
	.chat__meta {
		font-size: 0.7rem;
		color: var(--color-fg-muted, #888);
		align-self: flex-end;
	}
	.chat__row.mine .chat__meta {
		color: rgb(0 0 0 / 0.55);
	}
	.chat__error {
		margin: 0.25rem 0;
		padding: 0.5rem 0.75rem;
		background: rgb(192 57 43 / 0.1);
		color: var(--color-danger, #c0392b);
		border-radius: 0.5rem;
		font-size: 0.85rem;
	}
	.chat__composer {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.5rem;
		align-items: end;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border, #ddd);
	}
	.chat__label {
		grid-column: 1 / -1;
		font-size: 0.75rem;
		color: var(--color-fg-muted, #888);
		display: none;
	}
	.chat__input {
		resize: vertical;
		min-height: 2.5rem;
		max-height: 8rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.75rem;
		border: 1px solid var(--color-border, #ccc);
		font: inherit;
		background: var(--color-bg, #fff);
		color: var(--color-fg, #1a1a1a);
	}
	.chat__send {
		padding: 0.5rem 1rem;
		border-radius: 0.75rem;
		border: 0;
		background: var(--color-accent, #d8b4fe);
		color: var(--color-accent-fg, #1a1a1a);
		font-weight: 600;
		cursor: pointer;
	}
	.chat__send:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
