# New Calm Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old Equo prototype index with a fresh Calm Household + liquid-glass app preview.

**Architecture:** Implement a single static `references/index.html` with semantic HTML, scoped CSS tokens, and small vanilla JavaScript interactions. Add one Python verification script that guards against old-page regression and confirms required new visual/interaction markers.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, Python verification, Chrome headless screenshot smoke checks.

---

### Task 1: Verification Guard

**Files:**
- Create: `scripts/check-new-index.py`

- [ ] Write a failing checker that requires new-page markers and rejects old-page markers.
- [ ] Run `python scripts/check-new-index.py` and verify it fails on the old `index.html`.

### Task 2: Fresh Index

**Files:**
- Replace: `references/index.html`

- [ ] Replace the old page with a new app shell.
- [ ] Include D direction design tokens and liquid-glass animation.
- [ ] Include mobile and desktop responsive layouts.
- [ ] Include basic tab, sheet, settle, and toast interactions.

### Task 3: Verification

**Files:**
- No additional product files expected.

- [ ] Run `python scripts/check-new-index.py`.
- [ ] Run `git diff --check`.
- [ ] Serve `references/` locally and capture mobile/desktop Chrome screenshots.
