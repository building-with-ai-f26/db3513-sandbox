---
name: The Shortlist
description: Tonight's films, set like a two-colour repertory cinema program.
colors:
  ink-first: "#c4136d"
  ink-second: "#0b6fb5"
  ink-both: "#6a3aa0"
  both-base: "#6a8ac8"
  both-impression: "#ff6bcc"
  ink: "#1c1c22"
  ink-hover: "#3a3a45"
  paper: "#f3f4f6"
  panel: "#ffffff"
  muted: "#595964"
  rule: "#d1d3d9"
  skeleton: "#e3e4e9"
  error: "#b3261e"
  ink-first-dark: "#ff6fb6"
  ink-second-dark: "#5cb4ff"
  ink-both-dark: "#b590ff"
  ink-dark: "#efeff2"
  ink-hover-dark: "#c9c9d1"
  paper-dark: "#121217"
  panel-dark: "#1b1b22"
  muted-dark: "#a6a6b2"
  rule-dark: "#34343e"
  skeleton-dark: "#24242c"
  error-dark: "#ff8a80"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 850
    lineHeight: 0.95
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 68"
  wordmark:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 70"
  program-number:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 900
    lineHeight: 1
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 68"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 800
    lineHeight: 1.15
    fontVariation: "'wdth' 85"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5
  program-label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 750
    lineHeight: 1.5
    letterSpacing: "0.06em"
  note:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  square: "2px"
  dot: "50%"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.body-small}"
    rounded: "{rounded.square}"
    padding: "10px 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
    textColor: "{colors.paper}"
  button-primary-disabled:
    backgroundColor: "{colors.skeleton}"
    textColor: "{colors.muted}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body-small}"
    rounded: "{rounded.square}"
    padding: "10px 20px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.body-small}"
    padding: "10px 0"
    height: "44px"
  button-veto:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "6px 14px"
    height: "40px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "10px 12px"
    height: "44px"
  chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body-small}"
    rounded: "{rounded.square}"
    padding: "9px 14px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  mood-option:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "12px 16px"
  mood-option-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  step-number-current:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.dot}"
    size: "24px"
  new-pick-tag:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.program-label}"
    padding: "2px 6px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.body-small}"
    rounded: "{rounded.square}"
    padding: "4px 16px"
---

# Design System: The Shortlist

## Overview

**Creative North Star: "The Repertory Program"**

The Shortlist is set like a neighbourhood repertory cinema's two-colour risograph program. A cool off-white sheet (a near-black sheet in dark mode) carries near-black ink. Two riso inks carry one meaning each: fluorescent pink is the first person, blue the second, and where they overprint, purple means "Both of you". Ink-black does the work of the page: actions, selection, the current step, the rules that divide it. Nothing is coloured for decoration.

Structure comes from printed rules rather than boxes: 2px ink rules head each section and the masthead, 1.5px rules head each program entry, hairlines divide facts and lists. Corners are square (2px at most), surfaces are flat, and the only shadow belongs to a transient toast. One variable grotesque, Archivo, runs across its width axis: condensed heavy capitals for headings, the wordmark and program numbers; normal width for everything you read and operate.

Density is calm. The setup steps are a narrow centred column of ruled sections; the shortlist widens into a program, numbered entries in the person's ink with a poster, title, the reason for the pick and a hairline facts row. Motion is limited to short colour transitions and one authored moment: a swapped-in pick prints into place.

**Key Characteristics:**
- Two inks plus their overprint, each tied to exactly one person or to both.
- Ink-black for every action and every selected state.
- Ruled sections, never rounded cards; flat paper, no surface shadows.
- One variable grotesque: condensed heavy caps to announce, normal width to read.
- Light and dark follow the device; both are first-class printings of the same program.

## Colors

A cool paper and near-black ink, with two fluorescent riso inks and their overprint reserved for whose taste a pick serves.

### Primary
- **Ink Black** (`ink`; dark `ink-dark`): Text, primary buttons, selected chips and moods, the current step number, the New pick tag, the toast, focus rings, text selection, and the 2px and 1.5px structural rules. Hover lifts to **Worn Ink** (`ink-hover`).

### Secondary
- **Fluorescent Riso Pink** (`ink-first`; dark `ink-first-dark`): The first person. Their setup section's top rule, their program numbers, their pick label, and their poster fallback title. Single-viewer picks also print in pink.
- **Riso Blue** (`ink-second`; dark `ink-second-dark`): The second person, in the same places as pink.

### Tertiary
- **Overprint Purple** (`ink-both`; dark `ink-both-dark`): "Both of you". In light mode the purple is the literal product of the pink impression (`both-impression`) multiplied over a blue base (`both-base`), offset 0.1em; in dark mode the purple sits on top with the pink impression offset behind it.

