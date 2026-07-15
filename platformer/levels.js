// ============================================================
//  NEON CANYON — LEVELS
//  Each level is a grid of characters, one string per row.
//  Tile size: 32px. Rows are read top -> bottom.
//
//  LEGEND
//    #   solid platform
//    ^   spikes (hurt!)
//    o   coin
//    P   player start (exactly one per level)
//    C   checkpoint
//    E   exit flag
//    (space) empty air
//
//  Rows can be shorter than the level width — missing
//  characters count as empty air. Design your own maps here!
// ============================================================

const LEVELS = [
  {
    name: "Level 1 — First Steps",
    map: [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "                                                 ooo",
      "                                                 ###",
      "                               o            ooo          E",
      "                     oo                     ###        ######",
      "  P  ooo            #####      ^^  C                   ######",
      "############  ###########  ############  #####################",
      "############  ###########  ############  #####################",
    ],
  },
  {
    name: "Level 2 — Canyon Hops",
    map: [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "                                                                ooo E",
      "                          oo       o     oo                  ###########",
      "         ooo              ^^      ###   C         ooo      #############",
      "  P ooo        ^^     #########        ####              ###############",
      "#########   ########  #########               ####^^^###################",
      "#########   ########  #########               ##########################",
    ],
  },
  {
    name: "Level 3 — Neon Peaks",
    map: [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "                                 ooCoo",
      "                            oo   ######                                   oo",
      "                           ####  ######",
      "                       o         ######                                   ##    E",
      "                 o    ###        ######     o     o    o                      ######",
      "       ooo                       ######                               ##      ######",
      "  P             ###              ######     ^^   ^^^   ^^        C            ######",
      "#######   ###                    ############################   ###           ######",
      "#######   ###                    ############################   ###           ######",
    ],
  },
  {
    // 6-wide gaps can't be jumped — dash mid-air (Shift/X) to cross them!
    name: "Level 4 — Dash Canyon",
    map: [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "          oooo                 oo                     oo",
      "                                      oooo                   oooo",
      "  P              C             ^^            C  ^^^                     E",
      "#########      ##########   #########      ##########    ###      ##########",
      "#########      ##########   #########      ##########    ###      ##########",
    ],
  },
  {
    name: "Level 5 — Neon Finale",
    map: [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "                                    oCo   oooo  o",
      "                                   ######      ###",
      "                                   ######",
      "                              ###  ######           ###",
      "                                   ######                                    ooo     E",
      "             oooo       ###        ######                ###                     #########",
      "  P                C               ######                      ^^   ^^^  ^^C     #########",
      "######   ###      ###              ######                   ################     #########",
      "######   ###      ###              ######                   ################     #########",
    ],
  },
];

// Sanity checker — run validateLevels() in the browser console.
// Returns [] when everything is fine.
function validateLevels() {
  const problems = [];
  const at = (map, r, c) => (map[r] && map[r][c]) || " ";
  LEVELS.forEach((lvl, i) => {
    const m = lvl.map;
    const count = (ch) => m.join("").split(ch).length - 1;
    if (m.length !== 17) problems.push(`${lvl.name}: has ${m.length} rows, expected 17`);
    if (count("P") !== 1) problems.push(`${lvl.name}: needs exactly one P`);
    if (count("E") < 1) problems.push(`${lvl.name}: has no exit E`);
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        const ch = m[r][c];
        if ("^CEP".includes(ch) && at(m, r + 1, c) !== "#") {
          problems.push(`${lvl.name}: '${ch}' at row ${r}, col ${c} is floating (no # below)`);
        }
      }
    }
  });
  return problems;
}
