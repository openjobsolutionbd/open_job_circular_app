// ==========================================================
// functions/_utils.js — সাধারণ (শেয়ার করা) ফাংশন
// ==========================================================
// এই ফাইলটা /api/update, /api/subscribe, /api/websites - সবগুলোই
// ব্যবহার করে। এখানে গিটহাব থেকে যেকোনো ফাইল পড়া আর সেখানে ফেরত
// লেখার সাধারণ (জেনেরিক) কাজটা করা হয়।
// ==========================================================

const DB_PATH = "pwa/job_database.json";
const WEBSITES_PATH = "websites.txt";

function getApiUrl(env, path) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "chakri-khobor-pwa",
    Accept: "application/vnd.github+json",
  };
}

// বাংলা (UTF-8) লেখাসহ base64 এনকোড/ডিকোড ঠিকভাবে করার জন্য এই দুটো
// সাহায্যকারী ফাংশন (সরাসরি atob/btoa বাংলা লেখায় ভুল করে)
function base64ToUtf8(base64) {
  const clean = base64.replace(/\n/g, "");
  return decodeURIComponent(escape(atob(clean)));
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

/** গিটহাব থেকে যেকোনো ফাইলের raw (কাঁচা) লেখা ও তার sha (সংস্করণ-পরিচয়) আনে। */
async function fetchRawFile(env, path) {
  const res = await fetch(getApiUrl(env, path), { headers: githubHeaders(env) });
  if (!res.ok) {
    throw new Error(`গিটহাব থেকে ফাইল আনা যায়নি (${res.status})`);
  }
  const fileData = await res.json();
  return { text: base64ToUtf8(fileData.content), sha: fileData.sha };
}

/** গিটহাবে যেকোনো ফাইলের নতুন raw (কাঁচা) লেখা ফেরত লেখে (commit করে)। */
async function writeRawFile(env, path, text, sha, message) {
  const res = await fetch(getApiUrl(env, path), {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify({
      message,
      content: utf8ToBase64(text),
      sha,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`গিটহাবে লিখতে সমস্যা হয়েছে (${res.status}): ${detail}`);
    err.status = res.status;
    throw err;
  }
}

/** গিটহাব থেকে বর্তমান ডাটাবেজ ফাইল ও তার sha (সংস্করণ-পরিচয়) আনে। */
export async function fetchDb(env) {
  const { text, sha } = await fetchRawFile(env, DB_PATH);
  return { content: JSON.parse(text), sha };
}

/** নতুন তথ্য গিটহাবে ফেরত লেখে (commit করে)। */
export async function writeDb(env, content, sha, message) {
  await writeRawFile(env, DB_PATH, JSON.stringify(content, null, 2), sha, message);
}

/**
 * তথ্য পড়ে, পরিবর্তন করে, আবার লিখে রাখে - আর যদি ঠিক একই সময়ে অন্য
 * কোনো পরিবর্তন (যেমন দৈনিক স্ক্রিপ্ট, বা অন্য একটা ট্যাব থেকে করা
 * আপডেট) আগেই জমা হয়ে যায়, তাহলে সেটার জন্য আবার নতুন করে চেষ্টা করে
 * (সর্বোচ্চ কয়েকবার)। এটা ছাড়া, একসাথে দুটো আপডেট হলে একটা হারিয়ে
 * যাওয়ার/ব্যর্থ হওয়ার ঝুঁকি থাকে।
 *
 * mutatorFn(content) - এই ফাংশনটা content-কে সরাসরি বদলে দেবে
 * (যেমন content.circulars[id].status = "interested")
 */
export async function commitUpdate(env, mutatorFn, message, maxRetries = 3) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { content, sha } = await fetchDb(env);

    mutatorFn(content); // ভুল/না-পাওয়া গেলে এখানেই throw হবে, নিচে ধরা হবে না (retry করার মানে নেই)

    try {
      await writeDb(env, content, sha, message);
      return;
    } catch (e) {
      lastError = e;
      // sha মিলছে না মানে ঠিক এর মধ্যেই অন্য একটা পরিবর্তন জমা হয়ে
      // গেছে - তাই আবার সবচেয়ে সাম্প্রতিক তথ্য এনে নতুন করে চেষ্টা করা
      if (e.status !== 409 && e.status !== 422) {
        throw e;
      }
    }
  }

  throw lastError;
}

/**
 * websites.txt পড়ে, একটা তালিকা (array) হিসেবে ফেরত দেয়। প্রতিটা
 * এন্ট্রি { name, url } আকারে। ফরম্যাট: "নাম|ইউআরএল" - প্রতি লাইনে
 * একটা করে। "#" দিয়ে শুরু হওয়া লাইন ও খালি লাইন বাদ। পুরনো ফরম্যাটের
 * লাইন (শুধু URL, "|" ছাড়া) থাকলে সেটার জন্য name হিসেবে URL-টাই
 * ব্যবহার করা হয় (backward-compatible)।
 */
function parseWebsitesText(text) {
  const lines = text.split("\n");
  const sites = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sepIndex = line.indexOf("|");
    if (sepIndex === -1) {
      sites.push({ name: line, url: line });
    } else {
      const name = line.slice(0, sepIndex).trim();
      const url = line.slice(sepIndex + 1).trim();
      sites.push({ name: name || url, url });
    }
  }
  return sites;
}

