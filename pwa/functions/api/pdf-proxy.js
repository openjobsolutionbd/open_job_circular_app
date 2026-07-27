// ==========================================================
// functions/api/pdf-proxy.js
// ==========================================================
// সরকারি ওয়েবসাইট থেকে ব্রাউজার সরাসরি পিডিএফ পড়তে পারে না (CORS
// নিয়মের কারণে)। এই ফাংশন সার্ভার-সাইড থেকে পিডিএফটা এনে ব্রাউজারে
// ফেরত পাঠায়, যাতে pdf.js সেটা পড়ে ছবি বানাতে পারে।
//
// নিরাপত্তা: এটা যেকোনো ওয়েবসাইট আনতে পারবে না (open proxy হওয়া
// এড়াতে) - শুধু আমাদের নিজেদের ডাটাবেজে থাকা লিংকগুলোই আনা যাবে।
// ==========================================================

import { fetchDb } from "../_utils.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const params = new URL(request.url).searchParams;
  const targetUrl = params.get("url");
  const secret = params.get("secret");

  if (!secret || secret !== env.APP_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  if (!targetUrl) {
    return new Response("url প্যারামিটার দরকার", { status: 400 });
  }

  try {
    const { content: db } = await fetchDb(env);
    const knownLinks = new Set(Object.values(db.circulars || {}).map((c) => c.link));

    if (!knownLinks.has(targetUrl)) {
      return new Response("এই লিংক অনুমোদিত না", { status: 403 });
    }

    const pdfRes = await fetch(targetUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!pdfRes.ok || !pdfRes.body) {
      return new Response("পিডিএফ আনা যায়নি", { status: 502 });
    }

    return new Response(pdfRes.body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return new Response("সমস্যা হয়েছে: " + e.message, { status: 502 });
  }
}
