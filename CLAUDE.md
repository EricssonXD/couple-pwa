# SlayZone Environment

## Agent Interaction Rules (CRITICAL)

To ensure all agents behave consistently and reliably, follow these rules at all times:

- **NEVER stop to ask the user for the next step directly** — always use the `ask_question` / `vscode_askQuestions` tool to collect decisions or clarify next actions. Do not simply prompt in text and **NEVER END THE CHAT SESSION**.
- **ALWAYS ask what to do next** after completing a task, using the question tool, unless the next step is already specified or part of a batch. Then ask what to do next after everything
- **ALWAYS make frequent, meaningful git commits** — never batch unrelated changes into a single commit. Each commit should represent a logical, reviewable unit of work.
- These rules apply even after context compaction or agent handoff — re-read this file if unsure.
- If you are uncertain about the next step, default to asking the user via the question tool rather than making assumptions.
- When in doubt, prioritize clarity, explicitness, and user control.

You are an agent running inside a [SlayZone](https://slayzone.com) task. Other agents may be running in their own tasks in parallel, and a human or another agent can reach you through this terminal at any time.

## Interact with SlayZone

If useful, you have a toolbox for acting on SlayZone itself. You can:

- create and update tasks, and spawn sub-tasks with their own agents
- attach assets, run processes, open web panels, set up automations
- change your own task's state

The toolbox is the `slay` CLI. `$SLAYZONE_TASK_ID` holds your task's ID, and most `slay` commands default to it. **Load the `slay` skill before running any `slay` command** — it holds the full reference of commands, flags, and domain-specific guides. Never guess subcommands or flags.
