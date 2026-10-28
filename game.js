// Skyhop — a small pixel platformer. Plain canvas + Web Audio, no
// dependencies, no image files: every sprite is drawn in code.
(() => {
  "use strict";

  const T = 16; // tile size
  const ROWS = 14;
  const VIEW_H = ROWS * T;
  const STEP = 1000 / 60;
  const LEVELS = window.SKYHOP_LEVELS;
  const START_LIVES = 3;
  const LEVEL_TIME = 300;

  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  let VIEW_W = 320;

  // ---------- storage (never required: private mode can throw) ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("skyhop:" + key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("skyhop:" + key, JSON.stringify(value));
      } catch {
        /* ignore */
      }
    },
  };

  // ---------- input ----------
  // each action is held while any source (keyboard, touch, gamepad) holds it
  const hold = { left: new Set(), right: new Set(), jump: new Set(), run: new Set() };
  let jumpQueued = false;
  let fireQueued = false; // run doubles as the fire button
  const down = (a) => hold[a].size > 0;
  function press(action, src) {
    if (action === "jump" && !down("jump")) jumpQueued = true;
    if (action === "run" && !down("run")) fireQueued = true;
    hold[action].add(src);
  }
  const release = (action, src) => hold[action].delete(src);
  const releaseAll = () => Object.values(hold).forEach((s) => s.clear());

  const KEYS = {
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
    ArrowUp: "jump", KeyW: "jump", Space: "jump", KeyZ: "jump", KeyK: "jump",
    ShiftLeft: "run", ShiftRight: "run", KeyX: "run", KeyJ: "run",
  };

  addEventListener("keydown", (e) => {
    audio();
    // Enter/Space on a focused menu button: let the browser click that button
    if ((e.code === "Enter" || e.code === "Space") && e.target.closest?.(".overlay button")) return;
    const action = KEYS[e.code];
    if (action) {
      e.preventDefault();
      if (!e.repeat) press(action, "k:" + e.code);
    }
    if (e.repeat) return;
    if (e.code === "Enter" || e.code === "Escape" || e.code === "KeyP") {
      e.preventDefault();
      onMenuKey(e.code);
    } else if (e.code === "KeyM") {
      toggleMute();
    }
  });
  addEventListener("keyup", (e) => {
    const action = KEYS[e.code];
    if (action) release(action, "k:" + e.code);
  });
  addEventListener("blur", () => {
    releaseAll();
    pause(true);
  });
  document.addEventListener("visibilitychange", () => document.hidden && pause(true));

  // touch: a d-pad you can slide a thumb across, plus jump and run buttons
  function bindTouch() {
    const pad = $("dpad");
    const padTouches = new Map();
    const updatePad = (id, x) => {
      const r = pad.getBoundingClientRect();
      const dir = x < r.left + r.width / 2 ? "left" : "right";
      const prev = padTouches.get(id);
      if (prev === dir) return;
      if (prev) release(prev, "t" + id);
      padTouches.set(id, dir);
      press(dir, "t" + id);
    };
    const endPad = (e) => {
      const prev = padTouches.get(e.pointerId);
      if (prev) release(prev, "t" + e.pointerId);
      padTouches.delete(e.pointerId);
    };
    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      audio();
      pad.setPointerCapture(e.pointerId);
      updatePad(e.pointerId, e.clientX);
    });
    pad.addEventListener("pointermove", (e) => padTouches.has(e.pointerId) && updatePad(e.pointerId, e.clientX));
    pad.addEventListener("pointerup", endPad);
    pad.addEventListener("pointercancel", endPad);

    for (const btn of document.querySelectorAll("[data-hold]")) {
      const action = btn.dataset.hold;
      const end = (e) => release(action, "t" + e.pointerId);
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        audio();
        btn.setPointerCapture(e.pointerId);
        press(action, "t" + e.pointerId);
      });
      btn.addEventListener("pointerup", end);
      btn.addEventListener("pointercancel", end);
    }
  }

  // the first touch anywhere shows the on-screen controls
  addEventListener(
    "touchstart",
    () => {
      document.body.classList.add("touch");
      resize();
    },
    { once: true, passive: true }
  );

  let padWasStart = false;
  function pollGamepad() {
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
    if (!gp) return;
    const b = (i) => !!gp.buttons[i]?.pressed;
    const ax = gp.axes[0] || 0;
    const want = {
      left: ax < -0.4 || b(14),
      right: ax > 0.4 || b(15),
      jump: b(0) || b(1),
      run: b(2) || b(3) || b(7),
    };
    for (const [action, on] of Object.entries(want)) {
      if (on && !hold[action].has("g")) press(action, "g");
      if (!on) release(action, "g");
    }
    if (b(9) && !padWasStart) onMenuKey("Enter");
    padWasStart = b(9);
  }

  // ---------- audio ----------
  let actx = null;
  let master = null;
  let muted = store.get("muted", false);

  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(actx.destination);
      // a resumed run can reach play before the first key wakes audio up
      if (game.state === "play" && !game.paused) playMusic(LEVELS[levelIndex].theme);
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  function toggleMute() {
    muted = !muted;
    store.set("muted", muted);
    if (master) master.gain.value = muted ? 0 : 1;
    $("mute").textContent = muted ? "♪̸" : "♪";
    $("mute").setAttribute("aria-pressed", String(muted));
  }

  function tone(freq, dur, type = "square", vol = 0.06, slideTo = 0, when = 0) {
    if (!actx) return;
    const t = actx.currentTime + when;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol = 0.12) {
    if (!actx) return;
    const len = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = actx.createBufferSource();
    const g = actx.createGain();
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(g).connect(master);
    src.start();
  }

  const arp = (notes, gap, type = "square", vol = 0.05, dur = 0.12) =>
    notes.forEach((n, i) => tone(n, dur, type, vol, 0, i * gap));

  const SFX = {
    jump: () => tone(260, 0.16, "square", 0.05, 640),
    coin: () => {
      tone(988, 0.06, "square", 0.05);
      tone(1319, 0.22, "square", 0.05, 0, 0.06);
    },
    stomp: () => tone(420, 0.12, "square", 0.07, 110),
    bump: () => tone(150, 0.09, "triangle", 0.18, 80),
    brick: () => noise(0.2),
    sprout: () => tone(220, 0.35, "square", 0.04, 880),
    power: () => arp([392, 523, 659, 784, 1047, 1319], 0.06),
    hurt: () => tone(520, 0.4, "sawtooth", 0.05, 90),
    die: () => arp([494, 466, 440, 392, 330, 262], 0.13, "square", 0.06, 0.16),
    flag: () => tone(300, 0.9, "square", 0.04, 1200),
    oneup: () => arp([659, 784, 1319, 1047, 1175, 1568], 0.08),
    tick: () => tone(1760, 0.03, "square", 0.025),
    clear: () => arp([523, 659, 784, 1047, 784, 1047], 0.12, "square", 0.05, 0.2),
    over: () => arp([392, 330, 262, 196], 0.25, "triangle", 0.12, 0.3),
    fire: () => tone(880, 0.1, "square", 0.04, 220),
    pause: () => arp([660, 880], 0.08, "square", 0.04),
    win: () => arp([523, 659, 784, 1047, 1319, 1568, 2093], 0.1, "square", 0.05, 0.25),
  };
  const sfx = (name) => actx && SFX[name]();

  // tiny chiptune loops, one per world. Eighth notes; "." rests.
  const SONGS = {
    meadow: {
      bpm: 150,
      lead: "E5 . G5 . C6 . G5 . A5 . F5 . G5 . E5 . C5 . D5 E5 F5 . E5 . D5 . . .",
      bass: "C3 . G3 . C3 . G3 . F3 . C4 . G3 . D3 . A2 . E3 . F3 . G3 . G2 . B2 .",
    },
    dusk: {
      bpm: 140,
      lead: "A4 . C5 . E5 . D5 C5 B4 . G4 . A4 . . . F4 . A4 . C5 . B4 A4 G#4 . B4 . E5 . . .",
      bass: "A2 . E3 . A2 . E3 . G2 . D3 . G2 . D3 . F2 . C3 . F2 . C3 . E2 . B2 . E2 . G#2 .",
    },
    night: {
      bpm: 128,
      lead: "D5 . . F5 E5 . D5 . A4 . . . C5 . D5 . F5 . . A5 G5 . F5 . E5 . C5 . D5 . . .",
      bass: "D2 . A2 . D3 . A2 . A#1 . F2 . A#2 . F2 . C2 . G2 . C3 . G2 . A1 . E2 . A2 . C#3 .",
    },
  };
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const freqOf = (n) => {
    const m = /^([A-G])(#?)(\d)$/.exec(n);
    if (!m) return 0;
    const midi = (Number(m[3]) + 1) * 12 + NOTE[m[1]] + (m[2] ? 1 : 0);
    return 440 * 2 ** ((midi - 69) / 12);
  };
  for (const s of Object.values(SONGS)) {
    s.lead = s.lead.split(" ").map(freqOf);
    s.bass = s.bass.split(" ").map(freqOf);
  }

  const music = { song: null, step: 0, next: 0, timer: 0 };
  function playMusic(name) {
    stopMusic();
    if (!actx) return;
    music.song = SONGS[name];
    music.step = 0;
    music.next = actx.currentTime + 0.05;
    music.timer = setInterval(scheduleMusic, 25);
  }
  function stopMusic() {
    clearInterval(music.timer);
    music.song = null;
  }
  function scheduleMusic() {
    const s = music.song;
    if (!s || !actx) return;
    const dt = 60 / s.bpm / 2;
    while (music.next < actx.currentTime + 0.12) {
      const i = music.step % s.lead.length;
      const when = music.next - actx.currentTime;
      if (s.lead[i]) tone(s.lead[i], dt * 0.9, "square", 0.022, 0, when);
      if (s.bass[i % s.bass.length]) tone(s.bass[i % s.bass.length], dt * 1.6, "triangle", 0.07, 0, when);
      music.next += dt;
      music.step++;
    }
  }

  // ---------- themes ----------
  const THEMES = {
    meadow: {
      sky: ["#5aaefc", "#bfe5ff"],
      far: "#9fd6a0", near: "#6dbf5f",
      grass: "#47b03a", grassHi: "#93e56c", dirt: "#b97a42", dirtDk: "#8a5429",
      ground: "grass",
      brick: "#c8643c", brickDk: "#6d2e18", brickHi: "#e98c5c",
      stone: "#a3acb6", stoneDk: "#5c6570", stoneHi: "#d7dde3",
      plank: "#c8914f", plankDk: "#6b4524",
      cloud: "#ffffff", platform: "#d8a24a", accent: "#ff8c3a",
      pipe: "#3bb0c9", pipeHi: "#a4ecf7", pipeDk: "#1d5a6b",
    },
    dusk: {
      sky: ["#3b1f5c", "#ff9a62"],
      far: "#8e4a74", near: "#5e2f5c", sun: "#ffd27a",
      grass: "#e2914a", grassHi: "#ffc27a", dirt: "#7a3d3d", dirtDk: "#542628",
      ground: "grass",
      brick: "#b8543f", brickDk: "#4e1d1d", brickHi: "#e0805e",
      stone: "#a88d9a", stoneDk: "#5a4253", stoneHi: "#d9c2cc",
      plank: "#c48552", plankDk: "#5a3122",
      cloud: "#ffc7a8", platform: "#e2914a", accent: "#ffd27a",
      pipe: "#c98a4b", pipeHi: "#f2c48c", pipeDk: "#5e3420",
    },
    night: {
      sky: ["#070b24", "#28336a"],
      far: "#1f2a5a", near: "#141c40", moon: "#f4f1d0",
      grass: "#6c7bd1", grassHi: "#a6b3ff", dirt: "#3b4270", dirtDk: "#262b4f",
      ground: "rock",
      brick: "#5d5f8f", brickDk: "#25264a", brickHi: "#8587bd",
      stone: "#7d84a8", stoneDk: "#3a3f63", stoneHi: "#b9bfdc",
      plank: "#8a7360", plankDk: "#3e3027",
      cloud: "#3a4683", platform: "#9aa3d8", accent: "#7ef0ff",
      pipe: "#8f98b8", pipeHi: "#d3d8ec", pipeDk: "#353a5c",
    },
  };

  // ---------- pixel helpers ----------
  const makeCanvas = (w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  };
  const px = (c, x, y, w, h, color) => {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  };

  const GLYPH_Q = [".###.", "#...#", "....#", "..##.", "..#..", ".....", "..#.."];
  const drawGlyph = (c, rows, x, y, color) =>
    rows.forEach((r, j) => [...r].forEach((ch, i) => ch === "#" && px(c, x + i, y + j, 1, 1, color)));

  // a 3x5 pixel font for score popups
  const FONT = {
    0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111",
    4: "101101111001001", 5: "111100111001111", 6: "111100111101111", 7: "111001010010010",
    8: "111101111101111", 9: "111101111001111", U: "101101101101111", P: "111101111100100",
  };
  function drawText(c, text, x, y, color) {
    [...text].forEach((ch, k) => {
      const f = FONT[ch];
      if (!f) return;
      for (let i = 0; i < 15; i++) if (f[i] === "1") px(c, x + k * 4 + (i % 3), y + Math.floor(i / 3), 1, 1, color);
    });
  }

  // pre-rendered 16x16 tiles for the current theme
  let tiles = {};
  function buildTiles(th) {
    const t = (draw) => {
      const c = makeCanvas(T, T);
      draw(c.getContext("2d"));
      return c;
    };
    const specks = (c, color, seed) => {
      for (let i = 0; i < 6; i++) {
        const h = (seed * 2654435761 + i * 40503) >>> 0;
        px(c, (h % 13) + 1, ((h >>> 8) % 10) + 5, i % 3 ? 1 : 2, 1, color);
      }
    };
    const out = {};
    if (th.ground === "grass") {
      out.groundTop = t((c) => {
        px(c, 0, 0, T, T, th.dirt);
        specks(c, th.dirtDk, 1);
        px(c, 0, 0, T, 4, th.grass);
        for (let x = 0; x < T; x += 2) px(c, x, 4, 1, (x / 2) % 2 ? 2 : 1, th.grass);
        px(c, 0, 0, T, 1, th.grassHi);
        for (let x = 1; x < T; x += 4) px(c, x, 1, 1, 1, th.grassHi);
      });
      out.ground = t((c) => {
        px(c, 0, 0, T, T, th.dirt);
        specks(c, th.dirtDk, 2);
      });
    } else {
      const rock = (c, top) => {
        px(c, 0, 0, T, T, th.dirt);
        px(c, 0, 7, T, 1, th.dirtDk);
        px(c, 0, 15, T, 1, th.dirtDk);
        px(c, 5, 0, 1, 7, th.dirtDk);
        px(c, 12, 8, 1, 7, th.dirtDk);
        px(c, 0, 0, 5, 1, th.grass);
        px(c, 6, 8, 6, 1, th.grass);
        if (top) {
          px(c, 0, 0, T, 2, th.grass);
          px(c, 0, 0, T, 1, th.grassHi);
        }
      };
      out.groundTop = t((c) => rock(c, true));
      out.ground = t((c) => rock(c, false));
    }
    out.B = t((c) => {
      px(c, 0, 0, T, T, th.brick);
      for (const y of [0, 8]) px(c, 0, y, T, 1, th.brickDk);
      for (const y of [1, 9]) px(c, 0, y, T, 1, th.brickHi);
      px(c, 7, 1, 1, 7, th.brickDk);
      px(c, 15, 1, 1, 7, th.brickDk);
      px(c, 3, 9, 1, 7, th.brickDk);
      px(c, 11, 9, 1, 7, th.brickDk);
    });
    const block = (c, fill, hi, dk, glyph) => {
      px(c, 0, 0, T, T, dk);
      px(c, 1, 1, 14, 14, fill);
      px(c, 1, 1, 14, 1, hi);
      px(c, 1, 1, 1, 14, hi);
      for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) px(c, x, y, 1, 1, dk);
      if (glyph) {
        drawGlyph(c, GLYPH_Q, 6, 5, dk);
        drawGlyph(c, GLYPH_Q, 5, 4, "#fff6d6");
      }
    };
    out.Q = ["#f6b72e", "#ffcf4d", "#e9a21f"].map((fill) => t((c) => block(c, fill, "#ffe7a1", "#9a5a12", true)));
    out.U = t((c) => block(c, "#a0703e", "#c08d55", "#5b3a1c", false));
    out["="] = t((c) => {
      px(c, 0, 0, T, T, th.stoneDk);
      px(c, 0, 0, 15, 15, th.stoneHi);
      px(c, 1, 1, 14, 14, th.stone);
      px(c, 4, 4, 2, 1, th.stoneHi);
      px(c, 10, 9, 2, 1, th.stoneDk);
    });
    // pipes are two tiles wide: a lip on top ([ ]) over a body ({ })
    const pipe = (c, left, lip) => {
      const x0 = lip ? 0 : left ? 2 : 0;
      const w = lip ? T : 14;
      px(c, x0, 0, w, T, th.pipeDk);
      px(c, x0 + (left ? 1 : 0), lip ? 1 : 0, w - 1, lip ? 14 : T, th.pipe);
      if (left) {
        px(c, x0 + 3, lip ? 2 : 0, 2, lip ? 12 : T, th.pipeHi);
        px(c, x0 + 7, lip ? 2 : 0, 1, lip ? 12 : T, th.pipeHi);
      } else {
        px(c, 9, lip ? 2 : 0, 3, lip ? 12 : T, th.pipeDk);
      }
    };
    out["["] = t((c) => pipe(c, true, true));
    out["]"] = t((c) => pipe(c, false, true));
    out["{"] = t((c) => pipe(c, true, false));
    out["}"] = t((c) => pipe(c, false, false));
    out["-"] = t((c) => {
      px(c, 0, 0, T, 6, th.plankDk);
      px(c, 0, 1, T, 4, th.plank);
      px(c, 0, 1, T, 1, "rgba(255,255,255,0.35)");
      px(c, 2, 3, 1, 1, th.plankDk);
      px(c, 13, 3, 1, 1, th.plankDk);
    });
    out["^"] = t((c) => {
      for (const ox of [0, 8]) {
        for (let i = 0; i < 4; i++) {
          px(c, ox + 3 - i, 8 + i * 2, 2 + i * 2, 2, "#dfe5ec");
          px(c, ox + 3 - i, 8 + i * 2, 1, 2, "#6b7480");
        }
      }
      px(c, 0, 15, T, 1, "#6b7480");
    });
    return out;
  }

  // sky and parallax layers for the current level and view width
  let bg = null;
  function buildBackground(th, levelW, seed) {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

    const sky = makeCanvas(VIEW_W, VIEW_H);
    const sc = sky.getContext("2d");
    // banded gradient: steps of 8px keep it pixel-y
    const [a, b] = th.sky.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    for (let y = 0; y < VIEW_H; y += 8) {
      const k = y / VIEW_H;
      sc.fillStyle = `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
      sc.fillRect(0, y, VIEW_W, 8);
    }
    if (th.moon) {
      for (let i = 0; i < 60; i++) px(sc, Math.floor(rnd() * VIEW_W), Math.floor(rnd() * 140), 1, 1, rnd() > 0.8 ? "#ffffff" : "#8f9ad6");
      disc(sc, VIEW_W - 60, 40, 14, th.moon);
      for (const [x, y, w] of [[-66, 34, 4], [-56, 44, 6], [-62, 48, 2]]) px(sc, VIEW_W + x, y, w, w > 2 ? 4 : 2, "#d9d4a8");
    }
    if (th.sun) disc(sc, VIEW_W * 0.7, 150, 34, th.sun);

    // far hills (x0.25) and near hills (x0.5), drawn as 2px columns
    const layer = (factor, color, minH, maxH, gapK) => {
      const w = Math.ceil(levelW * factor + VIEW_W + 64);
      const c = makeCanvas(w, VIEW_H);
      const lc = c.getContext("2d");
      let x = -40;
      while (x < w) {
        const hw = 40 + rnd() * 70;
        const hh = minH + rnd() * (maxH - minH);
        for (let dx = -hw; dx < hw; dx += 2) {
          const h = Math.round((hh * Math.sqrt(1 - (dx / hw) ** 2)) / 2) * 2;
          px(lc, Math.round(x + hw + dx), VIEW_H - 32 - h, 2, h + 32, color);
        }
        x += hw * gapK + rnd() * 40;
      }
      return { c, factor };
    };
    const far = layer(0.25, th.far, 40, 90, 1.3);
    const near = layer(0.5, th.near, 20, 60, 1.9);

    const clouds = [];
    const cw = Math.ceil(levelW * 0.15 + VIEW_W);
    for (let x = 20; x < cw; x += 70 + rnd() * 90) clouds.push({ x, y: 16 + rnd() * 60, w: 3 + Math.floor(rnd() * 3) });
    bg = { sky, far, near, clouds };
  }

  function disc(c, cx, cy, r, color) {
    c.fillStyle = color;
    for (let y = -r; y <= r; y += 2) {
      const w = Math.round(Math.sqrt(r * r - y * y));
      c.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, 2);
    }
  }

  // ---------- world ----------
  const SOLID = "#B?P=U[]{}";
  let grid, W, theme, levelIndex, ents, player, particles, popups, bumps, flag, checkpoints, cam;
  let tick = 0;

  const tileAt = (tx, ty) => (ty < 0 || ty >= ROWS ? " " : tx < 0 || tx >= W ? "=" : grid[ty][tx]);
  const solid = (ch) => SOLID.includes(ch);

  const game = {
    state: "title", // title | intro | play | dead | flag | clear | over | win
    paused: false,
    timer: 0,
    score: 0,
    coins: 0,
    lives: START_LIVES,
    time: LEVEL_TIME,
    checkpoint: null,
    best: store.get("best", 0),
    reached: store.get("reached", 0),
  };

  function loadLevel(i) {
    levelIndex = i;
    const def = LEVELS[i];
    grid = def.rows.map((r) => [...r]);
    W = grid[0].length;
    theme = THEMES[def.theme];
    tiles = buildTiles(theme);
    buildBackground(theme, W * T, 1234 + i * 977);
    ents = [];
    particles = [];
    popups = [];
    bumps = new Map();
    checkpoints = [];
    flag = null;
    let start = { x: 2, y: 11 };
    let platforms = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < W; x++) {
        const ch = grid[y][x];
        if (!"@esCmvF".includes(ch)) continue;
        grid[y][x] = " ";
        if (ch === "@") start = { x, y };
        else if (ch === "e" || ch === "s") ents.push(makeEnemy(ch === "e" ? "blob" : "spiky", x, y));
        else if (ch === "C") checkpoints.push({ x: x * T + 8, y: (y + 1) * T, reached: false });
        else if (ch === "m" || ch === "v") {
          // neighbouring platforms run out of phase so their ends meet
          ents.push({ kind: "plat", axis: ch === "m" ? "x" : "y", x0: x * T, y0: y * T, x: x * T, y: y * T, w: 48, h: 8, dx: 0, dy: 0, t: platforms++ % 2 ? Math.PI : 0 });
        } else if (ch === "F") flag = { x: x * T + 7, top: y * T + 4, bottom: 11 * T, clothY: y * T + 8 };
      }
    }
    const cp = game.checkpoint;
    if (cp && cp.level === i) checkpoints.forEach((c) => c.x <= cp.x && (c.reached = true));
    const spawn = cp && cp.level === i ? { x: cp.x - 6, y: cp.y - 14 } : { x: start.x * T + 2, y: (start.y + 1) * T - 14 };
    player = {
      x: spawn.x, y: spawn.y, w: 12, h: 14, vx: 0, vy: 0,
      big: false, face: 1, onGround: false, coyote: 0, buffer: 0,
      invuln: 0, grow: 0, anim: 0, riding: null, combo: 0, deadT: 0, fire: false,
    };
    cam = 0;
    game.time = LEVEL_TIME;
    game.timer = 0;
  }

  function makeEnemy(kind, tx, ty) {
    const h = kind === "blob" ? 12 : 13;
    return { kind, x: tx * T + 1, y: (ty + 1) * T - h, w: 14, h, vx: -0.5, vy: 0, active: false, dead: null, deadT: 0 };
  }

  // ---------- physics ----------
  function moveX(b, dx) {
    b.x += dx;
    const y0 = Math.floor(b.y / T);
    const y1 = Math.floor((b.y + b.h - 0.01) / T);
    if (dx > 0) {
      const tx = Math.floor((b.x + b.w - 0.01) / T);
      for (let ty = y0; ty <= y1; ty++) {
        if (solid(tileAt(tx, ty))) {
          b.x = tx * T - b.w;
          return true;
        }
      }
    } else if (dx < 0) {
      const tx = Math.floor(b.x / T);
      for (let ty = y0; ty <= y1; ty++) {
        if (solid(tileAt(tx, ty))) {
          b.x = (tx + 1) * T;
          return true;
        }
      }
    }
    return false;
  }

  // returns "land", a ceiling hit { ty, hits }, or null
  function moveY(b, dy) {
    const prevBottom = b.y + b.h;
    b.y += dy;
    const x0 = Math.floor(b.x / T);
    const x1 = Math.floor((b.x + b.w - 0.01) / T);
    if (dy > 0) {
      const ty = Math.floor((b.y + b.h - 0.01) / T);
      for (let tx = x0; tx <= x1; tx++) {
        const ch = tileAt(tx, ty);
        if (solid(ch) || (ch === "-" && prevBottom <= ty * T + 0.01)) {
          b.y = ty * T - b.h;
          return "land";
        }
      }
    } else if (dy < 0) {
      const ty = Math.floor(b.y / T);
      const hits = [];
      for (let tx = x0; tx <= x1; tx++) if (solid(tileAt(tx, ty))) hits.push(tx);
      if (hits.length) {
        b.y = (ty + 1) * T;
        return { ty, hits };
      }
    }
    return null;
  }

  const overlap = (a, b, inset = 0) =>
    a.x + inset < b.x + b.w && a.x + a.w - inset > b.x && a.y + inset < b.y + b.h && a.y + a.h - inset > b.y;

  // ---------- scoring & effects ----------
  function addScore(n, x, y) {
    game.score += n;
    if (x !== undefined) popups.push({ x, y, text: String(n), t: 0 });
  }
  function addLife(x, y) {
    game.lives++;
    sfx("oneup");
    popups.push({ x, y, text: "1UP", t: 0 });
  }
  function addCoin(x, y) {
    game.coins++;
    addScore(200);
    sfx("coin");
    if (game.coins % 100 === 0) addLife(x, y);
  }

  function collectTileCoin(tx, ty) {
    grid[ty][tx] = " ";
    addCoin(tx * T, ty * T);
    for (let i = 0; i < 4; i++) particles.push({ kind: "spark", x: tx * T + 8, y: ty * T + 8, vx: Math.cos(i * 1.57 + 0.78) * 1.2, vy: Math.sin(i * 1.57 + 0.78) * 1.2, t: 0, life: 14 });
  }

  function bumpBlock(tx, ty) {
    const ch = grid[ty][tx];
    if (ch === "?") {
      grid[ty][tx] = "U";
      bumps.set(tx + "," + ty, 0);
      particles.push({ kind: "coin", x: tx * T + 4, y: ty * T - 8, vy: -4.6, t: 0, life: 26 });
      addCoin(tx * T, ty * T - 24);
    } else if (ch === "P") {
      grid[ty][tx] = "U";
      bumps.set(tx + "," + ty, 0);
      ents.push({ kind: player.big ? "flame" : "spark", x: tx * T + 1, y: ty * T + 2, w: 14, h: 14, vx: 0, vy: 0, rise: 16, topY: ty * T, active: true });
      sfx("sprout");
    } else if (ch === "B") {
      if (player.big) {
        grid[ty][tx] = " ";
        addScore(50);
        sfx("brick");
        for (const [vx, vy] of [[-1.2, -5], [1.2, -5], [-1, -3], [1, -3]]) particles.push({ kind: "shard", x: tx * T + 6, y: ty * T + 6, vx, vy, t: 0, life: 60 });
      } else {
        bumps.set(tx + "," + ty, 0);
        sfx("bump");
      }
    } else {
      sfx("bump");
    }
    // whatever sits on the bumped block gets knocked
    const top = ty * T;
    const zone = { x: tx * T, y: top - 4, w: T, h: 6 };
    for (const e of ents) {
      if (e.dead || !overlap(e, zone)) continue;
      if (e.kind === "blob" || e.kind === "spiky") knock(e);
      else if ((e.kind === "spark" || e.kind === "flame") && !e.rise) e.vy = -3.5;
    }
    if (tileAt(tx, ty - 1) === "o") collectTileCoin(tx, ty - 1);
  }

  function knock(e, dir) {
    e.dead = "flip";
    e.vy = -4;
    e.vx = dir ? Math.sign(dir) : player.x < e.x ? 1 : -1;
    addScore(100, e.x, e.y);
    sfx("stomp");
  }

  function puff(x, y) {
    for (let i = 0; i < 4; i++) particles.push({ kind: "ember", x, y, vx: Math.cos(i * 1.57 + 0.78) * 1, vy: Math.sin(i * 1.57 + 0.78) * 1, t: 0, life: 12 });
  }

  const COMBO = [100, 200, 400, 800, 1000, 2000, 4000, 8000];
  function stomp(e) {
    e.dead = "squash";
    e.deadT = 0;
    const n = player.combo++;
    if (n < COMBO.length) addScore(COMBO[n], e.x, e.y - 6);
    else addLife(e.x, e.y - 6);
    sfx("stomp");
    player.vy = down("jump") ? -6 : -3.6;
    player.onGround = false;
  }

  function hurt() {
    if (player.invuln > 0 || player.grow > 0 || game.state !== "play") return;
    if (player.fire) {
      player.fire = false;
      player.invuln = 120;
      sfx("hurt");
    } else if (player.big) {
      player.big = false;
      player.h = 14;
      player.y += 12;
      player.invuln = 120;
      player.grow = -40;
      sfx("hurt");
    } else {
      die();
    }
  }

  function die() {
    game.state = "dead";
    player.deadT = 0;
    player.big = false;
    player.fire = false;
    stopMusic();
    sfx("die");
  }

  // ---------- update ----------
  function update() {
    tick++;
    pollGamepad();
    const queued = jumpQueued;
    jumpQueued = false;
    // a fire press only counts while playing (not one left over from a menu)
    if (game.paused || game.state !== "play") fireQueued = false;

    if (game.paused) return;
    if (game.state === "title" || game.state === "over" || game.state === "win") {
      if (queued) onMenuKey("Enter");
      return;
    }
    if (game.state === "intro") {
      if (++game.timer > 110) {
        game.state = "play";
        game.timer = 0;
        setOverlay(null);
        playMusic(LEVELS[levelIndex].theme);
      }
      return;
    }

    updateFx();

    if (game.state === "dead") {
      player.deadT++;
      if (player.deadT === 30) player.vy = -5;
      if (player.deadT > 30) {
        player.vy = Math.min(player.vy + 0.3, 6);
        player.y += player.vy;
      }
      if (player.deadT > 160) {
        game.lives--;
        if (game.lives <= 0) gameOver();
        else startLevel(levelIndex, true);
      }
      return;
    }

    if (game.state === "clear") {
      // count leftover time into the score
      if (game.time > 0) {
        const n = Math.min(game.time, 2);
        game.time -= n;
        addScore(n * 50);
        if (tick % 3 === 0) sfx("tick");
      } else if (++game.timer > 90) {
        if (levelIndex + 1 < LEVELS.length) startLevel(levelIndex + 1, false);
        else winGame();
      }
      return;
    }

    // a grow/shrink freezes the action for a beat, like an old cartridge
    if (player.grow !== 0) {
      player.grow += player.grow > 0 ? -1 : 1;
      return;
    }

    if (game.state === "play" && ++game.timer >= 60) {
      game.timer = 0;
      game.time--;
      if (game.time === 100) sfx("hurt");
      if (game.time <= 0) {
        game.time = 0;
        player.big = false;
        die();
        return;
      }
    }

    updatePlatforms();
    if (game.state === "flag") updateFlag();
    else updatePlayer(queued);
    updateEntities();

    // camera leads a little ahead of the player
    const target = player.x + player.w / 2 - VIEW_W * 0.42;
    cam = Math.max(0, Math.min(W * T - VIEW_W, target));
  }

  function updatePlatforms() {
    for (const p of ents) {
      if (p.kind !== "plat") continue;
      p.t += 0.018;
      const k = (1 - Math.cos(p.t)) / 2;
      const nx = p.axis === "x" ? p.x0 + k * 3 * T : p.x0;
      const ny = p.axis === "y" ? p.y0 + k * 3 * T : p.y0;
      p.dx = nx - p.x;
      p.dy = ny - p.y;
      p.x = nx;
      p.y = ny;
    }
  }

  function updatePlayer(queued) {
    const p = player;
    const left = down("left");
    const right = down("right");
    const run = down("run");
    if (queued) p.buffer = 7;
    else if (p.buffer > 0) p.buffer--;
    if (fireQueued && p.fire && ents.filter((e) => e.kind === "fireball").length < 2) {
      ents.push({ kind: "fireball", x: p.x + (p.face > 0 ? p.w : -6), y: p.y + 6, w: 6, h: 6, vx: p.face * 3.6, vy: 1.5, active: true, t: 0 });
      sfx("fire");
    }
    fireQueued = false;

    // ride a platform: carry the player with it
    if (p.riding) {
      moveX(p, p.riding.dx);
      p.y = p.riding.y - p.h;
    }

    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    const max = run ? 2.6 : 1.5;
    if (dir) {
      p.face = dir;
      const skid = p.onGround && Math.sign(p.vx) === -dir;
      p.vx += dir * (skid ? 0.22 : p.onGround ? 0.09 : 0.07);
      if (Math.abs(p.vx) > max) p.vx = Math.sign(p.vx) * Math.max(max, Math.abs(p.vx) - 0.06);
    } else if (p.onGround) {
      p.vx = Math.abs(p.vx) <= 0.12 ? 0 : p.vx - Math.sign(p.vx) * 0.12;
    }

    if (p.onGround) p.coyote = 6;
    else if (p.coyote > 0) p.coyote--;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = -(5.2 + Math.abs(p.vx) * 0.25);
      p.coyote = 0;
      p.buffer = 0;
      p.onGround = false;
      p.riding = null;
      sfx("jump");
    }

    p.vy = Math.min(p.vy + (p.vy < 0 && down("jump") ? 0.24 : 0.55), 6);

    if (moveX(p, p.vx)) p.vx = 0;
    const wasGround = p.onGround;
    const prevBottom = p.y + p.h;
    const r = moveY(p, p.vy);
    p.onGround = false;
    p.riding = null;
    if (r === "land") {
      p.vy = 0;
      p.onGround = true;
    } else if (r) {
      p.vy = 1;
      const cx = p.x + p.w / 2;
      const tx = r.hits.reduce((best, h) => (Math.abs(h * T + 8 - cx) < Math.abs(best * T + 8 - cx) ? h : best));
      bumpBlock(tx, r.ty);
    }

    // land on moving platforms (one-way, from above)
    if (p.vy >= 0) {
      for (const pl of ents) {
        if (pl.kind !== "plat") continue;
        if (p.x + p.w > pl.x && p.x < pl.x + pl.w && prevBottom <= pl.y - pl.dy + 1 && p.y + p.h >= pl.y) {
          p.y = pl.y - p.h;
          p.vy = 0;
          p.onGround = true;
          p.riding = pl;
        }
      }
    }
    if (p.onGround) p.combo = 0;
    if (p.onGround && !wasGround && Math.abs(p.vx) < 0.5) p.anim = 0;
    p.anim += Math.abs(p.vx) * 0.12;
    if (p.invuln > 0) p.invuln--;

    // tiles the player is touching: coins, spikes
    const x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w - 0.01) / T);
    const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h - 0.01) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const ch = tileAt(tx, ty);
        if (ch === "o") collectTileCoin(tx, ty);
        else if (ch === "^" && p.y + p.h > ty * T + 9) hurt();
      }
    }

    if (p.y > VIEW_H + 16) {
      player.big = false;
      die();
      return;
    }

    for (const c of checkpoints) {
      if (!c.reached && p.x > c.x) {
        c.reached = true;
        game.checkpoint = { level: levelIndex, x: c.x, y: c.y };
        sfx("coin");
      }
    }

    // the pole's base block stops a walk-in, so touching it counts too
    if (flag && p.x + p.w >= flag.x - 7 && game.state === "play") grabFlag();
  }

  function grabFlag() {
    const p = player;
    game.state = "flag";
    stopMusic();
    sfx("flag");
    p.x = flag.x - p.w + 2;
    p.y = Math.min(p.y, flag.bottom - p.h);
    p.vx = 0;
    p.vy = 0;
    p.face = 1;
    const h = flag.bottom - (p.y + p.h);
    const points = h > 120 ? 5000 : h > 90 ? 2000 : h > 60 ? 800 : h > 30 ? 400 : 100;
    addScore(points, flag.x + 6, p.y);
  }

  function updateFlag() {
    const p = player;
    if (flag.clothY < flag.bottom - 12) flag.clothY += 2;
    if (p.y + p.h < flag.bottom) {
      p.y = Math.min(p.y + 2, flag.bottom - p.h);
      return;
    }
    // hop off and stroll right
    if (p.x < flag.x + 4) {
      p.x = flag.x + 4;
      p.vy = -2;
    }
    p.vx = 1.2;
    p.anim += 0.15;
    p.vy = Math.min(p.vy + 0.4, 6);
    moveX(p, p.vx);
    p.onGround = moveY(p, p.vy) === "land";
    if (p.onGround) p.vy = 0;
    if (p.x > flag.x + 72 && game.state === "flag") {
      game.state = "clear";
      game.timer = 0;
      sfx("clear");
      game.reached = Math.max(game.reached, Math.min(levelIndex + 1, LEVELS.length - 1));
      store.set("reached", game.reached);
    }
  }

  function updateEntities() {
    const p = player;
    for (const e of ents) {
      if (e.kind === "plat") continue;
      if (!e.active) {
        if (e.x < cam + VIEW_W + 24) e.active = true;
        else continue;
      }

      if (e.kind === "fireball") {
        e.t++;
        e.vy = Math.min(e.vy + 0.4, 5);
        const wall = moveX(e, e.vx);
        if (moveY(e, e.vy) === "land") e.vy = -3.2;
        if (wall || e.x < cam - 16 || e.x > cam + VIEW_W + 16 || e.y > VIEW_H) {
          e.gone = true;
          if (wall) puff(e.x + 3, e.y + 3);
          continue;
        }
        for (const o of ents) {
          if ((o.kind === "blob" || o.kind === "spiky") && o.active && !o.dead && overlap(e, o)) {
            knock(o, e.vx);
            e.gone = true;
            puff(e.x + 3, e.y + 3);
            break;
          }
        }
        continue;
      }

      if (e.kind === "spark" || e.kind === "flame") {
        if (e.rise > 0) {
          e.y -= 1;
          if (--e.rise === 0 && e.kind === "spark") e.vx = 1;
        } else if (e.kind === "flame") {
          // the flame stays put, only falling if knocked off its block
          if (e.vy) {
            e.vy = Math.min(e.vy + 0.35, 6);
            if (moveY(e, e.vy) === "land") e.vy = 0;
          }
        } else {
          e.vy = Math.min(e.vy + 0.35, 6);
          if (moveX(e, e.vx)) e.vx = -e.vx;
          if (moveY(e, e.vy) === "land") e.vy = 0;
        }
        if (game.state === "play" && !e.rise && overlap(p, e)) {
          e.gone = true;
          sfx("power");
          addScore(1000, e.x, e.y);
          if (!p.big) {
            p.big = true;
            p.h = 26;
            p.y -= 12;
            p.grow = 40;
          }
          if (e.kind === "flame") p.fire = true;
        }
        if (e.y > VIEW_H + 32) e.gone = true;
        continue;
      }

      // blobs and spikies
      if (e.dead === "squash") {
        if (++e.deadT > 30) e.gone = true;
        continue;
      }
      if (e.dead === "flip") {
        e.vy = Math.min(e.vy + 0.3, 6);
        e.x += e.vx;
        e.y += e.vy;
        if (e.y > VIEW_H + 32) e.gone = true;
        continue;
      }
      e.vy = Math.min(e.vy + 0.4, 6);
      if (moveX(e, e.vx)) e.vx = -e.vx;
      if (moveY(e, e.vy) === "land") e.vy = 0;
      if (e.y > VIEW_H + 32) e.gone = true;

      if (game.state !== "play" || p.grow) continue;
      if (overlap(p, e, 2)) {
        const falling = p.vy > 0 && p.y + p.h - p.vy <= e.y + 6;
        if (falling && e.kind === "blob") stomp(e);
        else hurt();
      }
    }

    // enemies turn around when they bump into each other
    const walkers = ents.filter((e) => (e.kind === "blob" || e.kind === "spiky") && e.active && !e.dead);
    for (let i = 0; i < walkers.length; i++) {
      for (let j = i + 1; j < walkers.length; j++) {
        const a = walkers[i], b = walkers[j];
        if (overlap(a, b)) {
          const dirA = a.x < b.x ? -1 : 1;
          a.vx = Math.abs(a.vx) * dirA;
          b.vx = Math.abs(b.vx) * -dirA;
        }
      }
    }
    ents = ents.filter((e) => !e.gone && !(e.active && e.x < cam - 240 && e.kind !== "plat"));
  }

  function updateFx() {
    for (const [k, t] of bumps) t >= 8 ? bumps.delete(k) : bumps.set(k, t + 1);
    for (const q of particles) {
      q.t++;
      if (q.kind === "coin") {
        q.y += q.vy;
        q.vy += 0.35;
      } else {
        q.x += q.vx;
        q.y += q.vy;
        if (q.kind === "shard") q.vy += 0.3;
      }
    }
    particles = particles.filter((q) => q.t < q.life);
    for (const q of popups) q.t++;
    popups = popups.filter((q) => q.t < 50);
  }

  // ---------- drawing ----------
  const PIP_BASE = { line: "#2b1d14", body: "#ff8c3a", shade: "#d9692a", visor: "#e9fbff", eye: "#1b2a3a", tip: "#ffe14d" };
  // with the flame, Pip runs hot: white shell, red trim
  const PIP_FIRE = { ...PIP_BASE, body: "#fff4e6", shade: "#ff5a3c", tip: "#ff5a3c" };
  let PIP = PIP_BASE;

  function drawPip(c, p) {
    if (p.invuln > 0 && Math.floor(p.invuln / 4) % 2) return;
    PIP = p.fire ? PIP_FIRE : PIP_BASE;
    // during a grow/shrink, flicker between the two sizes
    let big = p.big;
    if (p.grow && Math.floor(Math.abs(p.grow) / 5) % 2) big = !big;
    const bottom = Math.round(p.y + p.h);
    const sx = Math.round(p.x) - 2;
    const bodyH = big ? 20 : 10;
    const top = bottom - 2 - bodyH;
    const f = p.face;
    const dead = game.state === "dead";
    const air = !p.onGround && !dead && game.state !== "flag";
    const step = Math.floor(p.anim) % 2;

    // feet
    if (air) {
      px(c, sx + 2, bottom - 3, 4, 2, PIP.line);
      px(c, sx + 10, bottom - 2, 4, 2, PIP.line);
    } else {
      const lift = Math.abs(p.vx) > 0.2 ? step : -1;
      px(c, sx + 3, bottom - 2 - (lift === 0 ? 1 : 0), 4, 2, PIP.line);
      px(c, sx + 9, bottom - 2 - (lift === 1 ? 1 : 0), 4, 2, PIP.line);
    }
    // body
    px(c, sx + 3, top, 10, bodyH, PIP.line);
    px(c, sx + 2, top + 1, 12, bodyH - 2, PIP.line);
    px(c, sx + 3, top + 1, 10, bodyH - 2, PIP.body);
    px(c, sx + 3, top + bodyH - 3, 10, 2, PIP.shade);
    if (big) {
      px(c, sx + 5, top + 11, 6, 4, PIP.shade);
      px(c, sx + 6, top + 12, 4, 2, PIP.tip);
      // arms
      const swing = air ? -2 : Math.abs(p.vx) > 0.2 ? step * 2 - 1 : 0;
      px(c, sx, top + 9 + swing, 2, 4, PIP.line);
      px(c, sx + 14, top + 9 - swing, 2, 4, PIP.line);
    }
    // visor and eyes
    px(c, sx + 4, top + 2, 8, 5, PIP.visor);
    const ex = sx + (f > 0 ? 7 : 5);
    if (dead) {
      for (const ox of [0, 4]) {
        px(c, ex - 1 + ox - (f > 0 ? 1 : 0), top + 3, 1, 1, PIP.eye);
        px(c, ex + 1 + ox - (f > 0 ? 1 : 0), top + 5, 1, 1, PIP.eye);
        px(c, ex + ox - (f > 0 ? 1 : 0), top + 4, 1, 1, PIP.eye);
      }
    } else {
      const blink = tick % 200 < 6;
      px(c, ex, top + (blink ? 4 : 3), 1, blink ? 1 : 2, PIP.eye);
      px(c, ex + 3, top + (blink ? 4 : 3), 1, blink ? 1 : 2, PIP.eye);
    }
    // antenna leans against the motion
    const lean = Math.abs(p.vx) > 1.6 ? -f : 0;
    px(c, sx + 7, top - 2, 2, 2, PIP.line);
    px(c, sx + 7 + lean, top - 4, 2, 2, big && tick % 20 < 10 ? "#ffffff" : PIP.tip);
  }

  function drawEnemy(c, e) {
    const x = Math.round(e.x) - 1;
    const bottom = Math.round(e.y + e.h);
    const flip = e.dead === "flip";
    if (flip) {
      c.save();
      c.translate(0, bottom * 2 - e.h);
      c.scale(1, -1);
    }
    const step = Math.floor((tick + e.x) / 12) % 2;
    if (e.kind === "blob") {
      const line = "#1f4d2a", body = "#5ad16b", hi = "#a6f2a0";
      if (e.dead === "squash") {
        px(c, x + 1, bottom - 4, 14, 4, line);
        px(c, x + 2, bottom - 3, 12, 2, body);
      } else {
        const h = 12 - step;
        px(c, x + 4, bottom - h, 8, 1, line);
        px(c, x + 2, bottom - h + 1, 12, 2, line);
        px(c, x + 1, bottom - h + 3, 14, h - 3, line);
        px(c, x + 4, bottom - h + 1, 8, 1, body);
        px(c, x + 3, bottom - h + 2, 10, 2, body);
        px(c, x + 2, bottom - h + 3, 12, h - 4, body);
        px(c, x + 4, bottom - h + 2, 2, 1, hi);
        const dir = e.vx > 0 ? 1 : 0;
        px(c, x + 4 + dir, bottom - h + 4, 3, 3, "#ffffff");
        px(c, x + 9 + dir, bottom - h + 4, 3, 3, "#ffffff");
        px(c, x + 5 + dir, bottom - h + 5, 2, 2, line);
        px(c, x + 10 + dir, bottom - h + 5, 2, 2, line);
      }
    } else {
      const line = "#3a1020", body = "#e0475b", spike = "#e9edf2";
      for (let i = 0; i < 4; i++) {
        px(c, x + 2 + i * 4, bottom - 13, 2, 2, spike);
        px(c, x + 1 + i * 4, bottom - 11, 4, 1, spike);
      }
      px(c, x + 1, bottom - 10, 14, 8, line);
      px(c, x + 2, bottom - 9, 12, 6, body);
      px(c, x + 3, bottom - 9, 3, 1, "#ff8b9a");
      const dir = e.vx > 0 ? 1 : 0;
      px(c, x + 4 + dir, bottom - 7, 2, 2, "#ffffff");
      px(c, x + 9 + dir, bottom - 7, 2, 2, "#ffffff");
      px(c, x + 4, bottom - 8, 3, 1, line);
      px(c, x + 9, bottom - 8, 3, 1, line);
      px(c, x + 2 + step, bottom - 2, 4, 2, line);
      px(c, x + 10 - step, bottom - 2, 4, 2, line);
    }
    if (flip) c.restore();
  }

  function drawSpark(c, e) {
    const x = Math.round(e.x), y = Math.round(e.y);
    if (e.rise > 0) {
      c.save();
      c.beginPath();
      c.rect(x - 2, e.topY - 20, 20, 20);
      c.clip();
    }
    const glow = tick % 16 < 8;
    px(c, x + 4, y, 6, 14, "#1a5f80");
    px(c, x, y + 4, 14, 6, "#1a5f80");
    px(c, x + 2, y + 2, 10, 10, "#1a5f80");
    px(c, x + 4, y + 1, 6, 12, glow ? "#9ff3ff" : "#6ee7ff");
    px(c, x + 1, y + 4, 12, 6, glow ? "#9ff3ff" : "#6ee7ff");
    px(c, x + 3, y + 3, 8, 8, glow ? "#9ff3ff" : "#6ee7ff");
    // bolt
    px(c, x + 7, y + 3, 2, 2, "#fff36b");
    px(c, x + 6, y + 5, 2, 2, "#fff36b");
    px(c, x + 5, y + 7, 4, 1, "#fff36b");
    px(c, x + 7, y + 8, 2, 2, "#fff36b");
    px(c, x + 6, y + 10, 1, 1, "#fff36b");
    if (e.rise > 0) c.restore();
  }

  function drawFlame(c, e) {
    const x = Math.round(e.x), y = Math.round(e.y);
    if (e.rise > 0) {
      c.save();
      c.beginPath();
      c.rect(x - 2, e.topY - 20, 20, 20);
      c.clip();
    }
    const flick = Math.floor(tick / 6) % 2;
    px(c, x + 3, y + 13, 8, 1, "#7a2a10");
    px(c, x + 2, y + 6, 10, 7, "#7a2a10");
    px(c, x + 4, y + 2 + flick, 6, 5, "#7a2a10");
    px(c, x + 6 - flick, y, 2, 3, "#7a2a10");
    px(c, x + 3, y + 7, 8, 6, "#ff5a3c");
    px(c, x + 5, y + 3 + flick, 4, 5, "#ff5a3c");
    px(c, x + 6 - flick, y + 1, 1, 3, "#ff5a3c");
    px(c, x + 5, y + 8, 4, 4, "#ffb13b");
    px(c, x + 6, y + 10, 2, 2, "#fff3b0");
    if (e.rise > 0) c.restore();
  }

  function drawFireball(c, e) {
    const x = Math.round(e.x), y = Math.round(e.y);
    const r = Math.floor(e.t / 3) % 2;
    px(c, x + 1, y, 4, 6, "#ff5a3c");
    px(c, x, y + 1, 6, 4, "#ff5a3c");
    px(c, x + 1 + r, y + 1 + r, 3, 3, "#ffd23f");
    px(c, x + 2 + r, y + 2, 1, 1, "#ffffff");
  }

  const COIN_W = [8, 6, 2, 6];
  function drawCoin(c, x, y, frame) {
    const w = COIN_W[frame % 4];
    const cx = x + 8;
    px(c, cx - w / 2, y + 2, w, 12, "#c98a0b");
    if (w > 2) {
      px(c, cx - w / 2 + 1, y + 3, w - 2, 10, "#ffd23f");
      px(c, cx - w / 2 + 1, y + 4, 1, 4, "#fff3b0");
    }
  }

  function render() {
    const th = theme;
    ctx.imageSmoothingEnabled = false;
    if (!th) {
      ctx.fillStyle = "#5aaefc";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      return;
    }
    const camX = Math.round(cam);
    ctx.drawImage(bg.sky, 0, 0);
    for (const cl of bg.clouds) {
      const x = Math.round(cl.x - camX * 0.15);
      if (x < -60 || x > VIEW_W + 20) continue;
      for (let i = 0; i < cl.w; i++) disc(ctx, x + i * 10, cl.y + (i % 2 ? -2 : 2), 8, th.cloud);
    }
    for (const layer of [bg.far, bg.near]) ctx.drawImage(layer.c, -Math.round(camX * layer.factor), 0);

    ctx.save();
    ctx.translate(-camX, 0);
    const tx0 = Math.floor(camX / T), tx1 = Math.min(W - 1, Math.floor((camX + VIEW_W) / T));
    const qFrame = [0, 1, 2, 1][Math.floor(tick / 10) % 4];
    const coinFrame = Math.floor(tick / 8);
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const ch = grid[ty][tx];
        if (ch === " ") continue;
        const x = tx * T;
        let y = ty * T;
        const b = bumps.get(tx + "," + ty);
        if (b !== undefined) y -= Math.round(Math.sin((b / 8) * Math.PI) * 5);
        if (ch === "#") ctx.drawImage(tileAt(tx, ty - 1) === "#" ? tiles.ground : tiles.groundTop, x, y);
        else if (ch === "?" || ch === "P") ctx.drawImage(tiles.Q[qFrame], x, y);
        else if (ch === "o") drawCoin(ctx, x, y, coinFrame);
        else if (tiles[ch]) ctx.drawImage(tiles[ch], x, y);
      }
    }

    // checkpoints and the goal flag
    for (const cp of checkpoints) {
      px(ctx, cp.x, cp.y - 28, 2, 28, "#e6ebf0");
      px(ctx, cp.x + 2, cp.y - 28, 8, 6, cp.reached ? "#58d36b" : "#8a93a0");
    }
    if (flag) {
      px(ctx, flag.x, flag.top, 2, flag.bottom - flag.top, "#e6ebf0");
      px(ctx, flag.x + 1, flag.top, 1, flag.bottom - flag.top, "#a9b3bf");
      disc(ctx, flag.x + 1, flag.top - 2, 3, th.accent);
      const fy = Math.round(flag.clothY);
      for (let i = 0; i < 10; i++) px(ctx, flag.x - 1 - i, fy + Math.floor(i / 2), 1, 10 - Math.floor(i / 2) * 2, th.accent);
      px(ctx, flag.x - 6, fy + 4, 2, 2, "#ffffff");
    }

    for (const e of ents) {
      if (e.kind === "plat") {
        const x = Math.round(e.x), y = Math.round(e.y);
        px(ctx, x, y, e.w, e.h, "#22252e");
        px(ctx, x + 1, y + 1, e.w - 2, e.h - 3, th.platform);
        px(ctx, x + 1, y + 1, e.w - 2, 1, "rgba(255,255,255,0.4)");
        for (let i = 4; i < e.w; i += 12) px(ctx, x + i, y + 3, 2, 2, "#22252e");
      }
    }
    for (const e of ents) {
      if (e.kind === "spark") drawSpark(ctx, e);
      else if (e.kind === "flame") drawFlame(ctx, e);
      else if (e.kind === "fireball") drawFireball(ctx, e);
      else if (e.kind === "blob" || e.kind === "spiky") drawEnemy(ctx, e);
    }
    drawPip(ctx, player);

    for (const q of particles) {
      if (q.kind === "coin") drawCoin(ctx, q.x - 4, Math.round(q.y), Math.floor(q.t / 3));
      else if (q.kind === "shard") px(ctx, Math.round(q.x), Math.round(q.y), 4, 4, th.brick);
      else px(ctx, Math.round(q.x), Math.round(q.y), 2, 2, q.kind === "ember" ? "#ffb13b" : "#fff3b0");
    }
    for (const q of popups) drawText(ctx, q.text, Math.round(q.x), Math.round(q.y - q.t * 0.6), "#ffffff");
    ctx.restore();
  }

  // ---------- HUD & menus ----------
  const hud = { score: $("hud-score"), coins: $("hud-coins"), world: $("hud-world"), time: $("hud-time"), lives: $("hud-lives") };
  const shown = {};
  const runBtn = document.querySelector('[data-hold="run"]');
  function updateHud() {
    const vals = {
      score: String(game.score).padStart(6, "0"),
      coins: "×" + String(game.coins % 100).padStart(2, "0"),
      world: `${(levelIndex ?? 0) + 1}`,
      time: String(game.time).padStart(3, "0"),
      lives: "×" + game.lives,
    };
    for (const k in vals) {
      if (shown[k] !== vals[k]) hud[k].textContent = shown[k] = vals[k];
    }
    const runLabel = player?.fire ? "FIRE" : "RUN";
    if (shown.run !== runLabel) runBtn.textContent = shown.run = runLabel;
  }

  const overlay = $("overlay");
  let overlayKind = null;
  // primary button of the current overlay, triggered by Enter / jump
  let overlayAction = null;

  function setOverlay(kind) {
    overlayKind = kind;
    overlay.hidden = !kind;
    document.body.dataset.state = game.state;
    $("hud").hidden = kind === "title";
    if (!kind) return;
    const best = `Best <b>${String(game.best).padStart(6, "0")}</b>`;
    const html = {
      title: `
        <h1 class="logo">SKY<span>HOP</span></h1>
        <p class="tag">Help Pip the little robot hop across three worlds.</p>
        <div class="buttons">
          <button data-act="start" class="primary">${game.reached ? "New game" : "Start"}</button>
          ${game.reached ? `<button data-act="continue">Continue · World ${game.reached + 1}</button>` : ""}
        </div>
        <p class="keys"><kbd>←</kbd><kbd>→</kbd> move · <kbd>Space</kbd> jump · <kbd>Shift</kbd> run / fire · <kbd>P</kbd> pause</p>
        <p class="best">${best}</p>`,
      intro: `
        <p class="world">World ${levelIndex + 1}</p>
        <h2>${LEVELS[levelIndex].name}</h2>
        <p class="lives"><i class="pip"></i> × ${game.lives}</p>`,
      pause: `
        <h2>Paused</h2>
        <div class="buttons">
          <button data-act="resume" class="primary">Resume</button>
          <button data-act="quit">Quit to title</button>
        </div>`,
      over: `
        <h2>Game over</h2>
        <p class="score">Score <b>${String(game.score).padStart(6, "0")}</b></p>
        <p class="best">${best}</p>
        <div class="buttons">
          <button data-act="retry" class="primary">Try World ${levelIndex + 1} again</button>
          <button data-act="quit">Title</button>
        </div>`,
      win: `
        <h2>You made it!</h2>
        <p class="tag">Pip crossed all three worlds.</p>
        <p class="score">Score <b>${String(game.score).padStart(6, "0")}</b></p>
        <p class="best">${best}</p>
        <div class="buttons"><button data-act="start" class="primary">Play again</button></div>`,
    }[kind];
    overlay.className = "overlay " + kind;
    overlay.innerHTML = html;
    const primary = overlay.querySelector(".primary");
    overlayAction = primary ? primary.dataset.act : null;
    if (primary && kind !== "intro") primary.focus({ preventScroll: true });
  }

  overlay.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (btn) {
      audio();
      act(btn.dataset.act);
    }
  });

  function act(action) {
    if (action === "start") newGame(0);
    else if (action === "continue") newGame(game.reached);
    else if (action === "retry") newGame(levelIndex);
    else if (action === "resume") pause(false);
    else if (action === "quit") toTitle();
  }

  // states inside a level, where the game can be paused
  const inLevel = () => ["intro", "play", "flag", "dead", "clear"].includes(game.state);

  function onMenuKey(code) {
    audio();
    if (inLevel()) {
      if (code === "Enter" && !game.paused) return pause(true);
      return pause(!game.paused);
    }
    if (game.paused && code === "Enter") return pause(false);
    if (code === "Enter" && overlayAction && overlayKind !== "intro") act(overlayAction);
  }

  function pause(on) {
    if (on === game.paused) return;
    if (on && !inLevel()) return;
    game.paused = on;
    releaseAll();
    if (on) {
      stopMusic();
      sfx("pause");
      setOverlay("pause");
    } else {
      setOverlay(game.state === "intro" ? "intro" : null);
      canvas.focus({ preventScroll: true });
      if (game.state === "play") playMusic(LEVELS[levelIndex].theme);
    }
  }

  function newGame(level) {
    game.score = 0;
    game.coins = 0;
    game.lives = START_LIVES;
    game.checkpoint = null;
    game.paused = false;
    startLevel(level, false);
  }

  function startLevel(i, retry) {
    if (!retry) game.checkpoint = null;
    // a powered-up Pip keeps its power into the next world
    const keepBig = !retry && game.state === "clear" && player.big;
    const keepFire = keepBig && player.fire;
    loadLevel(i);
    if (keepBig) {
      player.big = true;
      player.fire = keepFire;
      player.h = 26;
      player.y -= 12;
    }
    game.state = "intro";
    game.timer = 0;
    stopMusic();
    setOverlay("intro");
    canvas.focus({ preventScroll: true });
  }

  // The run in progress, kept for this tab only: a host page (like staz.ai's
  // Games app) may reload the game's frame, e.g. when going full screen.
  const RUN_KEY = "skyhop:run";
  function saveRun() {
    try {
      if (!inLevel()) return;
      const run = { level: levelIndex, score: game.score, coins: game.coins, lives: game.lives, checkpoint: game.checkpoint, big: !!player?.big, fire: !!player?.fire, time: null };
      if (game.state === "flag" || game.state === "clear") {
        // the level is won: bank the time bonus and pick up at the next world
        run.score += game.time * 50;
        run.level++;
        run.checkpoint = null;
        game.reached = Math.max(game.reached, Math.min(run.level, LEVELS.length - 1));
        store.set("reached", game.reached);
      } else if (game.state === "dead") {
        run.lives--;
        run.big = false;
        run.fire = false;
      } else if (game.state === "play") {
        run.time = game.time;
      }
      if (run.lives <= 0 || !LEVELS[run.level]) {
        // the run ends here: keep its score as the best if it beat it (without
        // touching live state — a back/forward-cached page carries on running)
        if (run.score > game.best) {
          game.best = run.score;
          store.set("best", game.best);
        }
        return clearRun();
      }
      sessionStorage.setItem(RUN_KEY, JSON.stringify(run));
    } catch {
      /* ignore */
    }
  }
  function clearRun() {
    try {
      sessionStorage.removeItem(RUN_KEY);
    } catch {
      /* ignore */
    }
  }
  function resumeRun() {
    let run = null;
    try {
      run = JSON.parse(sessionStorage.getItem(RUN_KEY));
    } catch {
      /* ignore */
    }
    if (!run || !LEVELS[run.level]) return false;
    game.score = run.score | 0;
    game.coins = run.coins | 0;
    game.lives = Math.max(1, run.lives | 0);
    game.checkpoint = run.checkpoint || null;
    startLevel(run.level, true);
    if (run.big) {
      player.big = true;
      player.fire = !!run.fire;
      player.h = 26;
      player.y -= 12;
    }
    if (run.time > 0) game.time = run.time;
    return true;
  }
  addEventListener("pagehide", saveRun);

  function saveBest() {
    if (game.score > game.best) {
      game.best = game.score;
      store.set("best", game.best);
    }
  }

  function gameOver() {
    game.state = "over";
    clearRun();
    saveBest();
    sfx("over");
    setOverlay("over");
  }

  function winGame() {
    game.state = "win";
    clearRun();
    saveBest();
    sfx("win");
    setOverlay("win");
  }

  function toTitle() {
    clearRun();
    saveBest();
    stopMusic();
    game.paused = false;
    game.state = "title";
    loadLevel(0);
    setOverlay("title");
  }

  // ---------- layout ----------
  function resize() {
    const screen = $("screen");
    const aw = screen.clientWidth, ah = screen.clientHeight;
    if (!aw || !ah) return;
    VIEW_W = Math.max(256, Math.min(448, Math.round((VIEW_H * aw) / ah / 2) * 2));
    const scale = Math.min(aw / VIEW_W, ah / VIEW_H);
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const frame = $("frame");
    frame.style.width = Math.floor(VIEW_W * scale) + "px";
    frame.style.height = Math.floor(VIEW_H * scale) + "px";
    frame.style.setProperty("--px", scale.toFixed(3));
    if (theme) buildBackground(theme, W * T, 1234 + levelIndex * 977);
    if (player) cam = Math.max(0, Math.min(W * T - VIEW_W, player.x + player.w / 2 - VIEW_W * 0.42));
  }
  addEventListener("resize", resize);

  // ---------- main loop ----------
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    acc += Math.min(now - last, 100);
    last = now;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      update();
      acc -= STEP;
      steps++;
    }
    if (steps) {
      render();
      updateHud();
    }
    requestAnimationFrame(frame);
  }

  $("mute").addEventListener("click", () => {
    audio();
    toggleMute();
  });
  $("pause-btn").addEventListener("click", () => {
    audio();
    pause(!game.paused);
  });
  $("mute").textContent = muted ? "♪̸" : "♪";
  $("mute").setAttribute("aria-pressed", String(muted));
  if (matchMedia("(pointer: coarse)").matches) document.body.classList.add("touch");

  // ?debug exposes a few handles for automated playtests
  if (location.search.includes("debug")) {
    window.__skyhop = { game, player: () => player, warp: (tx, ty = 0) => { player.x = tx * T; player.y = ty * T; } };
  }

  bindTouch();
  resize();
  loadLevel(0);
  if (!resumeRun()) setOverlay("title");
  requestAnimationFrame(frame);
})();
