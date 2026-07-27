// ==========================================================
// functions/api/subscribe.js
// ==========================================================
// PWA থেকে নোটিফিকেশন চালু করলে, ব্রাউজার একটা "সাবস্ক্রিপশন"
// (কোথায় নোটিফিকেশন পাঠাতে হবে তার ঠিকানা) দেয়। এই ফাংশন সেটা
// গিটহাবের job_database.json ফাইলে জমা রাখে, যাতে পরে রিমাইন্ডার
// স্ক্রিপ্ট এই ঠিকানায় নোটিফিকেশন পাঠাতে পারে।
// ==========================================================

import { commitUpdate, isAuthorized, jsonResponse } from "../_utils.js";

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

  const { subscription } = body;

  if (!subscription || !subscription.endpoint) {
    return jsonResponse({ error: "সাবস্ক্রিপশনের তথ্য ঠিক নেই" }, 400);
  }

  try {
    await commitUpdate(
      env,
      (content) => {
        content.push_subscriptions = content.push_subscriptions || [];
        const alreadyExists = content.push_subscriptions.some(
          (s) => s.endpoint === subscription.endpoint
        );
        if (!alreadyExists) {
          content.push_subscriptions.push(subscription);
        }
      },
      "PWA: নতুন নোটিফিকেশন সাবস্ক্রিপশন যোগ"
    );

    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, 502);
  }
}
