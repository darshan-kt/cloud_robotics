# ROBOSTORE visual upgrade plan

Status: **implemented** (option b: left uncommitted for review). See the results table at the end.

## Diagnosis

**Stack:** React 19, Tailwind 3.4 (`tailwind.config.ts`), Vite 6, lucide-react, and @fontsource (Inter, Cormorant Garamond, JetBrains Mono).

**Surfaces**
- Routes (6): `/login`, `/store` (Deck), `/dashboard`, `/remote-controller`, `/simple-route-planner`, `/emergency-stop`.
- Shell: `components/layout/AppShell.tsx` (rail + command bar), `ProtectedRoute.tsx`.
- UI kit: `components/ui/Layout.tsx` (Panel, Chip, Button, Field, inputClass, Skeleton, EmptyState, SectionTitle, KeyValue), `Signal.tsx` (SignalDot, SignalTag, Readout), `Toast.tsx`, `EventLog.tsx`.
- Unused: `ComingSoonPage.tsx`.

**Current tokens** (all in `tailwind.config.ts`, which follows DESIGN.md)
- Color: a warm dark ramp (`canvas #100f0d`, `surface #181715`, `raised #1f1e1b`, `elevated #252320`), lines `#2b2925` / `#211f1c`, and text from `ink #faf9f5` down to `faint #908d86` (AA-measured). Coral `#cc785c` is the only brand accent. Semantic colors: nominal, caution, fault.
- Type: Cormorant Garamond for display, Inter for UI, JetBrains Mono for readouts. There's a full named scale (`display-*`, `title-*`, `body-*`, `label`, `readout-*`).
- Radius: xs 4, sm 6, md 8, lg 12, xl 16, pill.
- Spacing: a 4px base with named steps (xxs through section), plus `rail` 64 and `bar` 56.
- Shadow: `hairline`, `raise`, `alarm`. Depth comes mostly from the `.lit` 1px inset highlight.
- Motion: fade-up, fade-in, breathe, alarm, sweep. `prefers-reduced-motion` is already handled globally.

**Verdict:** the system is principled: semantic color, provenance on every value, and AA-checked text. The desktop screens are close to the bar. The shortfall is (a) mobile is actually broken, and (b) polish is flat: every container is the same box, labels are a wall of spaced caps, and several states look unfinished. This is a raise job, not a redesign.

**Baseline checks**
- `npm run build` (tsc + vite): passes.
- `npm run lint`: already failing before any edits, because ESLint 9 has no `eslint.config.*`. I won't count it as new errors, and fixing it would be a config change, so I won't do that unasked.
- There's no test script.

**BEFORE screenshots:** 12 shots (6 routes × 375 px / 1440 px), saved in my session scratchpad as `shots/before-{width}-{route}.png`.

## Top 10 weaknesses, ranked by quality gain per line changed

