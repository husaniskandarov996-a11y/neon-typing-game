// neon type — so'zlar tepadan tushadi, ularni yerga tegmasdan yozib ulgurish kerak

const WORDS = {
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
const LONG_WORDS = {
  en: ["adventure", "lightning", "spaceship", "waterfall", "keyboard", "universe", "midnight",
       "challenge", "mysterious", "electricity"],
  uz: ["kutubxona", "dasturchi", "kelajak", "sayohat", "mustaqillik", "o'qituvchi", "tabiat",
       "muvaffaqiyat", "yulduzlar", "kompyuterlar"],
  code: ["queryselector", "localstorage", "settimeout", "eventlistener", "prototype", "undefined",
         "continue", "interface", "promise", "innerhtml"],
};

const MODES = {
  normal: { lives: 3, speed: 1, spawn: 1, points: 1, hint: "3 lives · regular speed" },
  hard:   { lives: 2, speed: 1.5, spawn: 0.7, points: 2, hint: "2 lives · faster · long words · x2 points" },
};

const $ = (id) => document.getElementById(id);
const arena = $("arena");
const input = $("typing");

let lang = "en";
let mode = "normal";
let state = "menu";   // menu | playing | paused | over
let words = [];       // { text, el, done, rest, x, y }
let score, level, lives, cleared, goodKeys, allKeys;
let startTime, lastSpawn, lastFrame, pausedAt;
let frameId = null;

// ---------- saqlash (private rejimda localStorage ishlamasligi mumkin) ----------
const store = {
  get(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : v; } catch { return def; } },
  set(key, v) { try { localStorage.setItem(key, v); } catch {} },
};
const getBest = () => Number(store.get("neonTypeBest_" + mode, mode === "normal" ? store.get("neonTypeBest", 0) : 0)) || 0;
const setBest = (v) => store.set("neonTypeBest_" + mode, v);

// ---------- ovozlar: fayl yo'q, hammasi Web Audio bilan "sintez" qilinadi ----------
let audio = null;
let muted = store.get("neonTypeMuted", "0") === "1";

function beep(freq, dur, { type = "square", vol = 0.04, to = null, delay = 0 } = {}) {
  if (muted) return;
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  const t = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur);
}
const sfx = {
  key:   () => beep(1400, 0.025, { vol: 0.015 }),
  wrong: () => beep(110, 0.12, { type: "sawtooth", vol: 0.04 }),
  clear: () => beep(520, 0.12, { to: 1250, vol: 0.035 }),
  hit:   () => beep(260, 0.3, { type: "sawtooth", to: 60, vol: 0.06 }),
  level: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.09, { delay: i * 0.08, vol: 0.035 })),
  over:  () => beep(420, 0.8, { type: "triangle", to: 50, vol: 0.08 }),
};

function updateSoundBtn() { $("sound-btn").textContent = muted ? "sound off" : "sound on"; }
$("sound-btn").addEventListener("click", () => {
  muted = !muted;
  store.set("neonTypeMuted", muted ? "1" : "0");
  updateSoundBtn();
  input.focus();
});
updateSoundBtn();

// ---------- menyu ----------
function pick(menuId, attr, onPick) {
  document.querySelectorAll(`#${menuId} .opt`).forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelector(`#${menuId} .opt.active`).classList.remove("active");
      btn.classList.add("active");
      onPick(btn.dataset[attr]);
    });
  });
}
pick("lang-menu", "lang", (v) => { lang = v; });
pick("mode-menu", "mode", (v) => { mode = v; refreshMenu(); });

function refreshMenu() {
  $("mode-hint").textContent = MODES[mode].hint;
  $("best-mode").textContent = mode;
  $("best-start").textContent = getBest();
}
refreshMenu();

function show(screen) {
  ["start-screen", "pause-screen", "over-screen"].forEach((id) => $(id).classList.toggle("hidden", id !== screen));
  document.body.classList.toggle("playing", state === "playing");
}

// ---------- to'liq ekran ----------
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

function toggleFullscreen() {
  const root = document.documentElement;
  if (isFull()) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else if (root.requestFullscreen || root.webkitRequestFullscreen) {
    (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
  }
  if (state === "playing") input.focus();
}

function updateFsBtn() {
  $("fs-btn").textContent = isFull() ? "⛶ exit fullscreen" : "⛶ fullscreen";
}

["fullscreenchange", "webkitfullscreenchange"].forEach((ev) =>
  document.addEventListener(ev, () => {
    updateFsBtn();
    // Esc bilan to'liq ekrandan chiqilganda brauzer Esc'ni o'yinga bermaydi, shuning uchun o'zimiz pauza qilamiz
    if (!isFull()) pauseGame();
  })
);
$("fs-btn").addEventListener("click", toggleFullscreen);
// iPhone Safari to'liq ekranni qo'llamaydi, u yerda tugmani yashiramiz
if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) {
  $("fs-btn").style.display = "none";
}

