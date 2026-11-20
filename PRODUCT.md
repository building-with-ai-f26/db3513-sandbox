# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Movie watchers with choice fatigue, deciding what to watch tonight. Some pay for several streaming services, some pay for none. They watch alone or with one other person, usually at the end of the day when they're tired. Current users are friends and family testers. Outside users and a public launch on Render come next (Builds 4 and 5).

Their job: get from "what should we watch?" to pressing play in under two minutes, without opening each streaming app in turn or trading vetoes for 30 to 60 minutes.

People use it on phones and laptops about equally, so both need to work equally well.

## Product Purpose

The Shortlist picks five to eight movies for tonight, for one person or a blend of two. Each pick comes with a "why this pick" line and where to watch it. Success means the viewer trusts the shortlist enough to choose a film and press play instead of going back to scrolling. That trust is the riskiest assumption in the PRD.

## Positioning

Streaming apps recommend from one profile on one service. The Shortlist works across services. It limits picks to the services you actually pay for (or shows free, subscription, rent and buy options when you pay for none) and can blend two people's tastes into one shared list, labeling whose taste each pick came from.

## Operating Context

Three ways in:
- **Letterboxd:** upload a Letterboxd export ZIP and/or connect a public username for recent diary entries; optionally add Netflix viewing history to skip films already watched. Choose your streaming services and region.
- **A few questions:** no uploads or subscription. Each person picks genres they're into, genres to skip, up to three films they've loved lately, and an era.
- **Blend:** either path for a second person, combined into one list labeled "Both of you" or "<Name>'s pick".

Then choose tonight's mood (Light and easy, Intense and gripping, Surprise me) and get Today's Shortlist. Each pick can be turned down with "Not tonight", which swaps in a backup pick until backups run out. Building a shortlist takes noticeable time (a Claude call at high reasoning effort), so the wait is a real part of the experience.

## Capabilities and Constraints

- Node.js / Express server, plain HTML, CSS and JavaScript front end, no build step and no front-end framework. AGENTS.md asks for no unnecessary dependencies.
- Film data, posters and where-to-watch come from TMDB (JustWatch data). TMDB attribution must stay on the results page.
- Each shortlist is a paid Claude call (about $0.05, more on retry), so features that trigger extra calls need justification.
- Movies only; TV shows are out of scope. No automatic streaming-account linking; history comes from export files.
- Analytics run through PostHog; existing event names should be preserved.
- Undecided: trailers, one-tap open in the streaming app, a taste match score, and a daily reroll appear in the PRD but are not built.

## Brand Commitments

- Product name: **The Shortlist**.
- Results heading phrase: **Today's Shortlist**.
- The current tagline and the 🎥 emoji are not binding and may change.

## Evidence on Hand

- Living PRD and weekly build log: `docs/index.html`.
- Real movie data and posters come from TMDB at runtime.
- No user testimonials, usage metrics or outside reviews exist yet ("User Evidence: Not yet measured"). Future work must not invent any.

## Product Principles

1. Tonight, not someday: every screen moves toward choosing one film and pressing play.
2. Earn trust with specifics: each pick explains itself with facts from the viewer's own taste or answers.
3. Only what you can actually watch: never show a film the viewer can't stream, rent or watch free in their region.
4. Two people, one list: blending is a core case, not an add-on; make clear whose taste each pick serves.
5. Low effort for tired people: few decisions, clear defaults, nothing that feels like homework.

## Accessibility & Inclusion

No product-specific standard has been set. The current front end already respects reduced motion, moves focus between steps, and announces status changes to screen readers; future work should keep those.
