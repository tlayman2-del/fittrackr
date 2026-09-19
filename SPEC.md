# FitTrackr Development Spec
## Instructions for Claude Code

Work through these items **one at a time**. After completing each item, stop and check back with Tim before proceeding to the next. Do not bundle items or proceed ahead without confirmation.

---

## Item 1 — e1RM Persistence

**Goal:** Store the best estimated 1RM per exercise in Firestore so it can be used for projected RIR calculations.

**Where:** New Firestore path `users/{uid}/meta/exerciseStats` — one document per exercise, keyed by exercise name.

**Document structure:**
```javascript
{
  bestE1RM: 245.5,
  bestE1RMSource: "0-RIR",  // or "estimated"
  bestE1RMDate: "2026-03-15",
  lastUpdated: timestamp
}
```

**Epley formula:**
```javascript
e1RM = weight × (1 + reps / 30)
```
Only compute for sets where reps are in the 3–12 range. Outside that range, skip.

**Update logic — runs after every workout save (`endWorkout`) and after every edit save:**
- For each exercise in the workout, compute e1RM for every qualifying set
- If any set has RIR === 0, that set's e1RM takes priority regardless of value — tag source as `"0-RIR"`
- Otherwise use the highest e1RM from non-zero-RIR sets — tag source as `"estimated"`
- Only write to Firestore if the new value is higher than the currently stored `bestE1RM` (best-ever, not most-recent), OR if the new value comes from a 0-RIR set and the stored source is `"estimated"`
- Use `setDoc` with `merge: true`

**Stop here and check in with Tim before proceeding to Item 2.**

---

## Item 2 — Live Projected RIR on Active Set Row

**Goal:** Show a calculated projected RIR next to the user's entered RIR field on the active set row, so discrepancies are visible in real time.

**Where:** Inside the `SetRow` component, displayed inline to the right of or below the existing RIR input. Only visible on the active set row (not all rows).

**Formula:**
```javascript
predictedMaxReps = (bestE1RM / weight - 1) × 30
projectedRIR = Math.round(predictedMaxReps - repsPerformed)
projectedRIR = Math.max(0, Math.min(10, projectedRIR))
```

**When to show:**
- Weight and reps are both entered and non-zero
- A `bestE1RM` exists in `exerciseStats` for this exercise
- Reps are in the 3–12 range
- Hide if projected RIR equals reported RIR (no new information)

**Display:**
- Label: `~X proj.` in `var(--ink4)` (muted)
- If `|projectedRIR - reportedRIR| >= 2`, color it `var(--orange)` instead
- Small text, does not disrupt the existing row layout

**Data access:** `ExerciseCard` already receives `uid`. Fetch `exerciseStats` for the current exercise on mount (or when exercise name changes). Store in local state. Do not re-fetch on every keystroke.

**Stop here and check in with Tim before proceeding to Item 3.**

---

## Item 3 — RIR Accuracy Report: View A (Exception Detail)

**Goal:** A new report in the Analytics tab that shows reported vs. calculated RIR for a selected exercise, set by set.

**Where:** Add "RIR Accuracy" to the existing report selector dropdown in `AnalyticsScreen`. When selected, show a sub-toggle at the top: **"By Exercise"** | **"Ranked"** — View A is "By Exercise".

**Data query:**
- Fetch all workouts in the selected date range
- For each workout, fetch exercises matching the selected exercise name
- For each set: compute calculated RIR using stored `bestE1RM` for that exercise
- Only include sets where reps are in 3–12 range
- Exclude cardio exercises

**Display — table with columns:**
- Date
- Weight × Reps
- Reported RIR
- Calculated RIR
- Discrepancy (calculated − reported, signed)

**Color coding per row:**
- Discrepancy ≤ 1: green (`var(--green)`)
- Discrepancy = 2: orange (`var(--orange)`)
- Discrepancy ≥ 3: red (`var(--red)`)

**Summary line above table:**
```
Accurate within 1 rep on X% of sets. Average discrepancy: +Y reps.
[anchored to 0-RIR set from DATE] or [estimated e1RM]
```

**Filters:** Exercise selector dropdown (only exercises with ≥ 3 qualifying sets), existing date range selector.

**Stop here and check in with Tim before proceeding to Item 4.**

---

## Item 4 — RIR Accuracy Report: View B (Exercise Ranking)

**Goal:** Second sub-view of the RIR Accuracy report showing all exercises ranked by cumulative discrepancy, most inaccurate first.

**Where:** Toggle "Ranked" within the RIR Accuracy report (same toggle introduced in Item 3).

**Data query:** Same as View A but across all exercises (not just one selected exercise). Aggregate per exercise:
- `cumulativeDiscrepancy` — sum of absolute discrepancies across all qualifying sets
- `averageDiscrepancy` — mean signed discrepancy (positive = consistently underestimates fatigue)
- `qualifyingSets` — count of sets in 3–12 rep range with a valid e1RM
- Minimum 5 qualifying sets to appear in the list

**Display — ranked list, one row per exercise:**
- Exercise name
- Cumulative discrepancy score
- Average discrepancy per set (signed, with +/− prefix)
- Number of qualifying sets
- Small colored severity bar (green/orange/red based on average discrepancy magnitude)

