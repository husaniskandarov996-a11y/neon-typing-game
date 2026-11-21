// engine.js — o'yin mantiqi, ekran (DOM) bilan ishlamaydi.
// Brauzer ham, server ham aynan shu faylni ishlatadi. Server o'yinni bosilgan tugmalar
// bo'yicha qaytadan o'ynab ko'radi va ochkoni o'zi hisoblaydi, shuning uchun soxta natija o'tmaydi.

export const TPS = 60;                 // 1 sekunddagi "tick"lar soni (o'yin qadami)
export const FLOOR = 1000;             // maydon balandligi (mantiqiy birlikda, piksel emas)
export const WORD_H = 48;              // so'zning mantiqiy balandligi
export const MAX_TICKS = TPS * 60 * 20; // eng uzun o'yin: 20 daqiqa
export const MAX_INPUT = 40;

export const WORDS = {
  en: ["neon", "star", "space", "rocket", "pixel", "galaxy", "laser", "planet", "orbit", "comet",
       "light", "night", "storm", "power", "speed", "magic", "dream", "glow", "city", "future",
       "signal", "energy", "matrix", "shadow", "crystal", "thunder", "dragon", "ocean", "flame", "cyber"],
  uz: ["kitob", "maktab", "yulduz", "osmon", "daryo", "tog", "shamol", "quyosh", "oy", "bahor",
       "do'st", "olma", "non", "suv", "yo'l", "shahar", "bog'", "gul", "qalam", "dengiz",
       "kompyuter", "telefon", "o'yin", "tezlik", "kuch", "orzu", "nur", "chiroq", "vaqt", "bilim"],
  code: ["const", "let", "function", "return", "if", "else", "for", "while", "array", "object",
         "python", "print", "import", "class", "def", "true", "false", "null", "async", "await",
         "fetch", "json", "html", "css", "script", "console", "string", "number", "loop", "git"],
};

// hard rejimda qo'shiladigan uzun so'zlar
export const LONG_WORDS = {
  en: ["adventure", "lightning", "spaceship", "waterfall", "keyboard", "universe", "midnight",
       "challenge", "mysterious", "electricity"],
  uz: ["kutubxona", "dasturchi", "kelajak", "sayohat", "mustaqillik", "o'qituvchi", "tabiat",
       "muvaffaqiyat", "yulduzlar", "kompyuterlar"],
  code: ["queryselector", "localstorage", "settimeout", "eventlistener", "prototype", "undefined",
         "continue", "interface", "promise", "innerhtml"],
};

export const MODES = {
  normal: { lives: 3, speed: 1, spawn: 1, points: 1 },
  hard:   { lives: 2, speed: 1.5, spawn: 0.7, points: 2 },
};

// Math.random o'rniga "seed"li tasodif: bir xil seed har doim bir xil so'zlarni beradi
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame({ seed, mode, lang }) {
  if (!MODES[mode] || !WORDS[lang]) throw new Error("bad mode or lang");
  const m = MODES[mode];
  const rand = seededRandom(seed);
  const list = mode === "hard" ? WORDS[lang].concat(LONG_WORDS[lang]) : WORDS[lang];

  const g = {
    tick: 0, score: 0, level: 1, lives: m.lives, maxLives: m.lives,
    cleared: 0, goodKeys: 0, allKeys: 0,
    words: [], over: false,
    nextId: 1, lastSpawn: -1e9,
  };

  // level oshgan sari tezroq tushadi va tez-tez chiqadi
  const speed = () => ((75 + g.level * 22) * m.speed) / TPS;                      // birlik / tick
  const spawnTicks = () => (Math.max(600, 2200 - g.level * 160) * m.spawn * TPS) / 1000;

  function spawn() {
    let text;
    // bir xil harfdan boshlanadigan ikkita so'z bo'lmasin
    for (let i = 0; i < 10; i++) {
      text = list[Math.floor(rand() * list.length)];
      if (!g.words.some((w) => w.text[0] === text[0])) break;
    }
    const w = { id: g.nextId++, text, x: rand(), y: -WORD_H };
    g.words.push(w);
    return w;
  }

  const remove = (w) => { g.words = g.words.filter((x) => x !== w); };

  // o'yinni bitta tick oldinga suradi; nima bo'lganini voqealar ro'yxati qilib qaytaradi
  g.step = () => {
    const events = [];
    if (g.over) return events;

    if (g.tick - g.lastSpawn >= spawnTicks()) {
      events.push({ type: "spawn", word: spawn() });
      g.lastSpawn = g.tick;
    }

    for (const w of [...g.words]) {
      w.y += speed();
      if (w.y + WORD_H >= FLOOR) {
        remove(w);
        g.lives--;
        events.push({ type: "miss", word: w });
        if (g.lives <= 0) {
          g.over = true;
          events.push({ type: "over" });
          break;
        }
      }
    }
    g.tick++;
    return events;
  };

  // yozish maydonining yangi qiymatini qabul qiladi (har bir "input" hodisasida)
  g.type = (value) => {
    if (g.over) return { typed: "", target: null };
    const typed = String(value).slice(0, MAX_INPUT).trim().toLowerCase();
    g.allKeys++;

    // yozilgan harflarga mos keladigan eng pastdagi so'z
    const target = typed
      ? g.words.filter((w) => w.text.startsWith(typed)).sort((a, b) => b.y - a.y || a.id - b.id)[0] || null
      : null;

    if (typed && !target) return { wrong: true, typed, target: null };
    g.goodKeys++;

    if (target && typed === target.text) {
      const points = target.text.length * 10 * g.level * m.points;
      g.score += points;
      g.cleared++;
      remove(target);
      let levelUp = false;
      if (g.cleared % 10 === 0) { g.level++; levelUp = true; }
      return { cleared: target, points, levelUp, typed: "", target: null };
    }
    return { typed, target };
  };

  // kamida 10 sekund deb hisoblaymiz, aks holda boshida wpm 500 bo'lib sakrab ketadi
  g.wpm = () => Math.round(g.cleared / Math.max(g.tick / TPS / 60, 10 / 60));
  g.accuracy = () => (g.allKeys ? Math.round((g.goodKeys / g.allKeys) * 100) : 100);

  return g;
}

// Server shu funksiya bilan o'yinni qayta o'ynaydi.
// events = [[tick, inputValue], ...] — o'yinchi qaysi tickda nima yozgani
export function replay({ seed, mode, lang, events }) {
  const g = createGame({ seed, mode, lang });
  let i = 0;
  while (!g.over) {
    if (g.tick > MAX_TICKS) return { ok: false, reason: "game too long" };
    while (i < events.length && events[i][0] === g.tick) {
      g.type(events[i][1]);
      i++;
    }
    if (i < events.length && events[i][0] < g.tick) return { ok: false, reason: "events out of order" };
    g.step();
  }
  if (i !== events.length) return { ok: false, reason: "input after game over" };
  return {
    ok: true,
    score: g.score,
    words: g.cleared,
    wpm: g.wpm(),
    accuracy: g.accuracy(),
    ticks: g.tick,
  };
}
