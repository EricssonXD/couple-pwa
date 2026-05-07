/**
 * DuoSync motion primitives — public exports.
 *
 * CSS keyframes live in ./animations.css and must be imported once
 * globally (currently from src/routes/+layout.svelte).
 */

export { vibrate, TAP_LIGHT, TAP_HEARTBEAT, BUZZ_ALERT, BUZZ_BLOOM } from './vibrate';
export type { VibratePattern } from './vibrate';

export { createHeartbeat } from './heartbeat.svelte';
export type { HeartbeatRipple, HeartbeatOptions } from './heartbeat.svelte';
