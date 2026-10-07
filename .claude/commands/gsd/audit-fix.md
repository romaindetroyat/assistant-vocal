---
type: prompt
name: gsd:audit-fix
description: Autonomous audit-to-fix pipeline — find issues, classify, fix, test, commit
argument-hint: "--source <audit-uat> [--severity <medium|high|all>] [--max N] [--dry-run]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
requires: [audit-uat]
---
<objective>
Run an audit, classify findings as auto-fixable vs manual-only, then autonomously fix
auto-fixable issues with test verification and atomic commits.

Flags:
- `--max N` — maximum findings to fix (default: 5)
- `--severity high|medium|all` — minimum severity to process (default: medium)
- `--dry-run` — classify findings without fixing (shows classification table)
- `--source <audit>` — which audit to run (default: audit-uat)
</objective>

<execution_context>
@/tmp/claude-0/-home-user-trivialpursuit/01bee867-4935-5415-bada-25d22979f4ed/scratchpad/gsd/.claude/get-shit-done/workflows/audit-fix.md
</execution_context>

<process>
Execute end-to-end.
</process>