### Neutral
- **Cool Paper** (`paper`; dark `paper-dark`): Page ground and text on ink.
- **Clean Sheet** (`panel`; dark `panel-dark`): Fills of inputs, chips, mood options and the dropzone, one step above the paper.
- **Pencil Grey** (`muted`; dark `muted-dark`): Secondary text, notes, placeholders, inactive steps, hover border of fields.
- **Hairline** (`rule`; dark `rule-dark`): Resting field and chip borders, hairline dividers, scrollbar thumb.
- **Unprinted** (`skeleton`; dark `skeleton-dark`): Loading placeholders, empty poster frames, disabled buttons.
- **Error Red** (`error`; dark `error-dark`): Error messages only.

### Named Rules
**The One Ink, One Person Rule.** Pink is the first person, blue the second, purple both. An ink appears only where it identifies whose a thing is; it never decorates, never marks state, never fills a button.

**The Black Does the Work Rule.** Every action and every selection is ink-black on paper, or paper on ink-black. Selection is never shown in a person's ink.

**The Real Overprint Rule.** "Both of you" is printed, not picked from a swatch: two impressions slightly off register, blended so their overlap lands on the purple.

## Typography

**Display Font:** Archivo (self-hosted variable, weights 100 to 900, widths 62 to 125%), with system-ui
**Body Font:** Archivo, with system-ui

**Character:** One grotesque played across its width axis. Squeezed to 68 to 70% and set at 850 to 900 in capitals, it reads like a cinema program's headline type; at normal width and 400 it is quiet, legible UI.

### Hierarchy
- **Display** (850, width 68%, 2.25rem; 2rem at phone width, 3rem from 760px, 4rem in the wide program column; line-height 0.95, uppercase, balanced): Step headings such as "Who's watching?" and the shortlist heading.
- **Wordmark** (900, width 70%, 1.625rem, uppercase): The masthead name only.
- **Program Number** (900, width 68%, 1.875rem; 1.5rem at phone width; tabular, two-digit with leading zero): The numbered entries, in the person's ink.
- **Title** (800, width 85%, 1.25rem, line-height 1.15): Film titles and section headings.
- **Body** (400, 1rem, line-height 1.5): Inputs and running text. **Body Small** (0.9375rem) carries the "why this pick" line (capped at 62ch), buttons and chips.
- **Label** (600, 0.875rem): Form labels, legends, step names, disclosure summaries.
- **Program Label** (750, 0.75rem, 0.06em tracking, uppercase): The pick's whose-taste label and the New pick tag. The date, people and mood line under the shortlist heading uses the same treatment at 700 and 0.8125rem.
- **Note** (400, 0.8125rem, muted): Field notes, film notes, mood descriptions, the tagline.

### Named Rules
**The Two Widths Rule.** Condensed heavy capitals announce (headings, wordmark, numbers, poster fallbacks); normal width does everything you read or operate. Nothing in between is condensed below 85%.

**The Tabular Count Rule.** Anything counted or rated (program numbers, step numbers, counts, ratings, facts) uses tabular figures.

## Layout

The setup steps (You, Preferences) sit in a narrow centred column (592px max) with 16px side gutters, 40px top padding (56px from 760px) and 96px bottom padding. The shortlist widens the same container to 1200px. From 1040px the shortlist becomes a program: a sticky 280px side column holding the heading, the date/people/mood line, summary and actions, beside two columns of entries (56px column gap between side and entries, 40px between entry columns), with 48px side padding. Below that, entries stack in one column.

Each program entry is a three-column grid: number, poster (2:3), details. Columns are 36px / 76px / rest with a 14px gap, tightening to 30px / 64px with 12px at 420px and below, widening to 44px / 92px with 16px from 760px.

The masthead runs full width with the wordmark left and the step tracker right, wrapping on narrow screens; at 420px and below the steps spread across the full width.

Spacing steps through 4, 8, 12, 16, 20, 24, 32 and 40px. 8px separates siblings in a group (chips, moods, actions), 20px separates fields, 32px separates people sections.

## Elevation & Depth

The page is flat paper. Depth is shown by printing: rule weight (2px for sections, 1.5px for entries, 1px hairlines for subdivisions) and the one-step lift from paper to the white or slightly raised panel fill of controls. Surfaces carry no shadow.

### Shadow Vocabulary
- **Toast lift** (`box-shadow: 0 8px 24px rgb(0 0 0 / 0.18)`): Only on the fixed toast that floats over the page after a swap or undoable change.

### Named Rules
**The Flat Sheet Rule.** Nothing printed on the page casts a shadow. Only the toast, which floats above the sheet, may lift.

## Shapes

