// ==========================================================
// functions/api/chat.js
// ==========================================================
// PWA-র চ্যাট বক্সে প্রশ্ন লিখলে এখানে আসে। এই ফাংশন —
//   ১. গিটহাব থেকে বর্তমান সার্কুলারের তথ্য আনে
//   ২. সেই তথ্যসহ প্রশ্নটা DeepSeek API-তে পাঠায়
//   ৩. উত্তরটা ফেরত পাঠায়
//
// এর জন্য Cloudflare-এ DEEPSEEK_API_KEY এনভায়রনমেন্ট ভ্যারিয়েবল
// (নিজের API key) সেট করা থাকতে হবে।
// ==========================================================

import { fetchDb, isAuthorized, jsonResponse } from "../_utils.js";

const MODEL = "deepseek-chat";
const MAX_CIRCULARS = 300; // প্রশ্নের সাথে পাঠানো তথ্যের একটা সীমা, খরচ/গতি ঠিক রাখতে
const DEADLINE_KEY = "আবেদনের শেষ তারিখ";

// python-এর date_utils.py-র parse_deadline()-এর সাথে হুবহু মিলিয়ে রাখা
// হয়েছে, যাতে দুই জায়গায় তারিখ বোঝার নিয়ম আলাদা না হয়ে যায়।
const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";
function toAsciiDigits(text) {
  return text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

const BANGLA_MONTHS = {
  জানুয়ারি: 1, ফেব্রুয়ারি: 2, মার্চ: 3, এপ্রিল: 4, মে: 5, জুন: 6,
  জুলাই: 7, আগস্ট: 8, সেপ্টেম্বর: 9, অক্টোবর: 10, নভেম্বর: 11, ডিসেম্বর: 12,
};

/** '১৫-০৮-২০২৬' বা '১৫ আগস্ট, ২০২৬' থেকে YYYY-MM-DD বের করে, না বুঝলে null। */
function parseDeadline(text) {
  if (!text) return null;
  const ascii = toAsciiDigits(text);

  const m = ascii.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m.map(Number);
    if (y < 100) y += 2000;
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d) {
      return date.toISOString().slice(0, 10);
    }
    return null;
  }

  for (const [name, num] of Object.entries(BANGLA_MONTHS)) {
    if (text.includes(name)) {
      const re = new RegExp(`(\\d{1,2})\\s*${name}\\D{0,15}?(\\d{4})`);
      const m2 = ascii.match(re);
      if (m2) {
        const d = Number(m2[1]);
        const y = Number(m2[2]);
        const date = new Date(Date.UTC(y, num - 1, d));
        if (date.getUTCFullYear() === y && date.getUTCMonth() === num - 1 && date.getUTCDate() === d) {
          return date.toISOString().slice(0, 10);
        }
        return null;
      }
    }
  }
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "অনুরোধের ফরম্যাট ঠিক নেই" }, 400);
  }

  if (!isAuthorized(body, env)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const question = (body.question || "").trim();
  if (!question) {
    return jsonResponse({ error: "প্রশ্ন খালি" }, 400);
  }

  if (!env.DEEPSEEK_API_KEY) {
    return jsonResponse(
      { error: "AI বৈশিষ্ট্য এখনো চালু করা হয়নি (Cloudflare-এ DEEPSEEK_API_KEY সেট করা নেই)" },
      500
    );
  }

  let db;
  try {
    ({ content: db } = await fetchDb(env));
  } catch (e) {
    return jsonResponse({ error: e.message }, 502);
  }

  // UTC-এর বদলে বাংলাদেশ সময় (UTC+6) হিসাব করা হচ্ছে, নাহলে রাত ১২টা-৬টার
  // মধ্যে প্রশ্ন করলে "আজকের তারিখ" একদিন এদিক-ওদিক হয়ে যেতে পারত
  const bdNow = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const today = bdNow.toISOString().slice(0, 10);
  const circulars = summarizeCirculars(db, today);

  const systemPrompt = `তুমি একজন ব্যবহারকারীর ব্যক্তিগত "চাকরির খবর" সহকারী।
আজকের তারিখ: ${today} (YYYY-MM-DD ফরম্যাটে)।

নিচে JSON আকারে ব্যবহারকারীর সংগ্রহ করা সব চাকরি/নিয়োগ সার্কুলারের তথ্য দেওয়া
আছে। প্রতিটার site (কোন উৎস), title (শিরোনাম), status (new/interested/
applied/not_interested), first_seen (কবে প্রথম দেখা গেছে), details (পদসংখ্যা,
আবেদনের শেষ তারিখ ইত্যাদি, থাকতেও পারে নাও থাকতে পারে), deadline_iso (শেষ
তারিখ, YYYY-MM-DD ফরম্যাটে আগে থেকেই হিসাব করা, বোঝা না গেলে null), আর
days_remaining (আজকের তারিখ থেকে শেষ তারিখ পর্যন্ত কত দিন বাকি, আগে থেকেই
বিয়োগ করে দেওয়া, ঋণাত্মক মানে মেয়াদ পার হয়ে গেছে, deadline_iso null হলে এটাও
null) আছে।

নিয়ম:
- শুধু এই তথ্যের ভিত্তিতে উত্তর দাও, বাইরে থেকে কিছু অনুমান করে বানিও না
- তারিখ/দিন-গণনা সংক্রান্ত প্রশ্নে নিজে থেকে details-এর কাঁচা লেখা পার্স
  করার বা বিয়োগ করার চেষ্টা কোরো না — deadline_iso ও days_remaining
  ফিল্ড দুটো আগে থেকেই সঠিকভাবে হিসাব করা আছে, শুধু সেগুলো ব্যবহার করো
- কোনো এন্ট্রির deadline_iso null হলে, সেটার শেষ তারিখ বোঝা যায়নি —
  এটা স্পষ্টভাবে বলো, অনুমান করে কোনো তারিখ বসিয়ে দিও না
- গণনার (কতগুলো/কয়টা) প্রশ্নে উত্তর দেওয়ার আগে নিজে একবার গুনে
  নিশ্চিত হও
- উত্তর সংক্ষিপ্ত, স্পষ্ট, বাংলায় দাও
- তথ্য না পেলে সরাসরি বলো "এই তথ্য পাওয়া যায়নি", কিছু বানিয়ে বোলো না

সার্কুলারের তথ্য:
${JSON.stringify(circulars)}`;

  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return jsonResponse({ error: `AI থেকে উত্তর পাওয়া যায়নি: ${detail}` }, 502);
    }

    const data = await res.json();
    const answer =
      data.choices?.[0]?.message?.content || "উত্তর তৈরি করা যায়নি।";

    return jsonResponse({ answer });
  } catch (e) {
    return jsonResponse({ error: e.message }, 502);
  }
}

