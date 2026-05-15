<script lang="ts">
	// F7 — couple-only chat. Text messages, 7-day TTL.
	//
	// History is fetched client-side (never SSR'd) so the SW + browser
	// HTML cache can't preserve message bodies past retention. Realtime
	// pushes new messages from the partner via the existing couple
	// channel; our own sends are appended optimistically, then
	// reconciled when the POST returns the canonical row.

	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { createRealtimeClient } from '$lib/client/realtime.svelte';
	import {
		CHAT_BODY_MAX_LEN,
		CHAT_HISTORY_DEFAULT_LIMIT,
		CHAT_RETENTION_DAYS
	} from '$lib/chat.constants';
	import * as m from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Notice from '$lib/components/ui/Notice.svelte';
	import { HubHeader, todayChips } from '$lib/components/duosync';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
	import type { PageData } from './$types';

	type Message = {
		id: string;
		senderId: string;
		body: string;
		createdAt: string;
		clientId?: string;
		pending?: boolean;
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

	$effect(() => {
		const ev = rt.lastChatMessage;
		if (!ev) return;
		if (messages.some((msg) => msg.id === ev.id)) return;
		messages = [
			...messages,
			{ id: ev.id, senderId: ev.senderId, body: ev.body, createdAt: ev.createdAt }
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
			const payload = (await res.json()) as {
				messages: Message[];
				nextCursor: { createdAt: string; id: string } | null;
			};
			messages = payload.messages.slice().reverse();
			nextCursor = payload.nextCursor;
			queueScrollToBottom();
		} catch (e) {
			composerError = m.chat_load_initial_error({ error: (e as Error).message });
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
			const payload = (await res.json()) as {
				messages: Message[];
				nextCursor: { createdAt: string; id: string } | null;
			};
			messages = [...payload.messages.slice().reverse(), ...messages];
			nextCursor = payload.nextCursor;
		} catch (e) {
			composerError = m.chat_load_more_error({ error: (e as Error).message });
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
		return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	}

	async function send(): Promise<void> {
		const body = composerValue.trim();
		if (body.length === 0) return;
		if (body.length > CHAT_BODY_MAX_LEN) {
			composerError = m.chat_too_long({ max: String(CHAT_BODY_MAX_LEN) });
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
					composerError = m.chat_rate_limited();
				} else {
					composerError = err.message ?? m.chat_send_failed_status({ status: String(res.status) });
				}
				messages = messages.map((msg) =>
					msg.clientId === clientId ? { ...msg, pending: false, failed: true } : msg
				);
				return;
			}
			const payload = (await res.json()) as {
				ok: true;
				message: Message;
				clientId: string | null;
			};
			messages = messages.map((msg) =>
				msg.clientId === clientId ? { ...payload.message, pending: false } : msg
			);
		} catch (e) {
			composerError = m.chat_send_failed({ error: (e as Error).message });
			messages = messages.map((msg) =>
				msg.clientId === clientId ? { ...msg, pending: false, failed: true } : msg
			);
		}
	}

	function handleKey(e: KeyboardEvent): void {
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
	<title>{m.chat_title()} — DuoSync</title>
</svelte:head>

<section class="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col pb-24">
	<HubHeader
		title={m.chat_title}
		fallbackHref="/daily"
		chips={todayChips}
		current={page.url.pathname}
	/>
	<div class="px-4 pt-1">
		<p class="mb-3 text-xs text-base-content/55">
			{m.chat_subtitle({ days: String(CHAT_RETENTION_DAYS) })}
		</p>
	</div>
	<div class="flex flex-1 flex-col px-4">
		<div bind:this={listEl} class="-mx-4 flex-1 overflow-y-auto px-4 py-2" aria-live="polite">
			{#if loading}
				<p class="my-8 text-center text-sm text-base-content/55">{m.chat_loading()}</p>
			{:else if messages.length === 0}
				<p class="my-8 text-center text-sm text-base-content/55">{m.chat_empty()}</p>
			{:else}
				{#if nextCursor}
					<button
						type="button"
						disabled={loadingMore}
						onclick={() => void loadMore()}
						class="mx-auto mb-3 block rounded-full border border-base-content/10 bg-base-100 px-3.5 py-1.5 text-[0.7rem] font-semibold tracking-wider uppercase transition-colors hover:bg-base-200 disabled:opacity-50"
					>
						{loadingMore ? m.chat_loading_more() : m.chat_load_older()}
					</button>
				{/if}
				<ul class="space-y-2">
					{#each messages as msg (msg.id)}
						{@const mine = msg.senderId === data.viewerId}
						<li class="flex {mine ? 'justify-end' : 'justify-start'}">
							<div
								class="flex max-w-[78%] flex-col gap-0.5 rounded-2xl px-3.5 py-2 {mine
									? 'bg-primary text-primary-content'
									: 'bg-base-200 text-base-content'} {msg.pending ? 'opacity-60' : ''} {msg.failed
									? 'ring-2 ring-error/60'
									: ''}"
							>
								<p class="text-sm break-words whitespace-pre-wrap">{msg.body}</p>
								<span
									class="self-end text-[0.65rem] {mine
										? 'text-primary-content/70'
										: 'text-base-content/55'}"
								>
									{fmtTime(msg.createdAt)}
									{#if msg.pending}· {m.chat_sending()}{/if}
									{#if msg.failed}· {m.chat_failed()}{/if}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if composerError}
			<Notice class="mt-2">{composerError}</Notice>
		{/if}

		<form
			class="mt-3 flex items-end gap-2 border-t border-base-content/5 pt-3"
			onsubmit={(e) => {
				e.preventDefault();
				void send();
			}}
		>
			<label for="chat-input" class="sr-only">{m.chat_input_label()}</label>
			<textarea
				id="chat-input"
				bind:value={composerValue}
				onkeydown={handleKey}
				placeholder={m.chat_input_placeholder()}
				maxlength={CHAT_BODY_MAX_LEN}
				rows={1}
				class="max-h-32 min-h-10 flex-1 resize-y rounded-2xl border border-base-content/10 bg-base-100 px-3.5 py-2 text-sm outline-none focus:border-primary"
			></textarea>
			<button
				type="submit"
				disabled={composerValue.trim().length === 0}
				aria-label={m.chat_send_btn()}
				class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-content transition-opacity disabled:opacity-50"
			>
				<Icon icon={PaperPlaneTiltIcon} size={18} weight="fill" />
			</button>
		</form>
	</div>
</section>
