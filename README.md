## 1. App Overview: "DuoSync"

**DuoSync** is a private, real-time digital sanctuary for two. It prioritizes "passive presence"—knowing where your partner is and how they are doing without needing to send a "Where are you?" text.

### Core Features

- **The Shared Pulse:** A main dashboard showing the partner's live distance, battery level, and current "mood" emoji.
- **Whisper Chat:** A real-time, lightweight messaging system with "read" receipts and typing indicators.
- **Geo-Moments:** Leave digital notes at specific coordinates (using PostGIS) that only unlock when the partner is within a certain radius.
- **Proximity Alerts:** Automatic push notifications when a partner arrives at "Home" or "Work."

### Technical Strategy

- **Framework:** SvelteKit (SSG/SSR hybrid) deployed on **Cloudflare Pages**.
- **Database:** **Supabase** with **PostGIS** enabled for spherical geography calculations.
- **Real-time:** Supabase Realtime (WebSockets) for chat and location pings.
- **Notifications:** Firebase Cloud Messaging (FCM) for the Web Push protocol.
- **Reactivity:** Svelte 5 Runes for ultra-efficient state updates.

---

## 2. Structural Plan for the AI Agent

### Phase 1: The Foundation & Auth

- Set up Supabase Auth.
- Implement the "Partner Link" logic (User A generates a unique code; User B joins).
- Create the `profiles` and `couples` database schema.

### Phase 2: The Location Engine

- Implement the Web Geolocation API service.
- Set up a Supabase RPC function to calculate the distance between two `geography(point)` coordinates.
- Create a reactive "Distance Bubble" that updates as coordinates change.

### Phase 3: Messaging & Notifications

- Build the chat UI with optimistic updates.
- Integrate the Service Worker for Web Push.
- Set up a Supabase Edge Function to trigger an FCM notification when a new message row is inserted.

---

## 3. The "Master Prompt" for your AI Agent

Copy and paste this into your AI agent (Cursor, Windsurf, or GPT-4o) to start the detailed planning phase.

```markdown
# Role: Senior Full-Stack Engineer & Svelte Expert

# Project: DuoSync - A Private Couple's Web App (PWA)

## Context

I am a Flutter developer moving to SvelteKit for this project. We are building a high-performance, mobile-first PWA for couples. The app uses SvelteKit 5, TailwindCSS, and Supabase. We must stay within the Free Tiers of Cloudflare, Supabase, and Firebase.

## Architectural Requirements

1. Use Svelte 5 Runes ($state, $derived, $effect) for all state management.
2. Use the Adapter Pattern for services (e.g., GeolocationService, NotificationService) to keep the UI logic decoupled from specific web APIs.
3. Database: Supabase PostgreSQL with PostGIS extension. Locations should be stored as 'geography(point, 4326)'.
4. Messaging: Real-time subscriptions via Supabase Realtime.
5. Deployment: Optimized for Cloudflare Pages (adapter-auto or adapter-cloudflare).

## Task: Detailed Planning & Setup

Please provide a detailed technical specification and a step-by-step implementation roadmap for the following:

1. **Database Schema:** Define the SQL for 'profiles' (linked to auth.users), 'couples' (linking two profiles), and 'locations' (storing history and current coordinates).
2. **State Management:** Design a global `$state` object for the 'Couple Session' that tracks the current user, the partner, and their real-time connection status.
3. **PWA Strategy:** Outline the Service Worker configuration for background push notifications and asset caching.
4. **Location Logic:** Draft a Supabase RPC function `get_partner_distance(user_id)` that returns the distance in meters using PostGIS.
5. **Initial File Structure:** Propose a SvelteKit directory structure that separates 'Lib/Services' from 'Routes'.
```