| # | Weakness (seen in screenshots) | Smallest fix | Files | ~Lines |
|---|---|---|---|---|
| 1 | **Mobile layouts are broken at 375 px.** On Teleop, the Steering panel draws on top of the Commanded panels, because the page grid is `h-full` and forces every row into one viewport height. The E-Stop and Routes pages have the same pattern. | Change `h-full` to `lg:h-full` on the three page grids, so on mobile they stack and scroll naturally. | RemoteControllerPage, SimpleRoutePlannerPage, EmergencyStopPage | 3 |
| 2 | **The command bar overflows at 375 px.** The page title truncates to "D…" / "Te…", and the E-Stop and sign-out buttons push content off-screen. The Deck tiles and vitals are clipped at the right edge. | Hide the title divider and title below `sm`, tighten the bar gap and padding below `sm`, and add `min-w-0` to the content column. | AppShell | ~4 |
| 3 | **Rail labels are 9 px, and "Dashboard" overflows its 44 px item** (it touches the rail edges). 9 px is below a legible minimum. | Rail token 64 → 72 px, item width 44 → 56 px, label 9 → 10 px. | tailwind.config.ts, AppShell | 3 |
| 4 | **The disabled primary button looks broken.** "Dispatch route" renders muddy brown (coral at 40% opacity over dark). | Disabled state uses a neutral `bg-elevated text-faint` instead of opacity on a colored fill. | Layout.tsx (Button) | 2 |
| 5 | **Double frames on empty states.** A dashed box inside a bordered panel stretches the full panel height (E-Stop history, Deck activity, Dashboard safety events), which reads as unfinished. | Drop the dashed border when the empty state sits inside a Panel. Put the icon in a small elevated rounded-square badge. | Layout.tsx (EmptyState) | ~5 |
| 6 | **A wall of spaced caps.** Over 30 hand-rolled `text-[11px] uppercase tracking-[1.5px]` labels bypass the existing `label` token, and every panel title, chip, eyebrow and tag shouts at the same volume, so hierarchy flattens. | Panel titles become sentence-case `title-sm` in `text-body`, which is quieter and more editorial. Eyebrow and field labels use the `label` token with tracking 1.5 → 1 px. Uppercase stays for mono signal tags only, where it carries meaning. Centralized in Panel, Field and SectionTitle, plus a token tweak. | tailwind.config.ts, Layout.tsx | ~6 |
| 7 | **Every container is the same flat box.** Panels, tiles and vitals are all `bg-surface` plus a hairline on canvas, and Deck tool tiles have no hover affordance beyond a border tint. | Add one warm-tinted `panel` shadow token and apply it in Panel. Deck tiles get a 1 px hover lift plus the `raise` shadow. The lift is disabled under reduced motion (the global rule already zeroes transitions). | tailwind.config.ts, Layout.tsx, AppStorePage | ~5 |
| 8 | **Deck vitals are undersized for their cells.** At 1440 px, "78 %" is 22 px of text in a 300 × 120 px cell, and the most important numbers on the landing screen read weakest. | `size="lg"` on the four Deck Readouts. | AppStorePage | 4 |
| 9 | **The focus ring is forced to a 4 px radius on everything**, so it looks wrong around 12 px tiles, pill chips and the round E-Stop. | Remove `border-radius` from `:focus-visible`; modern browsers make the outline follow the element's own radius. | index.css | 1 |
| 10 | **Hardcoded colors that bypass the tokens.** Includes `#7d7a73`, which the token file itself documents as failing AA (4.18:1): teleop idle color, heartbeat stroke, E-Stop overlay. | Replace `#7d7a73` with `faint #908d86`. Move the overlay inset shadow into the existing `alarm` shadow family as an `alarm-frame` token. The floor-map SVG hexes are placeholder map *data*, so I'll leave them. | RemoteControllerPage, DashboardPage, AppShell, tailwind.config.ts | ~5 |

**Also planned (small, part of the component and motion stages):** pressed feedback on buttons (`active:translate-y-px`, 1 line), and the command-bar page title moves from `text-muted` to `text-body` so it reads as a location, not a hint (1 line).

**Estimated total:** about 45 changed lines across about 9 files. No props, exports, routes or data flow change.

## Structural changes flagged

None. Every fix is a class or token change. The biggest one is #3, which changes the width of the rail grid column via its token.

## Deliberately NOT doing

- **Font swap away from Inter.** The redesign skill suggests one, but DESIGN.md explicitly sanctions Inter as the StyreneB substitute, and swapping would also add a dependency.
- **Replacing lucide icons.** That would be a dependency change.
- **Adding noise, grain or ambient motion.** `index.css` documents why ambient motion was removed from a safety console, and I agree.
- **Replacing the rail with a mobile bottom bar.** That would be a structural change; #2 and #3 fix mobile without it.
- **No dark/light mode, no new pages, no GSAP.** There's no existing scroll choreography worth upgrading.

## Implementation order (after approval)

1. **Tokens:** #3 (rail), #6 (label tracking), #7 (panel shadow), #10 (alarm-frame).
2. **Typography:** #6 (Panel, Field, SectionTitle), plus the command-bar title.
3. **Layout and spacing:** #1, #2, #8.
4. **Components:** #4, #5, #7 (tiles), #10 (hex cleanup).
5. **Motion:** pressed feedback, #9 (focus ring).

After each stage: `npm run build` must pass, I take 375/1440 screenshots, and I report ✅ what changed | files touched | build result.

## ⚠ Decision needed: commits

`robostore-poc/` already has **your uncommitted work-in-progress**, including the files this plan edits (`Layout.tsx`, `index.css`, `tailwind.config.ts`, several pages, and the untracked `AppShell.tsx`). A commit per stage would sweep your WIP into my "design" commits. Options:

- **(a)** You commit your WIP first, then I commit per stage as planned.
- **(b)** I make the edits without committing, and you review one diff.
- **(c)** I commit per stage anyway, knowing the first commit will include your WIP.
