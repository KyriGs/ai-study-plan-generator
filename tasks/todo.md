# Neon Canyon — Build Checklist

## Round 2: dash + ghost racer + timer

- [x] Dash: Shift/X, 640px/s for 0.13s, gravity off, 1 air-dash, 0.45s cooldown, trail + sfx, jump cancels
- [x] Timer: runs during play, HUD shows TIME + BEST, saved per level (localStorage)
- [x] Ghost: record best run at 30Hz, replay translucent ghost racing you
- [x] Complete screen: time, best, NEW RECORD flash
- [x] Verify: dash distance, ghost appears on 2nd run, record persists across reload

## Round 6: rebindable keys

- [x] "⌨ CHANGE KEYS" button on title (canvas now has mouse support: hover glow + pointer cursor)
- [x] Controls screen: click action row -> press ANY key (Esc cancels); saved to localStorage neonCanyon.binds
- [x] Rebinding steals the key from other actions (if they keep >=1 key); RESET DEFAULTS + BACK buttons
- [x] R/M system keys yield if user binds them to an action; title screen shows live bind names
- [x] Verified: rebind jump->J (Space stops working, J jumps), persistence, steal (left=D removed D from right), reset, layout non-overlapping, console clean

## Round 5: Hollow-Knight jump feel

- [x] Hard cut on release (0.25) + 3x gravity while still rising after release + apex hang (0.55x gravity when |vy|<60)
- [x] Height ladder verified: 50ms tap 0.6 tiles / 100ms 1.4 / 200ms 2.4 / full hold 2.71 (max unchanged)
- [x] Balance proof: full 5-level run post-change, 0 deaths, console clean

## Round 4: dash levels

- [x] Level 4 "Dash Canyon" (idx 3): three 6-tile gaps = dash required; teaching level, checkpoint after gap 1
- [x] Level 5 "Neon Finale" (idx 4): climb + 6-gap sky dash + descent + spike gauntlet + apex-dash finale onto raised tower
- [x] Music tracks L3 (140bpm Am) + L4 (148bpm Em)
- [x] Verified: no-dash bot FAILS L4 gap 1 (17 falls, proves dash gate); dash bot full game title->win, all 5 levels, 0 deaths
- [x] Fixed during test: finale was 6-gap + 2-up tower = ~1px margin (cruel); now 5-gap + 2-up, comfortable with apex dash

## Round 3: background music

- [x] Synthwave engine: lookahead scheduler, arp (filtered saw) + bass (triangle) + pad (sines)
- [x] 4 tracks: title 68bpm dreamy Am, L1 100bpm Am, L2 116bpm Dm, L3 132bpm Em
- [x] State-driven: track follows title/level/win; complete + win screens duck to 35%
- [x] M mutes music + SFX together (music fades, not cuts)
- [x] Verified: track switching, scheduler advancing on live audio clock, mute/duck gains, console clean

### Round 2 review

Verified via deterministic frame-stepping in browser (preview tab was
CPU-throttled, so wall-clock bots were unreliable — sim-stepped instead):
- Ground dash ≈ 91px, air dash works, second air dash blocked until landing,
  cooldown blocks rapid re-dash, jump cancels dash
- Scripted record run: L1 in 6.57s, 197 ghost samples (= 6.57s × 30Hz exactly),
  saved to localStorage, survives reload
- Replay: ghost loads, renders translucent blue, races ahead, hides after finish
- Slower re-run (8.45s): record kept at 6.57, complete screen shows Time + Best;
  faster run flips NEW RECORD flash
- Added Math.max(0, dt) floor as defense against non-monotonic timestamps
- Test localStorage cleared afterward — player starts with no ghost

- [x] 1. Scaffold: index.html, canvas, CSS scaling, loop skeleton
- [x] 2. levels.js: tile format + Level 1 map
- [x] 3. Player physics: gravity, run, base jump
- [x] 4. Tile collision (axis-separated AABB)
- [x] 5. Feel pass: coyote, buffer, jump cut, fall gravity
- [x] 6. Camera lerp + clamp
- [x] 7. Parallax background (stars + 2 hill layers)
- [x] 8. Coins: bob, collect, HUD
- [x] 9. Spikes + health: hearts, knockback, i-frames, checkpoint respawn
- [x] 10. Flow: title, exit flag, level-complete, progression, win
- [x] 11. Levels 2 + 3
- [x] 12. WebAudio SFX + mute
- [x] 13. Playtest + verify + tune
- [x] 14. Review section below

## Review

Game lives in `platformer/` — index.html + game.js + levels.js, zero dependencies.
Run: double-click index.html (or `py -m http.server` in the folder).

**Verified by scripted bot playthrough in real browser:**
- Full run title → L1 → L2 → L3 → win screen, 0 deaths, 39/45 coins
- Spike damage, knockback, i-frames, heart loss all trigger correctly
- Fall off bottom = heart + checkpoint respawn; 0 hearts = refill + respawn
- Checkpoints activate (glow) and move respawn point
- R restarts level fresh; M toggles mute; console clean

**Bugs found & fixed during playtest:**
1. Exit ledge in L1 was 1 tile thin — player could run *underneath* the flag. Thickened.
2. Exit hitbox 2 tiles tall — jumpable over. Now 4 tiles (pole height).
3. Checkpoint hitbox 1 tile — jumpable over. Now 3 tiles tall.
4. L2 opening too dense (2-tile ledge between spike jump and gap climb). Widened.

**Tuning notes** (constants at top of game.js):
- Jump ~2.9 tiles high, ~4.3 tiles long at full speed — all gaps ≤3, all climbs ≤2
- Coyote 90ms, buffer 110ms, jump cut 0.45, fall gravity 1.55×