Square-cornered throughout: buttons, fields, chips, mood options, the dropzone and the toast use a 2px radius, enough to soften the pixel edge without reading as rounded. The only round form is the step-tracker number (a 24px circle with a 1.5px outline). Posters are hard-edged 2:3 rectangles. Borders are 1.5px on controls, dashed for invitations and empty drop targets (the "Watching with someone?" section, the dropzone at rest) and solid once something is there. The disclosure chevron is drawn from two 1.5px borders rotated, not a glyph.

## Components

### Buttons
Printed and plain: solid ink to act, an ink outline for the alternative, underlined text for the least.
- **Shape:** Square corners (2px), 1.5px border, 44px minimum height.
- **Primary:** Ink fill, paper text, 650 weight, 10px 20px padding. Full-width as the step's main action.
- **Hover / Focus / Active:** Hover lifts to Worn Ink over 150ms ease-out; focus is a 2px ink outline at 2px offset; active nudges down 1px. Disabled prints as Unprinted with Pencil Grey text.
- **Secondary:** Transparent with an ink outline; hover fills with ink and turns the text paper.
- **Quiet:** No box, muted underlined text at 500; hover darkens to ink. Used for Remove, Undo in the toast, and Read more.
- **Not tonight:** A compact secondary (40px high, 6px 14px) on each pick, sharing a row with Where to watch.

### Chips
- **Style:** Clean Sheet fill, 1.5px Hairline border, 2px corners, ink text, 9px 14px.
- **State:** Hover darkens the border to ink; selected inverts to ink fill and paper text. Used for streaming services.

### Mood options
Option rows with a bold name and a muted one-line description, 12px 16px, same states as chips. Selected inverts to ink with the description at paper and 80% opacity. Used for the way in and tonight's mood.

### Inputs / Fields
- **Style:** Clean Sheet fill, 1.5px Hairline border, 2px corners, 44px minimum height, 10px 12px, 1rem text.
- **Focus:** The border turns ink; no glow.
- **Hover:** Border darkens to Pencil Grey.
- **Error:** Error Red, 600 weight message below, announced as an alert.

### Dropzone
A dashed Pencil Grey border on Clean Sheet, centred title and note. Hovering, dragging or holding a file turns the border solid ink.

### Navigation (step tracker)
Three text buttons in the masthead, each with a circled tabular number. Inactive steps are muted; unavailable steps drop to 50% opacity; the current step turns ink with its number filled ink and printed in paper.

### Ruled sections
Each person's setup section opens with a 2px top rule, tinted to that person's ink (pink for the first, blue for the second). The invitation to add a second person uses a 1px dashed rule.

### Program entry (signature)
The shortlist's unit. A 1.5px ink top rule, then the two-digit number in the person's ink, the poster (or, when there is none, the title in condensed caps in the person's ink on an Unprinted frame), and the details: title, whose-taste program label in the person's ink, the why line, a three-line clamped overview with Read more, a hairline facts row naming the service, and the action row. "Both of you" numbers print as a pink impression over a blue base, offset 0.1em. Hidden entries drop out of the counter so the program renumbers itself.

**Printing in.** A swapped-in pick carries an ink New pick tag until touched or focused, and prints into place: a top-down clip reveal (360ms, `cubic-bezier(0.16, 1, 0.3, 1)`), and for shared picks the pink impression settles from 0.33em to 0.1em off register (480ms, same curve). Reduced motion disables all animation and transition.

### Loading program
While the shortlist builds, six skeleton entries print the program's layout (number, poster, lines) in Unprinted, pulsing between full and 55% opacity over 1.2s.

### Toast
Ink bar, paper text, 2px corners, fixed bottom centre, with a quiet paper-coloured action. The one element allowed a shadow.

## Do's and Don'ts

### Do:
- **Do** tie each ink to exactly one meaning: pink first person, blue second person, purple "Both of you".
- **Do** show every action and every selected state in ink-black, inverted to paper text.
- **Do** divide with rules: 2px ink for sections and the masthead, 1.5px for program entries, 1px hairlines for facts and lists.
- **Do** keep controls square-cornered (2px) with 1.5px borders and a 44px minimum touch height.
- **Do** set headings, the wordmark and program numbers in Archivo condensed (68 to 70%) at 850 to 900 in capitals, and everything operable at normal width.
- **Do** print "Both of you" as a real overprint of two impressions slightly off register.
- **Do** design light and dark together; both follow the device.
- **Do** honour reduced motion by turning off every animation and transition.

### Don't:
- **Don't** use a person's ink for buttons, selection, hover or status.
- **Don't** box content in rounded cards or give printed surfaces a shadow; only the toast lifts.
- **Don't** fall back to a streaming-app poster grid; picks are numbered program entries.
- **Don't** bring back the cream ground, Georgia serif and forest-green palette the program replaced.
- **Don't** add a second typeface; Archivo's width axis carries the contrast.
- **Don't** add motion beyond short colour transitions and the printing-in of a swapped pick.
