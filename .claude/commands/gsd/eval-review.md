---
name: gsd:eval-review
description: Audit an executed AI phase's evaluation coverage and produce an EVAL-REVIEW.md remediation plan.
argument-hint: "[phase number]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
requires: [phase]
---
<objective>
Conduct a retroactive evaluation coverage audit of a completed AI phase.
Checks whether the evaluation strategy from AI-SPEC.md was implemented.
Produces EVAL-REVIEW.md with score, verdict, gaps, and remediation plan.
</objective>

<execution_context>
@/tmp/claude-0/-home-user-trivialpursuit/01bee867-4935-5415-bada-25d22979f4ed/scratchpad/gsd/.claude/get-shit-done/workflows/eval-review.md
@/tmp/claude-0/-home-user-trivialpursuit/01bee867-4935-5415-bada-25d22979f4ed/scratchpad/gsd/.claude/get-shit-done/references/ai-evals.md
</execution_context>

<context>
Phase: $ARGUMENTS — optional, defaults to last completed phase.
</context>

<process>
Execute end-to-end.
Preserve all workflow gates.
</process>
