// neon type — ekran, ovoz va tugmalar. O'yin mantiqining o'zi engine.js ichida.
import { createGame, TPS, FLOOR, WORD_H, MODES } from "./engine.js?v=0.5";

const API = (window.NEON_TYPE_API || "").replace(/\/$/, "");
const online = !!API;

const HINTS = {
  normal: "3 lives · regular speed",
  hard: "2 lives · faster · long words · x2 points",
};

const $ = (id) => document.getElementById(id);
const arena = $("arena");
const input = $("typing");

let lang = "en";
let mode = "normal";
let state = "menu";   // menu | starting | playing | paused | over | board
let game = null;      // engine o'yini
let session = null;   // serverdan olingan { id, seed }
let events = [];      // [tick, inputValue] — serverga yuboriladi
let els = new Map();  // so'z id -> ekrandagi element
let target = null;    // hozir yozilayotgan so'z
let typedNow = "";
let lastFrame = 0, acc = 0, frameId = null;

// ---------- saqlash (private rejimda localStorage ishlamasligi mumkin) ----------
const store = {
  get(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : v; } catch { return def; } },
  set(key, v) { try { localStorage.setItem(key, v); } catch {} },
};
const getBest = () => Number(store.get("neonTypeBest_" + mode, mode === "normal" ? store.get("neonTypeBest", 0) : 0)) || 0;
const setBest = (v) => store.set("neonTypeBest_" + mode, v);

// ---------- o'yinchi ismi ----------
const NAME_PART = /^\p{L}[\p{L}'ʼ‘’-]{1,19}$/u;
const titleCase = (s) => s.charAt(0).toLocaleUpperCase("en") + s.slice(1).toLocaleLowerCase("en");
let player = null;
try { player = JSON.parse(store.get("neonTypePlayer", "null")); } catch {}

function showNameUi(editing) {
  const need = editing || !player;
  $("name-form").classList.toggle("hidden", !need);
  $("player-line").classList.toggle("hidden", need);
  if (player) $("player-name").textContent = `${player.first} ${player.last}`;
  if (need) {
    $("first-name").value = player?.first || "";
    $("last-name").value = player?.last || "";
    $("first-name").focus();
  }
}

$("name-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const first = $("first-name").value.trim();
  const last = $("last-name").value.trim();
  if (!NAME_PART.test(first) || !NAME_PART.test(last)) {
    $("name-error").textContent = "letters only, 2–20 each (first and last name)";
    return;
  }
  player = { first: titleCase(first), last: titleCase(last) };
  store.set("neonTypePlayer", JSON.stringify(player));
  $("name-error").textContent = "";
  showNameUi(false);
});
$("change-name").addEventListener("click", () => showNameUi(true));

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
  if (state === "playing") input.focus();
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
  $("mode-hint").textContent = HINTS[mode];
  $("best-mode").textContent = mode;
  $("best-start").textContent = getBest();
  $("start-btn").textContent = "press ENTER to start";
}

function show(screen) {
  ["start-screen", "pause-screen", "over-screen", "board-screen"].forEach((id) =>
    $(id).classList.toggle("hidden", id !== screen));
  document.body.classList.toggle("playing", state === "playing");
}

document.body.classList.toggle("lb-on", online);
refreshMenu();
showNameUi(false);

// ---------- server bilan aloqa ----------
async function api(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(API + path, body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal }
      : { signal: ctrl.signal });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "request failed");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- o'yinni boshlash ----------
async function startGame() {
  if (state === "starting") return;
  if (!player) {
    show("start-screen");
    state = "menu";
    showNameUi(true);
    $("name-error").textContent = "enter your name first";
    return;
  }
  if (frameId) cancelAnimationFrame(frameId);
  state = "starting";
  show("start-screen");
  $("start-btn").textContent = "connecting...";

  session = null;
  let seed = Math.floor(Math.random() * 2 ** 32);
  if (online) {
    try {
      // seed'ni server beradi: shunda o'yinni oldindan "hisoblab" bo'lmaydi
      const s = await api("/start", { first: player.first, last: player.last, mode, lang });
      session = { id: s.id };
      seed = s.seed;
    } catch (err) {
      console.warn("offline game:", err.message);
    }
  }
  if (state !== "starting") return;

  clearArena();
  game = createGame({ seed, mode, lang });
  events = [];
  target = null;
  typedNow = "";
  acc = 0;
  lastFrame = performance.now();
  state = "playing";

  refreshMenu();
  show(null);
  input.disabled = false;
  input.value = "";
  input.focus();
  updateHud();
  frameId = requestAnimationFrame(loop);
}

