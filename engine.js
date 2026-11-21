// engine.js — o'yin mantiqi, ekran (DOM) bilan ishlamaydi.
// Brauzer ham, server ham aynan shu faylni ishlatadi. Server o'yinni bosilgan tugmalar
// bo'yicha qaytadan o'ynab ko'radi va ochkoni o'zi hisoblaydi, shuning uchun soxta natija o'tmaydi.

export const TPS = 60;                 // 1 sekunddagi "tick"lar soni (o'yin qadami)
export const FLOOR = 1000;             // maydon balandligi (mantiqiy birlikda, piksel emas)
export const WORD_H = 48;              // so'zning mantiqiy balandligi
export const MAX_TICKS = TPS * 60 * 20; // eng uzun o'yin: 20 daqiqa
export const MAX_INPUT = 40;

// Har bir til uchun bitta katta ro'yxat. Rejimga qarab undan so'z uzunligi bo'yicha tanlanadi.
export const WORDS = {
  en: `neon star space rocket pixel galaxy laser planet orbit comet light night storm power speed
    magic dream glow city future signal energy matrix shadow crystal thunder dragon ocean flame cyber
    forest river mountain window garden silver golden purple yellow orange winter summer spring autumn
    music guitar piano camera bridge castle island desert jungle tiger eagle wolf shark whale robot
    engine circuit metal stone cloud rain snow wind fire water earth moon sky road train plane boat
    ship apple bread coffee doctor friend happy jacket kitten lemon market number pencil queen sugar
    ticket violet wizard zebra anchor banana candle dollar finger hammer insect jelly kettle ladder
    mirror needle pepper rabbit saddle tunnel unicorn valley wallet
    adventure lightning spaceship waterfall keyboard universe midnight challenge mysterious electricity
    butterfly chocolate dangerous wonderland microphone basketball volleyball telescope satellite
    hurricane avalanche labyrinth chameleon kaleidoscope imagination photograph adrenaline revolution
    generation celebration experience motorcycle helicopter submarine skyscraper rainforest atmosphere
    watermelon strawberry pineapple crocodile programmer developer algorithm architecture synthesizer
    underground lighthouse fireworks nightmare tournament earthquake friendship knowledge playground
    restaurant temperature volcanoes adventurer astronomer blueberry hamburger lightyear magnificent
    neighborhood`,
  uz: `kitob maktab yulduz osmon daryo tog shamol quyosh oy bahor do'st olma non suv yo'l shahar bog'
    gul qalam dengiz telefon o'yin tezlik kuch orzu nur chiroq vaqt bilim uy ona ota aka uka opa
    singil bola qiz o'g'il ish dars daftar ruchka stol stul eshik deraza ko'cha mashina avtobus
    poyezd samolyot bozor choy osh palov somsa lag'mon qovun tarvuz uzum anor shaftoli olcha gilos
    sabzi piyoz bulut qor yomg'ir kuz qish yoz tun kun hafta oyna devor gilam ko'z qo'l oyoq bosh
    yurak tabiat kelajak sayohat jasorat yoshlik do'stlik oshxona
    kutubxona dasturchi dasturlash mustaqillik o'qituvchi muvaffaqiyat yulduzlar kompyuter
    kompyuterlar universitet shifoxona mehmonxona avtomobil tadbirkor sportchilar futbolchi
    chempionat matematika geografiya televizor muzqaymoq sayohatchi samarqand o'zbekiston
    qahramonlar mehribonlik dehqonchilik bog'bonlar shamollar ko'chalar mashinalar samolyotlar
    poyezdlar telefonlar maktablar o'quvchilar kitobxonlar hamkasblar oshpazlar haydovchi
    rassomlar musiqachi qo'shiqchi tarjimonlar quruvchilar`,
  code: `const let var function return if else for while array object python print import class
    def true false null async await fetch json html css script console string number loop git
    node npm react flex grid div span map filter reduce push pop slice split join try catch throw
    break typeof static public private yield lambda tuple dict list range input float bool
    queryselector localstorage settimeout setinterval eventlistener addeventlistener prototype
    undefined continue interface innerhtml textcontent classlist appendchild createelement
    getelementbyid javascript typescript stringify constructor dataclass decorator generator
    coroutine namespace dependency repository middleware component recursion algorithm instanceof
    enumerate isinstance comprehension exception deprecated serialize websocket asyncio
    requestanimationframe`,
};
for (const k in WORDS) WORDS[k] = [...new Set(WORDS[k].split(/\s+/).filter(Boolean))];

export const MODES = {
  normal:  { lives: 3, speed: 1,   spawn: 1,    points: 1, minLen: 2, maxLen: 7 },
  hard:    { lives: 2, speed: 1.5, spawn: 0.7,  points: 2, minLen: 6, maxLen: 99 },
  extreme: { lives: 1, speed: 1.9, spawn: 0.55, points: 4, minLen: 9, maxLen: 99 },
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
  const list = WORDS[lang].filter((w) => w.length >= m.minLen && w.length <= m.maxLen);

  const g = {
    tick: 0, score: 0, level: 1, lives: m.lives, maxLives: m.lives,
    cleared: 0, goodKeys: 0, allKeys: 0,
    words: [], over: false,
    nextId: 1, lastSpawn: -1e9,
  };

  // level oshgan sari tezroq tushadi va tez-tez chiqadi
  const speed = () => ((75 + g.level * 22) * m.speed) / TPS;                      // birlik / tick
  const spawnTicks = () => (Math.max(600, 2200 - g.level * 160) * m.spawn * TPS) / 1000;

  // "xalta": so'zlar aralashtirib qo'yiladi va hammasi bir martadan chiqmaguncha takrorlanmaydi
  let bag = [];
  function refillBag() {
    const last = bag.length ? null : g.lastWord;
    bag = list.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // yangi xaltaning birinchi so'zi oldingi oxirgi so'z bilan bir xil bo'lmasin
    if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  }

  function spawn() {
    if (!bag.length) refillBag();
    // bir xil harfdan boshlanadigan ikkita so'z bo'lmasin: mos kelmasa, xaltadagi keyingisini olamiz
    let idx = bag.length - 1;
    for (let k = bag.length - 1; k >= Math.max(0, bag.length - 12); k--) {
      if (!g.words.some((w) => w.text[0] === bag[k][0])) { idx = k; break; }
    }
    const text = bag.splice(idx, 1)[0];
    g.lastWord = text;
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
