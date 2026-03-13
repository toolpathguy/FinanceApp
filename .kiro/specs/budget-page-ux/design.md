# Design Document: Budget Page UI/UX Improvements

## Status: Placeholder

## Overview

Improve the budget page UI/UX to better support the YNAB-style envelope budgeting workflow. The current page has the core data but needs polish around interactions, visual hierarchy, and usability.

## Areas to Address

- Inline assignment editing UX (click-to-edit flow, keyboard navigation, escape/enter behavior)
- Inline assignment performance — optimistic UI updates flicker when background refresh overwrites local state; need proper optimistic mutation pattern or debounced refresh
- Budget transfer UI (move money between envelopes without leaving the page)
- Ready to Assign prominence and color coding (green when positive, red when overspent)
- Period navigation (month picker with prev/next arrows)
- Envelope group collapse/expand persistence
- Hidden envelope management (zero-out-before-hide flow, unhide UI)
- Mobile responsiveness of the budget grid
- Pending credit card envelope visibility
- Overspent envelope warnings (negative Available highlighting)
- Undo support for assignments and transfers

## TODO

- [ ] Flesh out detailed design
- [ ] Define component hierarchy
- [ ] Create wireframes/mockups
- [ ] Write requirements
- [ ] Create implementation tasks
