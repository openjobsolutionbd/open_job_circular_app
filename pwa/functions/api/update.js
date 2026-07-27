// ==========================================================
// functions/api/update.js
// ==========================================================
// PWA থেকে "আগ্রহী" / "আবেদন করেছি" / "প্রয়োজন নেই" বাটনে চাপলে এখানে
// অনুরোধ আসে। এটা গিটহাবের job_database.json ফাইলে গিয়ে সেই
// সার্কুলারের status পাল্টে দিয়ে আসে।
// ==========================================================

import { commitUpdate, isAuthorized, jsonResponse } from "../_utils.js";

const ALLOWED_STATUSES = ["new", "interested", "not_interested", "applied"];

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

  const { id, status } = body;

  if (!id || !status) {
    return jsonResponse({ error: "id বা status পাওয়া যায়নি" }, 400);
  }

  if (!ALLOWED_STATUSES.includes(status)) {
    return jsonResponse({ error: "অচেনা status" }, 400);
  }

  try {
    await commitUpdate(
      env,
      (content) => {
        if (!content.circulars || !content.circulars[id]) {
          const err = new Error("এই সার্কুলারটা পাওয়া যায়নি");
          err.notFound = true;
          throw err;
        }
        content.circulars[id].status = status;

        // সাপ্তাহিক রিপোর্টে "এই সপ্তাহে কী কী আবেদন করা হয়েছে" বের করতে
        // কবে "আবেদন করেছি" বলা হয়েছিল, সেই তারিখটা মনে রাখা হচ্ছে।
        // UTC-এর বদলে বাংলাদেশ সময় (UTC+6) ব্যবহার করা হচ্ছে, নাহলে
        // রাত ১২টা-৬টার (BD সময়) মধ্যে বাটন চাপলে "আজকের তারিখ" একদিন
        // পিছিয়ে সেভ হয়ে যেত - আর weekly_report.py বাংলাদেশ সময় ধরেই
        // এই তারিখ থেকে হিসাব করে
        if (status === "applied") {
          const bdNow = new Date(Date.now() + 6 * 60 * 60 * 1000);
          content.circulars[id].applied_date = bdNow.toISOString().slice(0, 10);
        }
      },
      `PWA আপডেট: ${id} → ${status}`
    );

    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, e.notFound ? 404 : 502);
  }
}
