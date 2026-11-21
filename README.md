# neon type

A small typing game I made while learning JavaScript.

Words fall from the top of the screen. Type one before it hits the red line and it's gone. Every word that gets through costs you a heart, and three hearts is all you have. Every 10 words it gets faster.

**Play it here:** https://husaniskandarov996-a11y.github.io/neon-typing-game/

## word sets

- **english**: random everyday words
- **o'zbekcha**: Uzbek words, for practising on your own keyboard
- **code**: `function`, `const`, `async` and other keywords. Good warm-up before coding.

## how it's built

Plain HTML, CSS and JavaScript, with no frameworks and no build step. The falling is done with `requestAnimationFrame`, and the CRT lines are a single CSS gradient. Your best score is saved in `localStorage`, so it stays in your browser and nothing is sent anywhere.

To run it locally, open `index.html`.

## credits

The font is [VT323](https://fonts.google.com/specimen/VT323) by Peter Hull (SIL Open Font License), bundled in `/fonts`.

## todo

- [ ] sound effects
- [ ] pause on Esc
- [ ] a harder mode with longer words
