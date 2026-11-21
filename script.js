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

const $ = (id) => document.getElementById(id);
const arena = $("arena");
const input = $("typing");

let lang = "en";
let words = [];   // { text, el, x, y }
let score, level, lives, cleared, goodKeys, allKeys;
let startTime, lastSpawn, lastFrame;
let running = false;
let frameId = null;

// eng yaxshi natijani brauzerda saqlaymiz (private rejimda ishlamasligi mumkin, shuning uchun try)
const best = {
  get() { try { return Number(localStorage.getItem("neonTypeBest")) || 0; } catch { return 0; } },
  set(v) { try { localStorage.setItem("neonTypeBest", v); } catch {} },
};
$("best-start").textContent = best.get();

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelector(".lang-btn.active").classList.remove("active");
    btn.classList.add("active");
    lang = btn.dataset.lang;
  });
});

function startGame() {
  if (frameId) cancelAnimationFrame(frameId);   // eski sikl qolib ketmasin
  words.forEach((w) => w.el.remove());
  words = [];
  score = 0; level = 1; lives = 3;
  cleared = 0; goodKeys = 0; allKeys = 0;
  startTime = lastFrame = performance.now();
  lastSpawn = 0;
  running = true;

  $("start-screen").classList.add("hidden");
  $("over-screen").classList.add("hidden");
  input.disabled = false;
  input.value = "";
  input.focus();
  updateHud();
  frameId = requestAnimationFrame(loop);
}

// level oshgan sari tezroq tushadi va tez-tez chiqadi
const speed = () => 40 + level * 12;                     // px/sek
const spawnDelay = () => Math.max(700, 2200 - level * 160); // ms

function spawnWord() {
  const list = WORDS[lang];
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
  if (!running) return;
  // boshqa tabga o'tib qaytganda dt juda katta bo'lib, hamma so'z birdan tushib ketmasligi uchun cheklaymiz
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
      if (!running) return;
    }
  }

  updateHud();
  frameId = requestAnimationFrame(loop);
}

input.addEventListener("input", () => {
  if (!running) return;
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
    input.classList.remove("wrong");
    void input.offsetWidth;   // animatsiyani qaytadan boshlash uchun
    input.classList.add("wrong");
    return;
  }
  goodKeys++;
  input.classList.remove("wrong");

  if (target && typed === target.text) clearWord(target);
});

function clearWord(w) {
  const pts = w.text.length * 10 * level;
  score += pts;
  cleared++;
  if (cleared % 10 === 0) level++;

  burst(w.x + w.el.offsetWidth / 2, w.y + w.el.offsetHeight / 2, pts);
  removeWord(w);
  input.value = "";
  updateHud();
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
  const left = Math.max(0, lives);
  $("lives").innerHTML = "♥".repeat(left) + `<span class="lost">${"♥".repeat(3 - left)}</span>`;
}

function gameOver() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(frameId);
  input.disabled = true;
  input.value = "";

  $("final-score").textContent = score;
  $("final-words").textContent = cleared;
  $("final-wpm").textContent = wpm();
  $("final-accuracy").textContent = accuracy() + "%";

  const isBest = score > best.get();
  if (isBest) best.set(score);
  $("new-best").classList.toggle("hidden", !isBest);
  $("best-start").textContent = best.get();
  $("over-screen").classList.remove("hidden");
}

$("start-btn").addEventListener("click", startGame);
$("restart-btn").addEventListener("click", startGame);
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !running) startGame();
});
