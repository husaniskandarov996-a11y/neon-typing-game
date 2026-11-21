// neon type leaderboard serveri (Cloudflare Worker + D1).
// Natijani o'yinchidan qabul qilmaydi. O'yinni bosilgan tugmalar bo'yicha qayta o'ynab, ochkoni o'zi hisoblaydi.

import { replay, MODES, WORDS, TPS, MAX_TICKS, MAX_INPUT } from "../engine.js";

const ALLOWED_ORIGINS = [
  "https://husaniskandarov996-a11y.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const SESSION_TTL_MS = 30 * 60 * 1000;    // o'yinni 30 daqiqa ichida tugatish kerak
const MAX_STARTS_PER_10_MIN = 40;         // bitta IP'dan 10 daqiqada nechta o'yin boshlash mumkin
const MAX_EVENTS = 20000;
const MAX_KEYS_PER_SECOND = 25;           // ~300 wpm; odam bundan tez yoza olmaydi
const MAX_WPM = 200;

// ism: harflar, apostrof yoki chiziqcha, 2–20 belgi
const NAME_PART = /^\p{L}[\p{L}'ʼ‘’-]{1,19}$/u;

function cors(req) {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

const json = (req, data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const fail = (req, error, status = 400) => json(req, { ok: false, error }, status);

const titleCase = (s) => s.charAt(0).toLocaleUpperCase("en") + s.slice(1).toLocaleLowerCase("en");

function cleanName(first, last) {
  first = String(first || "").trim();
  last = String(last || "").trim();
  if (!NAME_PART.test(first) || !NAME_PART.test(last)) return null;
  return `${titleCase(first)} ${titleCase(last)}`;
}

function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

async function readJson(req) {
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > 1_000_000) throw new Error("body too large");
  const text = await req.text();
  if (text.length > 1_000_000) throw new Error("body too large");
  return JSON.parse(text);
}

// ---------- GET /top?mode=normal ----------
async function top(req, env, url) {
  const mode = url.searchParams.get("mode");
  if (!MODES[mode]) return fail(req, "bad mode");
  // har bir o'yinchining faqat eng yaxshi natijasi
  const { results } = await env.DB.prepare(
    `SELECT s.name, s.score, s.wpm FROM scores s
     JOIN (SELECT name_key, MAX(score) AS best FROM scores WHERE mode = ?1 GROUP BY name_key) b
       ON s.name_key = b.name_key AND s.score = b.best
     WHERE s.mode = ?1
     GROUP BY s.name_key
     ORDER BY s.score DESC, MIN(s.created_at) ASC
     LIMIT 10`
  ).bind(mode).all();
  return json(req, { ok: true, rows: results });
}

// ---------- POST /start {first, last, mode, lang} ----------
async function start(req, env) {
  const body = await readJson(req);
  const name = cleanName(body.first, body.last);
  if (!name) return fail(req, "bad name");
  if (!MODES[body.mode] || !WORDS[body.lang]) return fail(req, "bad mode or lang");

  const ip = req.headers.get("CF-Connecting-IP") || "local";
  const now = Date.now();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sessions WHERE ip = ? AND started_at > ?"
  ).bind(ip, now - 10 * 60 * 1000).first();
  if (recent.n >= MAX_STARTS_PER_10_MIN) return fail(req, "too many games, slow down", 429);

  const id = crypto.randomUUID();
  const seed = randomSeed();
  await env.DB.prepare(
    "INSERT INTO sessions (id, seed, mode, lang, name, ip, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, seed, body.mode, body.lang, name, ip, now).run();

  // eski sessiyalarni vaqti-vaqti bilan tozalab turamiz
  if (Math.random() < 0.05) {
    await env.DB.prepare("DELETE FROM sessions WHERE started_at < ?").bind(now - 24 * 3600 * 1000).run();
  }
  return json(req, { ok: true, id, seed, name });
}

function validEvents(events) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) return "bad events";
  let prev = 0;
  const perSecond = new Map();
  for (const e of events) {
    if (!Array.isArray(e) || e.length !== 2) return "bad event";
    const [tick, value] = e;
    if (!Number.isInteger(tick) || tick < prev || tick > MAX_TICKS) return "bad tick";
    if (typeof value !== "string" || value.length > MAX_INPUT) return "bad value";
    prev = tick;
    const sec = Math.floor(tick / TPS);
    const n = (perSecond.get(sec) || 0) + 1;
    if (n > MAX_KEYS_PER_SECOND) return "typing too fast";
    perSecond.set(sec, n);
  }
  return null;
}

// ---------- POST /finish {id, events} ----------
async function finish(req, env) {
  const body = await readJson(req);
  const now = Date.now();
  if (typeof body.id !== "string") return fail(req, "bad id");

  // sessiyani "ishlatildi" deb belgilaymiz: bitta o'yinni ikki marta yuborib bo'lmaydi
  const claim = await env.DB.prepare(
    "UPDATE sessions SET used = 1 WHERE id = ? AND used = 0 AND started_at > ?"
  ).bind(body.id, now - SESSION_TTL_MS).run();
  if (!claim.meta.changes) return fail(req, "session not found, expired or already used");

  const s = await env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(body.id).first();

  const problem = validEvents(body.events);
  if (problem) return fail(req, problem);

  const result = replay({ seed: s.seed, mode: s.mode, lang: s.lang, events: body.events });
  if (!result.ok) return fail(req, result.reason);

  // o'yin haqiqatan shuncha vaqt davom etganmi? (pauza bo'lsa real vaqt ko'proq bo'ladi, bu normal)
  const simMs = (result.ticks / TPS) * 1000;
  const realMs = now - s.started_at;
  if (realMs < simMs * 0.95 - 2000) return fail(req, "game finished faster than real time");
  if (result.wpm > MAX_WPM) return fail(req, "too fast to be human");

  if (result.score > 0) {
    await env.DB.prepare(
      `INSERT INTO scores (id, name, name_key, mode, lang, score, words, wpm, accuracy, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(s.id, s.name, s.name.toLowerCase(), s.mode, s.lang, result.score, result.words,
           result.wpm, result.accuracy, now).run();
  }

  // o'yinchining eng yaxshi natijasi va o'rni
  const best = await env.DB.prepare(
    "SELECT MAX(score) AS best FROM scores WHERE mode = ? AND name_key = ?"
  ).bind(s.mode, s.name.toLowerCase()).first();
  let rank = null;
  if (best && best.best) {
    const higher = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (SELECT name_key, MAX(score) AS b FROM scores WHERE mode = ? GROUP BY name_key)
       WHERE b > ?`
    ).bind(s.mode, best.best).first();
    rank = higher.n + 1;
  }

  return json(req, { ok: true, ...result, saved: result.score > 0, best: best?.best || 0, rank });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
    const url = new URL(req.url);
    try {
      if (req.method === "GET" && url.pathname === "/top") return await top(req, env, url);
      if (req.method === "POST" && url.pathname === "/start") return await start(req, env);
      if (req.method === "POST" && url.pathname === "/finish") return await finish(req, env);
      return fail(req, "not found", 404);
    } catch (err) {
      console.error(err);
      return fail(req, "server error", 500);
    }
  },
};
