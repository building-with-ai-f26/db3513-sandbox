---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: ["public/styles.css","public/app.js"]
---

# The Shortlist app (public/index.html)

Scope: the whole three-step app (You, Preferences, Shortlist). Mode: Operate.
Audience and job: tired viewers on phone or laptop, alone or in pairs, choosing tonight's film in under two minutes.
Constraints: light and dark both follow the device; plain HTML/CSS/JS, no framework; keep all element ids, PostHog events and TMDB attribution. Must not feel busy or techy/AI.
Memorable moment: shared picks print in the overprint where both people's inks meet.

## Direction contract

THESIS: Tonight's shortlist set like a neighbourhood repertory cinema's two-colour risograph program. Refuses the streaming-app poster grid and the cream-serif card stack the app had before.

OWN-WORLD: Cool off-white paper (dark: near-black ground) with near-black ink. Two riso inks carry one meaning each: fluorescent pink is the first person, blue the second, their overprint purple is "Both of you". Ink-black for primary actions and selection. One variable grotesque (Archivo) across widths: condensed heavy caps for headings and program numbers, normal width for UI. Hairline and 2px ink rules instead of rounded cards; square-cornered controls.

STORY: The viewer sees whose taste each pick serves at a glance, reads why it was chosen, turns down what doesn't fit (a backup prints in its place, marked New pick), and picks one to watch.

FIRST VIEWPORT: Full-width masthead: wordmark left, three-step tracker right. Shortlist step on desktop: left column with condensed "Today's Shortlist", date/people/mood line, summary and actions; right, two columns of numbered program entries (number in the person's ink, poster, title, why, hairline facts row, Not tonight). Phone: single column, same entry anatomy. Setup steps: a narrow centred column of ruled sections.

FORM: Grounded candidate 4 of 7 (repertory cinema riso program). seed:80a9bca3eedacd73. Signature move: program numbers printed in each person's ink, shared picks as a pink-over-blue overprint.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
