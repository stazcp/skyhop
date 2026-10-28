// Level maps. Each level is built on a 14-row grid of 16px tiles; ground's
// top surface is row 12. Built with a few helpers instead of hand-typed
// strings so every row is always the same width.
//
// Tiles:    # ground   B brick   ? coin block   P power block   = stone
//           [ ] pipe lip   { } pipe body
//           - one-way plank   ^ spikes   o coin
// Entities: @ start   e blob   s spiky (can't be stomped)   C checkpoint
//           m platform sliding right and back   v platform sinking and rising
//           F goal flag (pole top)
(() => {
  const ROWS = 14;

  function level(name, theme, width, draw) {
    const rows = Array.from({ length: ROWS }, () => Array(width).fill(" "));
    const set = (x, y, ch) => {
      if (x >= 0 && x < width && y >= 0 && y < ROWS) rows[y][x] = ch;
    };
    const L = {
      // solid ground from column x0 to x1 (inclusive), top surface at row `top`
      ground(x0, x1, top = 12) {
        for (let x = x0; x <= x1; x++) for (let y = top; y < ROWS; y++) set(x, y, "#");
      },
      // a run of tiles/entities; spaces leave the cell alone
      at(x, y, str) {
        [...str].forEach((ch, i) => ch !== " " && set(x + i, y, ch));
      },
      col(x, y0, y1, ch) {
        for (let y = y0; y <= y1; y++) set(x, y, ch);
      },
      // a staircase of `n` steps going up (dir 1) or down (dir -1)
      stairs(x, n, dir) {
        for (let i = 0; i < n; i++) {
          const h = dir > 0 ? i + 1 : n - i;
          L.col(x + i, 12 - h, 11, "=");
        }
      },
      // a pipe `h` tiles tall (2 wide) standing on the ground
      pipe(x, h) {
        L.at(x, 12 - h, "[]");
        for (let y = 13 - h; y <= 11; y++) L.at(x, y, "{}");
      },
      flag(x) {
        set(x, 2, "F");
        set(x, 11, "=");
      },
    };
    draw(L);
    return { name, theme, rows: rows.map((r) => r.join("")) };
  }

  window.SKYHOP_LEVELS = [
    level("Meadow", "meadow", 200, (L) => {
      L.ground(0, 68);
      L.ground(72, 90);
      L.ground(94, 147);
      L.ground(151, 199);
      L.at(3, 11, "@");
      L.at(14, 8, "?");
      L.at(19, 8, "B?BPB");
      L.at(21, 4, "?");
      L.at(25, 11, "e");
      L.pipe(30, 2);
      L.pipe(39, 3);
      L.at(43, 11, "e");
      L.pipe(48, 3);
      L.at(53, 11, "e e");
      L.at(58, 8, "o o o");
      L.at(63, 8, "BPB");
      // gap 69-71
      L.at(75, 8, "BBB");
      L.at(77, 4, "???");
      L.at(81, 11, "e e");
      L.at(85, 9, "oooo");
      // gap 91-93
      L.at(97, 8, "B?B");
      L.at(101, 11, "C");
      L.at(107, 8, "BBBBBBBB");
      L.at(108, 5, "oooooo");
      L.at(110, 7, "e");
      L.at(113, 7, "e");
      L.at(118, 11, "e e");
      L.at(123, 8, "?");
      L.at(127, 8, "P");
      L.pipe(131, 2);
      L.pipe(137, 3);
      L.at(141, 11, "e");
      L.stairs(144, 4, 1);
      // gap 148-150
      L.stairs(151, 4, -1);
      L.at(160, 11, "e e");
      L.at(166, 8, "o?o");
      L.at(170, 11, "e");
      L.stairs(178, 8, 1);
      L.col(186, 4, 11, "=");
      L.flag(194);
    }),

    level("Dusk Cliffs", "dusk", 210, (L) => {
      L.ground(0, 22);
      L.at(3, 11, "@");
      L.at(9, 8, "?P?");
      L.at(16, 11, "e");
      // gap 23-28, crossed on a sliding platform
      L.at(23, 10, "m");
      L.ground(29, 46);
      L.at(32, 9, "----");
      L.at(33, 6, "ooo");
      L.at(38, 11, "s");
      L.at(42, 8, "B?B");
      L.ground(47, 58, 9);
      L.at(50, 8, "e");
      L.at(54, 8, "e");
      L.at(52, 5, "?");
      L.ground(59, 64);
      // pit 65-68: needs a running jump
      L.at(65, 8, "oooo");
      L.ground(69, 84);
      L.at(72, 11, "s");
      L.at(76, 11, "e e");
      L.at(78, 8, "BBPBB");
      L.ground(85, 100);
      L.at(89, 11, "^^^");
      L.at(94, 11, "C");
      L.at(97, 8, "?");
      // gap 101-109: a lift, then a slider
      L.at(102, 8, "v");
      L.at(106, 9, "m");
      L.ground(110, 130);
      L.at(113, 11, "s");
      L.at(116, 11, "s");
      L.at(118, 8, "-----");
      L.at(119, 5, "ooo");
      L.at(124, 11, "e");
      L.pipe(127, 3);
      // gap 131-133
      L.ground(134, 160, 10);
      L.at(138, 9, "e e");
      L.at(141, 6, "B?BPB");
      L.at(150, 9, "s");
      L.at(156, 9, "e");
      // gap 161-163
      L.ground(164, 209);
      L.at(168, 11, "e e");
      L.at(174, 8, "o o o");
      L.at(179, 11, "s");
      L.stairs(184, 6, 1);
      L.col(190, 6, 11, "=");
      L.flag(198);
    }),

    level("Night Fort", "night", 220, (L) => {
      L.ground(0, 30);
      L.at(3, 11, "@");
      L.at(8, 8, "?B?");
      L.at(14, 11, "s");
      L.at(18, 8, "BPB");
      L.at(22, 11, "e e");
      L.at(27, 11, "^^");
      // pit 31-34
      L.ground(35, 48);
      L.pipe(38, 2);
      L.at(41, 11, "s");
      // a lift up to the high wall
      L.at(45, 7, "v");
      L.ground(49, 62, 7);
      L.at(52, 6, "e");
      L.at(57, 6, "s");
      L.at(54, 3, "ooo");
      L.ground(63, 80);
      L.at(66, 8, "B?B?B");
      L.at(68, 11, "e");
      L.at(72, 11, "e");
      L.at(76, 11, "^^^");
      // long pit 81-93: two sliders
      L.at(82, 10, "m");
      L.at(88, 10, "m");
      L.ground(94, 120);
      L.at(96, 11, "C");
      L.at(100, 8, "--------");
      L.at(101, 7, "e");
      L.at(105, 7, "e");
      L.at(102, 4, "?P?");
      L.at(110, 11, "s");
      L.at(113, 11, "s");
      L.at(116, 11, "^^");
      // a brick bridge over a spike bed
      L.ground(121, 140);
      L.at(121, 11, "^^^^^^^^");
      L.at(121, 9, "BBBBBBBB");
      L.at(124, 8, "e");
      L.at(131, 11, "e");
      L.at(134, 11, "s");
      L.pipe(137, 3);
      // gap 141-144
      L.ground(145, 219);
      L.at(148, 11, "e e e");
      L.at(154, 8, "B?B?B");
      L.at(160, 11, "s");
      L.at(164, 11, "^^");
      L.at(168, 8, "-----");
      L.at(169, 5, "oooo");
      L.at(175, 11, "e e");
      L.stairs(184, 8, 1);
      L.col(192, 4, 11, "=");
      L.flag(200);
    }),
  ];
})();
