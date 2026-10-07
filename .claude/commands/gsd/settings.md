---
name: gsd:settings
description: Configure GSD workflow toggles and model profile
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
requires: [quick]
---

<objective>
Interactive configuration of GSD workflow agents and model profile via multi-question prompt.

Routes to the settings workflow which handles:
- Config existence ensuring
- Current settings reading and parsing
- Interactive 5-question prompt (model, research, plan_check, verifier, branching)
- Config merging and writing
- Confirmation display with quick command references
</objective>

<execution_context>
@/tmp/claude-0/-home-user-trivialpursuit/01bee867-4935-5415-bada-25d22979f4ed/scratchpad/gsd/.claude/get-shit-done/workflows/settings.md
</execution_context>

<process>
Execute end-to-end.
</process>
