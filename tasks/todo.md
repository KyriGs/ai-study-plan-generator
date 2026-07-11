# Neon Canyon — Build Checklist

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
