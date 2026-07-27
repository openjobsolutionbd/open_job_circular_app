// ==========================================================
// functions/api/chat.js
// ==========================================================
// PWA-র চ্যাট বক্সে প্রশ্ন লিখলে এখানে আসে। এই ফাংশন —
//   ১. গিটহাব থেকে বর্তমান সার্কুলারের তথ্য আনে
//   ২. সেই তথ্যসহ প্রশ্নটা Anthropic API-তে (Claude) পাঠায়
//   ৩. উত্তরটা ফেরত পাঠায়
//
// এর জন্য Cloudflare-এ ANTHROPIC_API_KEY এনভায়রনমেন্ট ভ্যারিয়েবল
// (নিজের API key) সেট করা থাকতে হবে।
// ==========================================================

import { fetchDb, isAuthorized, jsonResponse } from "../_utils.js";

const MODEL = "claude-sonnet-5";
const MAX_CIRCULARS = 300; // প্রশ্নের সাথে পাঠানো তথ্যের একটা সীমা, খরচ/গতি ঠিক রাখতে

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

  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse(
      { error: "AI বৈশিষ্ট্য এখনো চালু করা হয়নি (Cloudflare-এ ANTHROPIC_API_KEY সেট করা নেই)" },
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
  const circulars = summarizeCirculars(db);

  const systemPrompt = `তুমি একজন ব্যবহারকারীর ব্যক্তিগত "চাকরির খবর" সহকারী।
আজকের তারিখ: ${today} (YYYY-MM-DD ফরম্যাটে)।

নিচে JSON আকারে ব্যবহারকারীর সংগ্রহ করা সব চাকরি/নিয়োগ সার্কুলারের তথ্য দেওয়া
আছে। প্রতিটার site (কোন উৎস), title (শিরোনাম), status (new/interested/
applied/not_interested), first_seen (কবে প্রথম দেখা গেছে), details (পদসংখ্যা,
আবেদনের শেষ তারিখ ইত্যাদি, থাকতেও পারে নাও থাকতে পারে) আছে।

নিয়ম:
- শুধু এই তথ্যের ভিত্তিতে উত্তর দাও, বাইরে থেকে কিছু অনুমান করে বানিও না
- তারিখ নিয়ে প্রশ্ন হলে সাবধানে হিসাব করো (আজকের তারিখ ওপরে দেওয়া আছে)
- শেষ তারিখ না থাকা এন্ট্রি থাকলে সেটা আলাদাভাবে উল্লেখ করো
- উত্তর সংক্ষিপ্ত, স্পষ্ট, বাংলায় দাও
- তথ্য না পেলে সরাসরি বলো "এই তথ্য পাওয়া যায়নি", কিছু বানিয়ে বোলো না

সার্কুলারের তথ্য:
${JSON.stringify(circulars)}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return jsonResponse({ error: `AI থেকে উত্তর পাওয়া যায়নি: ${detail}` }, 502);
    }

    const data = await res.json();
    const answer =
      (data.content || [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n") || "উত্তর তৈরি করা যায়নি।";

    return jsonResponse({ answer });
  } catch (e) {
    return jsonResponse({ error: e.message }, 502);
  }
}

function summarizeCirculars(db) {
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

  return combined.map((c) => ({
    site: c.site,
    title: c.title,
    status: c.status,
    first_seen: c.first_seen,
    details: c.details || {},
  }));
}
