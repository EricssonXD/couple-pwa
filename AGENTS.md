## Agent Interaction Rules (CRITICAL)

To ensure all agents behave consistently and reliably, follow these rules at all times:

- **NEVER stop to ask the user for the next step directly** — always use the `ask_question` / `vscode_askQuestions` tool to collect decisions or clarify next actions. Do not simply prompt in text and **NEVER END THE CHAT SESSION**.
- **ALWAYS ask what to do next** after completing a task, using the question tool, unless the next step is already specified or part of a batch. Then ask what to do next after everything
- **ALWAYS make frequent, meaningful git commits** — never batch unrelated changes into a single commit. Each commit should represent a logical, reviewable unit of work.
- These rules apply even after context compaction or agent handoff — re-read this file if unsure.
- If you are uncertain about the next step, default to asking the user via the question tool rather than making assumptions.
- When in doubt, prioritize clarity, explicitness, and user control.

## Project Configuration

- **Language**: TypeScript
- **Package Manager**: bun
- **Add-ons**: prettier, eslint, vitest, playwright, sveltekit-adapter-cloudflare, tailwindcss v4, daisyui, paraglide, mcp, storybook, drizzle, supabase (auth + realtime + postgres + RLS), web-push (VAPID), bits-ui, phosphor-svelte, mdsvex

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
