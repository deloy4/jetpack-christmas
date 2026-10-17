# Jetpack Christmas Special

A browser rebuild of Jetpack Christmas Special, the 1993 DOS game by Adam Pedersen that Software
Creations gave away as freeware. Play it at https://deloy4.github.io/jetpack-christmas/

All ten original levels are here, and the rules come from reading the original program: walking
and jetpack speeds, gravity, fuel, ladders, ice, sludge, conveyors, the Phase Shifter's dig and
regrow times, all eight monsters, buttons, barriers, teleporters, the pop-up pickups, scoring and
lives. The art and sound are new. Every tile and sprite is drawn with canvas paths, keeping the
original's layout and colours.

## Controls

The arrows walk and climb, Alt or Z fires the jetpack, and Ctrl, Enter or X runs the Phase
Shifter, which tunnels through brick but not grey stone. Hold Down while flying to keep your
height, and press Down on a button or teleporter to use it. Esc loses this Santa when you're
stuck, + and − change the game speed, P pauses and M turns the sound off. On a touchscreen,
buttons appear under the game. The original's hidden keys still work: hold Tab and 2, then press
L for an extra life, F for a full tank, I for a shield or S to skip the level.

## High scores

When a game ends, the player types a name and the score goes on a board everyone shares, with an
All Time list and a This Week list (weeks start Sunday at midnight, Mountain time). The scores are
kept in the `arcade-scores` Supabase project, in one `scores` table for both games. Browsers can only
call two database functions, `submit_score` and `get_leaderboard`, so nobody can change or delete a
score from the page. To remove a bad score, delete its row in the Supabase table editor. Games where
a cheat key was used don't post a score. `leaderboard.js` is the same file in both game repos, so
copy any change to it across.

## How it runs

The game runs at 31.6 frames a second, which is what level 1 measured in the original running
in DOSBox. Positions use the original's units (1/32 of a pixel), and the screen draws between
frames so movement stays smooth.

- `index.html`, the page.
- `game.js`, the game: the frame loop in the original's order, the monsters, and the screens around play.
- `art.js`, all the drawing.
- `levels.js`, the ten levels decoded from the original `JETLEV.DAT`.
- `shapes.js`, the rounded corners and stone edges of each brick tile, read from the original sprite sheet.
- `leaderboard.js`, the shared high score board (the same file is in the Graveyard Gridiron repo).
- `preview.html`, a still view of one level's art (`preview.html?level=3&monsters=1`).

There is no build step; open `index.html` in a browser.

Differences from the original: one player only, no level editor or demo, and the frame rate is
the same on every level (the original speeds up on levels with many monsters). Everyone who plays
shares one high score board, with All Time and This Week lists. The status bar adds a gift count.