function summarizeCirculars(db, today) {
  const all = Object.values(db.circulars || {});

  // "আগ্রহী/আবেদন করেছি/প্রয়োজন নেই" হিসেবে যেগুলোর সিদ্ধান্ত নেওয়া
  // হয়ে গেছে, সেগুলো সবসময় পুরোপুরি রাখা হচ্ছে - কারণ বেশিরভাগ প্রশ্নই
  // এগুলো নিয়ে হয় (যেমন "কতগুলোতে আবেদন করেছি")। সীমার বাকি জায়গায়
  // সবচেয়ে সাম্প্রতিক "নতুন" এন্ট্রিগুলো ভরা হচ্ছে।
  const decided = all.filter((c) => c.status && c.status !== "new");
  const undecided = all
    .filter((c) => !c.status || c.status === "new")
    .sort((a, b) => (b.first_seen || "").localeCompare(a.first_seen || ""));

  const remaining = Math.max(0, MAX_CIRCULARS - decided.length);
  const combined = [...decided, ...undecided.slice(0, remaining)];

  const todayDate = new Date(`${today}T00:00:00Z`);

  return combined.map((c) => {
    const deadlineText = c.details?.[DEADLINE_KEY];
    const deadlineIso = parseDeadline(deadlineText);
    let daysRemaining = null;
    if (deadlineIso) {
      const diffMs = new Date(`${deadlineIso}T00:00:00Z`) - todayDate;
      daysRemaining = Math.round(diffMs / (24 * 60 * 60 * 1000));
    }

    return {
      site: c.site,
      title: c.title,
      status: c.status,
      first_seen: c.first_seen,
      details: c.details || {},
      deadline_iso: deadlineIso,
      days_remaining: daysRemaining,
    };
  });
}
