# New Calm Index Design

## Scope

Rebuild `references/index.html` as a fresh mobile-first Equo app preview. Do not reuse the old page structure, old visual palette, old glass-gradient treatment, or the monolithic inline JavaScript app.

## Chosen Direction

Use the approved D direction: Calm Household with iOS-style liquid glass. The product subject is shared household and friend-group expenses. The page's job is to let a person understand the month, see who needs action, and add or settle an expense without feeling like they are inside a finance dashboard.

## Visual System

- Colors: mist `#f6f5ef`, ink `#23323b`, sage `#5a7563`, water `#dce8ec`, clay `#c8b7a1`.
- Type: system UI stack with restrained large numerals and clear Chinese labels.
- Layout: a compact app shell with a home dashboard, group view, activity view, and settings view.
- Signature: a liquid-glass "household tray" that sits over quiet ledger lines and soft diagonal refractive bands.

## Interaction

Use plain JavaScript only. Provide a usable preview with:

- bottom navigation;
- add-expense sheet;
- settle action;
- toast feedback;
- reduced-motion support;
- responsive desktop framing.

## Non-goals

This pass does not wire Supabase, import the old state machine, or preserve every old prototype feature. It creates a clean new product surface that can later be connected to data.