function clearArena() {
  els.forEach((el) => el.remove());
  els.clear();
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
  cancelAnimationFrame(frameId);
  input.disabled = true;
  show("pause-screen");
}

function resumeGame() {
  if (state !== "paused") return;
  state = "playing";
  lastFrame = performance.now();
  show(null);
  input.disabled = false;
  input.focus();
  frameId = requestAnimationFrame(loop);
}

// ---------- asosiy sikl: o'yin qat'iy 60 tick/sek tezlikda yuradi, ekran esa har kadrda chiziladi ----------
function loop(now) {
  if (state !== "playing") return;
  acc += Math.min((now - lastFrame) / 1000, 0.1);   // boshqa tabdan qaytganda sakrab ketmasin
  lastFrame = now;

  while (acc >= 1 / TPS && !game.over) {
    acc -= 1 / TPS;
    for (const ev of game.step()) {
      if (ev.type === "spawn") addWordEl(ev.word);
      else if (ev.type === "miss") onMiss(ev.word);
    }
  }
  render();
  updateHud();
  if (game.over) return gameOver();
  frameId = requestAnimationFrame(loop);
}

function addWordEl(w) {
  const el = document.createElement("div");
  el.className = "word";
  const done = document.createElement("span");
  done.className = "done";
  const rest = document.createElement("span");
  rest.textContent = w.text;
  el.append(done, rest);
  arena.appendChild(el);
  els.set(w.id, el);
}

// mantiqiy koordinatalarni (0..1000) ekran piksellariga aylantiramiz
function pos(w, el) {
  const floorPx = arena.clientHeight - 28;
  const h = el.offsetHeight;
  return {
    x: 10 + w.x * Math.max(0, arena.clientWidth - el.offsetWidth - 20),
    y: (w.y * (floorPx - h)) / (FLOOR - WORD_H),
  };
}

function render() {
  for (const w of game.words) {
    const el = els.get(w.id);
    if (!el) continue;
    const p = pos(w, el);
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    const on = target && target.id === w.id;
    el.classList.toggle("target", !!on);
    el.firstChild.textContent = on ? typedNow : "";
    el.lastChild.textContent = on ? w.text.slice(typedNow.length) : w.text;
  }
}

function onMiss(w) {
  els.get(w.id)?.remove();
  els.delete(w.id);
  if (target && target.id === w.id) target = null;
  document.body.classList.remove("hit");
  void document.body.offsetWidth;
  document.body.classList.add("hit");
  if (game.lives > 0) sfx.hit();
}

input.addEventListener("input", () => {
  if (state !== "playing") return;
  events.push([game.tick, input.value]);   // server shu ro'yxat bo'yicha o'yinni qayta o'ynaydi
  const r = game.type(input.value);
  target = r.target;
  typedNow = r.typed;

  if (r.wrong) {
    sfx.wrong();
    input.classList.remove("wrong");
    void input.offsetWidth;   // animatsiyani qaytadan boshlash uchun
    input.classList.add("wrong");
  } else {
    input.classList.remove("wrong");
    if (r.cleared) {
      const el = els.get(r.cleared.id);
      const p = pos(r.cleared, el);
      burst(p.x + el.offsetWidth / 2, p.y + el.offsetHeight / 2, r.points);
      el.remove();
      els.delete(r.cleared.id);
      input.value = "";
      sfx.clear();
      if (r.levelUp) showLevelUp();
    } else if (r.typed) {
      sfx.key();
    }
  }
  render();
  updateHud();
});