// ---------- o'yin ----------
function startGame() {
  if (frameId) cancelAnimationFrame(frameId);
  clearArena();
  score = 0; level = 1; lives = MODES[mode].lives;
  cleared = 0; goodKeys = 0; allKeys = 0;
  startTime = lastFrame = performance.now();
  lastSpawn = 0;
  state = "playing";

  show(null);
  input.disabled = false;
  input.value = "";
  input.focus();
  updateHud();
  frameId = requestAnimationFrame(loop);
}

function clearArena() {
  words.forEach((w) => w.el.remove());
  words = [];
}

function exitToMenu() {
  if (frameId) cancelAnimationFrame(frameId);
  clearArena();
  state = "menu";
  input.disabled = true;
  input.value = "";
  refreshMenu();
  show("start-screen");
}

function pauseGame() {
  if (state !== "playing") return;
  state = "paused";
  pausedAt = performance.now();
  cancelAnimationFrame(frameId);
  input.disabled = true;
  show("pause-screen");
}

function resumeGame() {
  if (state !== "paused") return;
  // pauzada o'tgan vaqtni hisobga olmaymiz, aks holda wpm tushib ketadi va so'zlar birdan chiqib keladi
  const gap = performance.now() - pausedAt;
  startTime += gap;
  lastSpawn += gap;
  lastFrame = performance.now();
  state = "playing";
  show(null);
  input.disabled = false;
  input.focus();
  frameId = requestAnimationFrame(loop);
}

// level oshgan sari tezroq tushadi va tez-tez chiqadi
const speed = () => (40 + level * 12) * MODES[mode].speed;                   // px/sek
const spawnDelay = () => Math.max(600, 2200 - level * 160) * MODES[mode].spawn; // ms

function spawnWord() {
  const list = mode === "hard" ? WORDS[lang].concat(LONG_WORDS[lang]) : WORDS[lang];
  let text;
  // bir xil harfdan boshlanadigan ikkita so'z bo'lmasin, aks holda qaysinisi yozilayotgani chalkashadi
  for (let i = 0; i < 10; i++) {
    text = list[Math.floor(Math.random() * list.length)];
    if (!words.some((w) => w.text[0] === text[0])) break;
  }

  const el = document.createElement("div");
  el.className = "word";
  const done = document.createElement("span");
  done.className = "done";
  const rest = document.createElement("span");
  rest.textContent = text;
  el.append(done, rest);
  arena.appendChild(el);

  const maxX = Math.max(0, arena.clientWidth - el.offsetWidth - 20);
  const w = { text, el, done, rest, x: 10 + Math.random() * maxX, y: -40 };
  el.style.transform = `translate(${w.x}px, ${w.y}px)`;
  words.push(w);
}

function loop(now) {
  if (state !== "playing") return;
  // boshqa tabga o'tib qaytganda dt juda katta bo'lib ketmasligi uchun cheklaymiz
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (now - lastSpawn > spawnDelay()) {
    spawnWord();
    lastSpawn = now;
  }

  const floor = arena.clientHeight - 28;
  for (const w of [...words]) {
    w.y += speed() * dt;
    w.el.style.transform = `translate(${w.x}px, ${w.y}px)`;
    if (w.y + w.el.offsetHeight >= floor) {
      loseLife(w);
      if (state !== "playing") return;
    }
  }

  updateHud();
  frameId = requestAnimationFrame(loop);
}

input.addEventListener("input", () => {
  if (state !== "playing") return;
  const typed = input.value.trim().toLowerCase();
  allKeys++;

  // yozilgan harflarga mos keladigan eng pastdagi so'z
  const target = typed
    ? words.filter((w) => w.text.startsWith(typed)).sort((a, b) => b.y - a.y)[0]
    : null;

  for (const w of words) {
    const on = w === target;
    w.el.classList.toggle("target", on);
    w.done.textContent = on ? typed : "";
    w.rest.textContent = on ? w.text.slice(typed.length) : w.text;
  }

  if (typed && !target) {
    sfx.wrong();
    input.classList.remove("wrong");
    void input.offsetWidth;   // animatsiyani qaytadan boshlash uchun
    input.classList.add("wrong");
    return;
  }
  goodKeys++;
  input.classList.remove("wrong");

  if (target && typed === target.text) clearWord(target);
  else if (typed) sfx.key();
});

