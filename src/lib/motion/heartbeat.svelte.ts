/**
 * DuoSync heartbeat tap detector.
 *
 * Detects two taps within `windowMs` on a single element and yields a
 * ripple effect at the second tap's coordinates. Caller subscribes to
 * `ripples` (Svelte 5 $state) and renders a span per entry styled with
 * `.animate-ripple` from $lib/motion/animations.css.
 *
 * Usage:
 *   <script>
 *     import { createHeartbeat } from '$lib/motion/heartbeat.svelte';
 *     const heartbeat = createHeartbeat({ onTap: () => sendTap() });
 *   </script>
 *   <div use:heartbeat.action>
 *     {#each heartbeat.ripples as r (r.id)}
 *       <span class="animate-ripple" style="left:{r.x}px;top:{r.y}px"></span>
 *     {/each}
 *   </div>
 */

import { vibrate, TAP_HEARTBEAT } from './vibrate';

export type HeartbeatRipple = {
	id: number;
	x: number;
	y: number;
};

export type HeartbeatOptions = {
	/** Max ms between the two taps to count as a heartbeat. Default 350. */
	windowMs?: number;
	/** Ms before a spawned ripple is removed from state. Default 900. */
	rippleLifetimeMs?: number;
	/** Called once per detected double-tap. */
	onTap?: () => void;
	/** Override the haptic pattern. Pass `null` to disable haptics. */
	hapticPattern?: number | number[] | null;
};

export function createHeartbeat(opts: HeartbeatOptions = {}) {
	const windowMs = opts.windowMs ?? 350;
	const lifetime = opts.rippleLifetimeMs ?? 900;
	const haptic = opts.hapticPattern === undefined ? TAP_HEARTBEAT : opts.hapticPattern;

	let ripples = $state<HeartbeatRipple[]>([]);
	let lastTapAt = 0;
	let nextId = 1;

	function spawn(x: number, y: number) {
		const id = nextId++;
		ripples = [...ripples, { id, x, y }];
		setTimeout(() => {
			ripples = ripples.filter((r) => r.id !== id);
		}, lifetime);
	}

	function handle(ev: PointerEvent) {
		const now = performance.now();
		if (now - lastTapAt <= windowMs) {
			lastTapAt = 0;
			const target = ev.currentTarget as HTMLElement;
			const rect = target.getBoundingClientRect();
			spawn(ev.clientX - rect.left, ev.clientY - rect.top);
			if (haptic !== null) vibrate(haptic);
			opts.onTap?.();
		} else {
			lastTapAt = now;
		}
	}

	function action(node: HTMLElement) {
		node.addEventListener('pointerdown', handle);
		return {
			destroy() {
				node.removeEventListener('pointerdown', handle);
			}
		};
	}

	return {
		get ripples() {
			return ripples;
		},
		action
	};
}