/** সাইটের তালিকা (array of {name, url}) থেকে আবার websites.txt এর লেখা বানায়। */
function buildWebsitesText(sites) {
  const header =
    "# এই ফাইলে সরকারি ওয়েবসাইটের ঠিকানা লিখুন, একটা লাইনে একটা করে।\n" +
    "# ফরম্যাট: নাম|ইউআরএল  (যেমন: শিক্ষা মন্ত্রণালয়|https://techedu.gov.bd)\n" +
    "# (# চিহ্ন দিয়ে শুরু হওয়া লাইনগুলো প্রোগ্রাম পড়বে না, এগুলো শুধু নোট)\n" +
    "# এই ফাইলটা PWA-র \"সাইট ম্যানেজ করুন\" অংশ থেকেও স্বয়ংক্রিয়ভাবে আপডেট হয়।\n\n";
  const body = sites.map((s) => `${s.name}|${s.url}`).join("\n");
  return header + body + (body ? "\n" : "");
}

/** গিটহাব থেকে websites.txt পড়ে {name, url} এর তালিকা ও sha ফেরত দেয়। */
export async function fetchWebsites(env) {
  const { text, sha } = await fetchRawFile(env, WEBSITES_PATH);
  return { sites: parseWebsitesText(text), sha };
}

/**
 * websites.txt পড়ে, mutatorFn দিয়ে তালিকাটা বদলে, আবার লিখে রাখে -
 * commitUpdate এর মতোই sha-conflict হলে কয়েকবার আবার চেষ্টা করে।
 *
 * mutatorFn(sites) - sites (array of {name, url}) নিয়ে একটা নতুন
 * তালিকা রিটার্ন করবে (যোগ/মুছা করা হয়ে যাওয়া অবস্থায়)
 */
export async function commitWebsitesUpdate(env, mutatorFn, message, maxRetries = 3) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { sites, sha } = await fetchWebsites(env);
    const updatedSites = mutatorFn(sites);

    try {
      await writeRawFile(env, WEBSITES_PATH, buildWebsitesText(updatedSites), sha, message);
      return updatedSites;
    } catch (e) {
      lastError = e;
      if (e.status !== 409 && e.status !== 422) {
        throw e;
      }
    }
  }

  throw lastError;
}

/** অনুরোধের সাথে পাঠানো গোপন কোডটা ঠিক আছে কিনা যাচাই করে। */
export function isAuthorized(body, env) {
  return Boolean(body.secret) && body.secret === env.APP_SECRET;
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
