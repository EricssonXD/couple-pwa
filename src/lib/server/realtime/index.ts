/**
 * Resolves the active RealtimeAdapter. For now we always use the in-process
 * impl (works for `bun run dev` and any single-instance Node prod). When we
 * deploy to Cloudflare Workers in Phase 9, swap this for a Durable Object
 * routing adapter behind the same interface.
 */

import { ensureSweeper, inProcessAdapter } from './in-process';
import type { RealtimeAdapter } from './adapter';

ensureSweeper();

export const realtime: RealtimeAdapter = inProcessAdapter;
export type { RealtimeAdapter };
