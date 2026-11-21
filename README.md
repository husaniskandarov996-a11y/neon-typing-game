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

## controls

| key | what it does |
|---|---|
| `enter` | start / play again |
| `esc` | pause and resume. On the game over screen it goes back to the menu |
| `q` | quit to the menu while paused |
| `f` | toggle fullscreen (in menus) |

There are also on-screen buttons for **pause**, **sound** and **fullscreen**, so it works without a keyboard shortcut too. The game pauses by itself if you switch tabs or leave fullscreen.

## modes

- **normal**: 3 lives, regular speed
- **hard**: 2 lives, 1.5x faster, long words mixed in, double points. It keeps its own best score.

## leaderboard

Scores can't be typed in by hand. Before a game, the server (`server/worker.js`, a Cloudflare Worker with a D1 database) hands out a random seed. During the game the browser records only *what you typed and when*. When the game ends, the server replays the whole game with the same engine (`engine.js`) and works out the score itself. It also rejects:

- games that finished faster than real time
- typing faster than a human (more than 25 keys a second)
- the same game sent twice

You enter your first and last name once, before your first game. After that, every finished game is saved automatically.

## changelog

**v0.5**
- [x] cheat-proof leaderboard: the server replays every game and computes the score
- [x] name asked once before playing, scores saved automatically

**v0.4**
- [x] online leaderboard (top 10 for normal and hard)

**v0.3**
- [x] fullscreen button (enter and exit)
- [x] clickable pause button with resume / back to main menu

**v0.2**
- [x] sound effects, all synthesized with the Web Audio API (no audio files). They can be muted.
- [x] pause on Esc
- [x] hard mode with longer words
- [x] exit button on the game over screen
- [x] "level up" message

## todo

- [ ] custom word lists