function clearWord(w) {
  const pts = w.text.length * 10 * level * MODES[mode].points;
  score += pts;
  cleared++;
  sfx.clear();
  if (cleared % 10 === 0) levelUp();

  burst(w.x + w.el.offsetWidth / 2, w.y + w.el.offsetHeight / 2, pts);
  removeWord(w);
  input.value = "";
  updateHud();
}

function levelUp() {
  level++;
  sfx.level();
  const el = $("level-up");
  el.textContent = "level " + level;
  el.classList.remove("hidden");
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
}

function removeWord(w) {
  w.el.remove();
  words = words.filter((x) => x !== w);
}

function burst(x, y, pts) {
  const colors = ["#ff5fa2", "#ffcc4d", "#e8e2d0"];
  for (let i = 0; i < 12; i++) {
    const p = document.createElement("div");
    p.className = "px";
    const a = Math.random() * Math.PI * 2;
    const d = 20 + Math.random() * 50;
    p.style.left = x + "px";
    p.style.top = y + "px";
    p.style.background = colors[i % 3];
    p.style.setProperty("--dx", Math.round(Math.cos(a) * d / 6) * 6 + "px");
    p.style.setProperty("--dy", Math.round(Math.sin(a) * d / 6) * 6 + "px");
    arena.appendChild(p);
    p.addEventListener("animationend", () => p.remove());
  }
  const t = document.createElement("div");
  t.className = "points";
  t.textContent = "+" + pts;
  t.style.left = x - 20 + "px";
  t.style.top = y - 30 + "px";
  arena.appendChild(t);
  t.addEventListener("animationend", () => t.remove());
}

function loseLife(w) {
  removeWord(w);
  lives--;
  document.body.classList.remove("hit");
  void document.body.offsetWidth;
  document.body.classList.add("hit");
  updateHud();
  if (lives <= 0) gameOver();
  else sfx.hit();
}

const wpm = () => {
  // kamida 10 sekund deb hisoblaymiz, aks holda boshida wpm 500 bo'lib sakrab ketadi
  const min = Math.max((performance.now() - startTime) / 60000, 10 / 60);
  return Math.round(cleared / min);
};
const accuracy = () => (allKeys ? Math.round((goodKeys / allKeys) * 100) : 100);

function updateHud() {
  $("score").textContent = String(score).padStart(6, "0");
  $("level").textContent = String(level).padStart(2, "0");
  $("wpm").textContent = wpm();
  $("accuracy").textContent = accuracy() + "%";
  const max = MODES[mode].lives;
  const left = Math.max(0, lives);
  $("lives").innerHTML = "♥".repeat(left) + `<span class="lost">${"♥".repeat(max - left)}</span>`;
}

function gameOver() {
  if (state !== "playing") return;
  state = "over";
  cancelAnimationFrame(frameId);
  sfx.over();
  input.disabled = true;
  input.value = "";

  $("final-score").textContent = score;
  $("final-words").textContent = cleared;
  $("final-wpm").textContent = wpm();
  $("final-accuracy").textContent = accuracy() + "%";

  const isBest = score > getBest();
  if (isBest) setBest(score);
  $("new-best").classList.toggle("hidden", !isBest);
  show("over-screen");
}

// ---------- tugmalar va klaviatura ----------
$("start-btn").addEventListener("click", startGame);
$("restart-btn").addEventListener("click", startGame);
$("exit-btn").addEventListener("click", exitToMenu);
$("resume-btn").addEventListener("click", resumeGame);
$("pause-btn").addEventListener("click", pauseGame);
$("quit-btn").addEventListener("click", exitToMenu);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    if (state === "playing") pauseGame();
    else if (state === "paused") resumeGame();
    else if (state === "over") exitToMenu();
  } else if (e.key === "Enter") {
    if (state === "menu" || state === "over") { e.preventDefault(); startGame(); }
  } else if (e.key.toLowerCase() === "q" && state === "paused") {
    exitToMenu();
  } else if (e.key.toLowerCase() === "f" && state !== "playing") {
    // o'yin paytida "f" so'z ichida yoziladi, shuning uchun faqat menyularda ishlaydi
    toggleFullscreen();
  }
});

// boshqa tabga o'tsangiz o'yin o'zi pauza bo'ladi
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseGame();
});
