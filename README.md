# Skyhop

A small pixel platformer. Run, hop and stomp across three worlds — Meadow,
Dusk Cliffs and Night Fort — as Pip the little robot. Grab sparks to grow,
bump blocks for coins, and reach the flag before the clock runs out.
Already big? The next power block holds a flame: grab it and the run button
throws bouncing fireballs that take out anything, spiky critters included.

Play it at **[staz.ai/games/skyhop](https://staz.ai/games/skyhop/)** or in the
Games app on [staz.ai](https://staz.ai/?play=skyhop).

## Controls

| | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | ← → / A D | stick / d-pad | ◀ ▶ pad |
| Jump | Space / ↑ / Z | A / B | JUMP |
| Run (and fire, once powered up) | Shift / X | X / Y / RT | RUN / FIRE |
| Pause | P / Esc / Enter | Start | ❚❚ |
| Mute | M | | ♪ |

## Under the hood

Plain HTML, CSS and JavaScript — no build step, no dependencies, no image
files. Every sprite and tile is drawn in code onto a low-res canvas, the
music and sound effects are synthesized live with Web Audio, and levels are
built from a tiny grid DSL in `levels.js`. It installs to the home screen
and works offline.

Run it locally with any static server, e.g. `npx serve .`
