# Design system (spec v1.1 — "Your story matters.")

A visual redesign only: routes, bidding logic, authentication flow, permissions and data are unchanged. One system, centralised in `src/app/globals.css` (CSS variables → Tailwind tokens), reused by every page; no second design system or new dependency was added (fonts come from `next/font`).

## Tokens

| Token (Tailwind) | Hex | Used for |
|---|---|---|
| `ink` / `foreground` | `#101010` | Headings, nav, prices, primary text, focus ring |
| `brand-yellow` / `primary` | `#F5C518` | Primary buttons, active tabs/nav, "bidding open", accents. Hover `#E3B406` |
| `gold` | `#C49A38` | Decorative only (the rule beside the hero label) — never text, never an action |
| `ivory` / `background` | `#F7F5EF` | Page background, hover tint |
| `white` / `card` | `#FFFFFF` | Cards, forms, dialogs, header |
| `charcoal` | `#292929` | Secondary dark text (hero copy) |
| `muted-foreground` | `#686868` | Supporting text and metadata |
| `border` | `#E7E4DD` | Dividers, card borders |
| `input` | `#8C887F` | Form field outlines |
| `danger` | `#B42318` | Destructive actions, "outbid", urgent countdown |
| `success` | `#166534` | "You won" style confirmations (with text) |

Typography: **Archivo Black** for `h1`/`h2` (uppercase for hero and section headlines; `font-synthesis: none` so heavy weights never fake-bold), **Inter** for everything else (card titles bold, navigation semibold, money with tabular numerals). Hero is 44 px on phones, 72–88 px on desktop; body 16 px.

Components: buttons 8 px radius, 44 px minimum (yellow primary, white/black-outline secondary, red danger); cards 12 px radius with a hairline border; inputs white with a visible border and labels above; Lucide icons throughout; focus ring = 3 px black outline plus a yellow halo (visible on ivory, white and yellow); `prefers-reduced-motion` disables transitions.

## What changed

- **Guest pages:** new header (white, sticky, black wordmark, yellow accent bar, yellow "Register to bid"), homepage hero **YOUR STORY MATTERS.** with *BROWSE AUCTION ITEMS* / *VIEW EVENT DETAILS*, event-details section, restyled item cards (category label, current bid, status in words, increment, closing countdown, *Bid now* button), item detail with black pricing and a yellow bid panel, registration + PIN screens, My bids, My wins.
- **Staff pages:** same header with a yellow active-section state (`aria-current`), white data panels on ivory, black headings, consistent status badges, restyled live console, checkout, labels (white label header with black logo, yellow *Scan to Bid*), print summary, login.
- **Shared:** `ui/button`, `ui/input`, `item-card`, `site-header`, `admin-nav`, status badges, all page classes (a mechanical sweep replaced the previous purple/coral/teal tokens across 33 files).

## Deviations from the spec (and why)

1. **Muted gray `#686868`, not `#737373`:** `#737373` is 4.3:1 on the ivory page background; the spec's own 4.5:1 rule wins.
2. **Form borders `#8C887F`, not `#E7E4DD`:** `#E7E4DD` is ~1.3:1 on white; inputs need 3:1. `#E7E4DD` is still used for decorative card borders and dividers.
3. **No "category" on item cards:** the data model has no category field and schema changes need approval, so the card shows the auction type (*Silent auction* / *Live auction*). Adding real categories (e.g. "Experiences", "Food") is a small migration if you want it.
4. **Archivo Black is wide, not condensed;** Anton (the spec's condensed alternative) wasn't needed.
5. **Wordmark is the church's white logo shown solid black** via a CSS filter (no separate black file exists); please confirm or supply the official black logo.
6. **Status colors:** red (danger) and green (success) are used only for outbid/urgent and won/confirmed states, always with words; amber marks the *DEMO DATA* banner and "paused". The seeded demo item images are colorful placeholders (labelled DEMO IMAGE) and will be replaced by real photos.
7. **Dense staff tables use 40 px actions** (`sm` buttons) on desktop/tablet; every guest-facing and live-console control is ≥ 44 px.
8. **Mobile header** shows "Register" (short) and an icon-only sign-out to avoid horizontal overflow.

## Accessibility & checks

An in-browser audit script (`scripts/a11y-audit.js`) checks text contrast against WCAG AA, horizontal overflow and tap-target size; results are in [TEST-REPORT.md](TEST-REPORT.md#5-redesign-verification-visual-only-pass-spec-v11). Status is never conveyed by color alone, forms have visible labels, modals use Base UI dialogs, and focus is always visible. Not yet done: screen-reader testing and real-phone testing.

Screenshots: `docs/screenshots/` (mobile home, item + bid panel, PIN screen; desktop home and auction; admin dashboard and live console — the admin shots were taken moments before the final tap-target tweaks).
