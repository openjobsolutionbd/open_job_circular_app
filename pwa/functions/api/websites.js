// ==========================================================
// functions/api/websites.js
// ==========================================================
// PWA-র "সাইট ম্যানেজ করুন" অংশ থেকে এখানে অনুরোধ আসে। এটা গিটহাবের
// websites.txt ফাইলে গিয়ে সরকারি সাইটের তালিকা পড়ে/লেখে - যাতে
// নতুন সাইট যোগ বা পুরনো সাইট মুছতে GitHub-এ গিয়ে ম্যানুয়ালি ফাইল
// এডিট করতে না হয়।
//
// GET  -> বর্তমান সাইটের তালিকা ফেরত দেয়
// POST -> action: "add" (নতুন সাইট যোগ) অথবা "remove" (সাইট মুছে ফেলা)
// ==========================================================

import { fetchWebsites, commitWebsitesUpdate, isAuthorized, jsonResponse } from "../_utils.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const params = new URL(request.url).searchParams;
  const secret = params.get("secret");

  if (!secret || secret !== env.APP_SECRET) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const { sites } = await fetchWebsites(env);
    return jsonResponse({ sites });
  } catch (e) {
    return jsonResponse({ error: e.message }, 502);
  }
}

function normalizeUrl(url) {
  let cleaned = url.trim();
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = "https://" + cleaned;
  }
  cleaned = cleaned.replace(/\/+$/, ""); // শেষের "/" বাদ, যাতে ডুপ্লিকেট চেক ঠিকভাবে কাজ করে

  // scheme আর host lowercase করা হচ্ছে যাতে HTTPS://Example.gov.bd আর
  // https://example.gov.bd একই সাইট হিসেবে ধরা পড়ে (path/query অংশ
  // অপরিবর্তিত থাকছে, যেহেতু সেটা case-sensitive হতে পারে)
  try {
    const u = new URL(cleaned);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/+$/, "");
  } catch (e) {
    return cleaned; // অচেনা ফরম্যাট হলে যা আছে তাই ফেরত
  }
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

  const { action } = body;

  if (action === "add") {
    const name = (body.name || "").trim();
    const url = (body.url || "").trim();

    if (!url) {
      return jsonResponse({ error: "ওয়েবসাইটের ঠিকানা (url) দরকার" }, 400);
    }

    // websites.txt এ "নাম|url" ফরম্যাট ব্যবহার হয় - "|" চিহ্ন নাম বা url
    // এ থাকলে ফাইল লেখার/পড়ার সময় লাইনটা ভুলভাবে ভেঙে যাবে। sites.js
    // এ একই চেক আছে, কিন্তু কেউ সরাসরি এই API কল করলেও যাতে সুরক্ষিত
    // থাকে, তাই এখানেও যাচাই করা হচ্ছে
    if (name.includes("|") || url.includes("|")) {
      return jsonResponse({ error: 'নাম বা ঠিকানায় "|" চিহ্ন ব্যবহার করা যাবে না' }, 400);
    }

    const normalizedUrl = normalizeUrl(url);

    try {
      const updated = await commitWebsitesUpdate(
        env,
        (sites) => {
          // বিদ্যমান sites.txt এর কোনো এন্ট্রি হয়তো কখনো normalizeUrl()
          // এর মধ্য দিয়ে যায়নি (যেমন GitHub এ সরাসরি ম্যানুয়ালি এডিট
          // করা হলে) - তাই তুলনার আগে দুই দিকেই normalize করা হচ্ছে,
          // নাহলে trailing slash বা মিশ্র case এর কারণে একই সাইট
          // দুইবার তালিকায় ঢুকে যেতে পারে
          const alreadyExists = sites.some((s) => normalizeUrl(s.url) === normalizedUrl);
          if (alreadyExists) {
            const err = new Error("এই সাইটটা আগে থেকেই তালিকায় আছে");
            err.duplicate = true;
            throw err;
          }
          return [...sites, { name: name || normalizedUrl, url: normalizedUrl }];
        },
        `PWA: নতুন সাইট যোগ (${normalizedUrl})`
      );
      return jsonResponse({ success: true, sites: updated });
    } catch (e) {
      return jsonResponse({ error: e.message }, e.duplicate ? 409 : 502);
    }
  }

  if (action === "remove") {
    const url = (body.url || "").trim();

    if (!url) {
      return jsonResponse({ error: "কোন সাইট মুছতে হবে তা (url) দরকার" }, 400);
    }

    try {
      const updated = await commitWebsitesUpdate(
        env,
        (sites) => {
          const filtered = sites.filter((s) => s.url !== url);
          if (filtered.length === sites.length) {
            const err = new Error("এই সাইটটা তালিকায় পাওয়া যায়নি");
            err.notFound = true;
            throw err;
          }
          return filtered;
        },
        `PWA: সাইট সরানো (${url})`
      );
      return jsonResponse({ success: true, sites: updated });
    } catch (e) {
      return jsonResponse({ error: e.message }, e.notFound ? 404 : 502);
    }
  }

  return jsonResponse({ error: "অচেনা action - 'add' অথবা 'remove' দিতে হবে" }, 400);
}