function showLevelUp() {
  sfx.level();
  const el = $("level-up");
  el.textContent = "level " + game.level;
  el.classList.remove("hidden");
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
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

function updateHud() {
  $("score").textContent = String(game.score).padStart(6, "0");
  $("level").textContent = String(game.level).padStart(2, "0");
  $("wpm").textContent = game.wpm();
  $("accuracy").textContent = game.accuracy() + "%";
  const left = Math.max(0, game.lives);
  $("lives").innerHTML = "♥".repeat(left) + `<span class="lost">${"♥".repeat(game.maxLives - left)}</span>`;
}

// ---------- o'yin tugadi: natija avtomatik serverga ketadi ----------
async function gameOver() {
  state = "over";
  sfx.over();
  input.disabled = true;
  input.value = "";

  $("final-score").textContent = game.score;
  $("final-words").textContent = game.cleared;
  $("final-wpm").textContent = game.wpm();
  $("final-accuracy").textContent = game.accuracy() + "%";

  const isBest = game.score > getBest();
  if (isBest) setBest(game.score);
  $("new-best").classList.toggle("hidden", !isBest);
  show("over-screen");

  const status = $("submit-status");
  if (!online) { status.textContent = ""; return; }
  if (!session) { status.textContent = "offline game: score not saved"; return; }
  if (game.score <= 0) { status.textContent = ""; return; }

  const sent = session;
  session = null;
  status.textContent = "checking your game...";
  try {
    const r = await api("/finish", { id: sent.id, events });
    status.textContent = r.rank
      ? `saved! you're #${r.rank} on the ${mode} board`
      : "saved!";
  } catch (err) {
    status.textContent = "couldn't save: " + err.message;
  }
}

// ---------- leaderboard ----------
let boardMode = "normal";
let boardBack = "start-screen";

function openBoard(m, back) {
  if (!online) return;
  boardBack = back;
  state = "board";
  show("board-screen");
  loadBoard(m);
}

function closeBoard() {
  state = boardBack === "over-screen" ? "over" : "menu";
  if (state === "menu") refreshMenu();
  show(boardBack);
}

async function loadBoard(m) {
  boardMode = m;
  document.querySelectorAll("#board-tabs .opt").forEach((b) => b.classList.toggle("active", b.dataset.board === m));
  const table = $("board-table");
  table.replaceChildren();
  $("board-status").textContent = "loading...";
  try {
    const { rows } = await api("/top?mode=" + m);
    if (boardMode !== m) return;   // foydalanuvchi bu orada boshqa tabni bosgan
    $("board-status").textContent = rows.length ? "" : "no scores yet. be the first!";
    const me = player ? `${player.first} ${player.last}`.toLowerCase() : null;
    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      if (r.name.toLowerCase() === me) tr.className = "me";
      // ism textContent orqali qo'yiladi, shuning uchun hech kim sahifaga kod "tiqa" olmaydi
      [[String(i + 1), "rank"], [r.name, "name"], [String(r.score), "num"], [r.wpm + " wpm", "wpm"]].forEach(([text, cls]) => {
        const td = document.createElement("td");
        td.className = cls;
        td.textContent = text;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    if (boardMode === m) $("board-status").textContent = "couldn't load the leaderboard";
  }
}

document.querySelectorAll("#board-tabs .opt").forEach((b) => b.addEventListener("click", () => loadBoard(b.dataset.board)));
$("board-btn").addEventListener("click", () => openBoard(mode, "start-screen"));
$("over-board-btn").addEventListener("click", () => openBoard(mode, "over-screen"));
$("board-back").addEventListener("click", closeBoard);

// ---------- to'liq ekran ----------
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

function toggleFullscreen() {
  const root = document.documentElement;
  if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else if (root.requestFullscreen || root.webkitRequestFullscreen) (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
  if (state === "playing") input.focus();
}
function updateFsBtn() { $("fs-btn").textContent = isFull() ? "⛶ exit fullscreen" : "⛶ fullscreen"; }
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

// ---------- tugmalar va klaviatura ----------
$("start-btn").addEventListener("click", startGame);
$("restart-btn").addEventListener("click", startGame);
$("exit-btn").addEventListener("click", exitToMenu);
$("resume-btn").addEventListener("click", resumeGame);
$("pause-btn").addEventListener("click", pauseGame);
$("quit-btn").addEventListener("click", exitToMenu);

document.addEventListener("keydown", (e) => {
  const inForm = e.target === $("first-name") || e.target === $("last-name");
  const k = e.key.toLowerCase();
  if (e.key === "Escape") {
    e.preventDefault();
    if (state === "playing") pauseGame();
    else if (state === "paused") resumeGame();
    else if (state === "board") closeBoard();
    else if (state === "over") exitToMenu();
    else if (inForm && player) showNameUi(false);
  } else if (inForm) {
    return;   // ism yozilayotganda Enter formani yuboradi, boshqa tugmalar o'yinga ta'sir qilmaydi
  } else if (k === "l" && (state === "menu" || state === "over") && online) {
    openBoard(mode, state === "over" ? "over-screen" : "start-screen");
  } else if (e.key === "Enter") {
    if (state === "menu" || state === "over") { e.preventDefault(); startGame(); }
  } else if (k === "q" && state === "paused") {
    exitToMenu();
  } else if (k === "f" && state !== "playing") {
    // o'yin paytida "f" so'z ichida yoziladi, shuning uchun faqat menyularda ishlaydi
    toggleFullscreen();
  }
});

// boshqa tabga o'tsangiz o'yin o'zi pauza bo'ladi
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseGame();
});