**Interaction:** Tapping a row navigates directly to View A filtered to that exercise.

**Stop here and check in with Tim before proceeding to Item 5.**

---

## Item 5 — Exercise Lookup Tab (6th Nav Option)

**Goal:** A new tab in the bottom nav for looking up the history of a specific exercise.

**Nav icon:** 🔍 or a barbell icon. Label: "Lookup". Position: between History and Templates (shifting Templates, Analytics, Profile one position right). Make the bottom nav horizontally scrollable if needed to accommodate 6 tabs without shrinking icons.

**Screen layout:**
1. Muscle group selector (dropdown, sourced from `MUSCLE_GROUPS` constant)
2. Exercise selector (dropdown, filtered by selected muscle group, sourced from `library.exercises` cross-referenced with `exerciseLibrary.js` for muscle group mapping)
3. Results list — last 10 sessions where that exercise appeared, most recent first

**Per session display:**
- Date and workout type
- All sets logged for that exercise: weight × reps, RIR
- e1RM for that session (computed from best set using Epley, shown as `e1RM: ~245lb`)
- Duration if logged (`⏱ 4:32`)

**Data query:** Query `workouts` ordered by date desc, fetch exercise subcollection for each, filter by exercise name, stop after finding 10 matching sessions. Use `getDocsFromServer` to bypass cache.

**Stop here and check in with Tim before proceeding to Item 6.**

---

## Item 6 — Persistent Bottom Nav During Active Workout

**Goal:** All 6 tabs remain accessible while an active workout is in progress. The workout timer keeps running in the background when switching tabs.

**Current behavior:** The active workout (`ActiveWorkout` component) replaces the entire screen including the bottom nav when `logging === true`.

**New behavior:**
- Bottom nav always visible regardless of `logging` state
- When `logging === true` and the user is on the Log tab, show `ActiveWorkout` as normal
- When `logging === true` and user switches to another tab, show that tab's screen — `ActiveWorkout` stays mounted but hidden (use `display: none` or conditional visibility, not unmounting)
- Workout timer continues running because `ActiveWorkout` remains mounted
- Returning to the Log tab restores the active workout exactly as left
- The Log tab icon should show a visual indicator (pulsing dot or orange tint) when a workout is in progress and the user is on another tab

**Important:** Do not unmount `ActiveWorkout` when switching tabs — this would lose timer state and draft data. Use CSS visibility or a wrapper div with `display: none` to hide it.

**Stop here and check in with Tim before proceeding to Item 7.**

---

## Item 7 — Full-Screen Landscape Report View

**Goal:** Any report in the Analytics tab can be expanded to a full-screen overlay with the chart rotated 90° to landscape orientation.

**Trigger:** An expand button (⛶ or ↗) in the top-right corner of each report card. Tapping opens the full-screen overlay.

**Implementation:**
- Full-screen fixed overlay (`position: fixed, inset: 0, zIndex: 200`)
- Chart content rotated 90° clockwise using `transform: rotate(90deg)` with appropriate width/height swap so it fills the screen
- Close button (×) in the corner that dismisses the overlay and returns to the analytics screen
- No device rotation required — CSS transform only
- Background: `var(--cream)` or `var(--card)`

**Which reports:** All existing reports (Sets Per Week, Volume Per Week) and any future reports including RIR Accuracy.

**Stop here and check in with Tim before proceeding to Item 8.**

---

## Item 8 — Desktop Report Builder

**Goal:** A desktop-only view (hidden on mobile) within the existing app that allows Tim to build custom reports against live Firestore data and save them as permanent reports accessible in both the desktop view and the mobile app's report selector.

**Visibility:** Hidden when viewport width < 768px. Show a "Report Builder" option in the Analytics tab header or as a button only on desktop.

**Metric picker — available fields:**

From `workouts`:
- Date, workout type, exercise group, location, sleep quality, energy level, post-session rating, total duration, body weight

From `workouts/.../exercises`:
- Exercise name, muscle group, primary group, primary sets, secondary sets, session duration

From `workouts/.../exercises` (sets array):
- Reps, weight, RIR (derived from sets array)

From `meta/exerciseStats`:
- Best e1RM per exercise, source, date

**Builder UI:**
- X axis: pick a time grouping (by week, by month, by session)
- Y axis: pick a metric from the field list above
- Optional group by: muscle group, workout type, exercise name
- Optional filter: date range, muscle group, exercise name
- Chart type: bar or line (consistent with existing chart components)
- Preview renders immediately on field selection

**Saving a report:**
- "Save Report" button — prompts for a name
- Saved to Firestore: `users/{uid}/savedReports/{reportId}` with fields: `name`, `config` (the full picker state as JSON), `createdAt`
- Saved reports appear in the mobile app's existing report selector dropdown alongside the built-in reports
- Saved reports can be deleted from the desktop builder view

**Stop here and check in with Tim before proceeding to Item 9.**

---

## Item 9 — Git Commit

Run the following in `C:\Users\pissy\iron-log`:

```
git add .
git commit -m "RIR accuracy, exercise lookup, persistent nav, landscape reports, desktop report builder"
git push
```

**Done — check in with Tim.**
