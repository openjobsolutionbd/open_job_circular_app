# ==========================================================
# push_utils.py — Web Push পাঠানোর সাধারণ (শেয়ার করা) ফাংশন
# ==========================================================
# send_reminders.py আর weekly_report.py দুটোই এটা ব্যবহার করে, যাতে
# "সবাইকে নোটিফিকেশন পাঠানো, ব্যর্থ/পুরনো সাবস্ক্রিপশন সরানো" কাজটা
# দুই জায়গায় আলাদাভাবে লিখতে না হয়।
# ==========================================================

import os
import json

from pywebpush import webpush, WebPushException

VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY")
VAPID_CLAIMS_SUB = os.environ.get("VAPID_CLAIMS_SUB", "mailto:example@example.com")


def send_push(subscription, payload):
    """একটা সাবস্ক্রিপশনে নোটিফিকেশন পাঠায়। ফেরত দেয়:
    True (সফল) / False (সাময়িক সমস্যা) / "expired" (এই সাবস্ক্রিপশন আর বৈধ না)।
    """
    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_CLAIMS_SUB},
        )
        return True
    except WebPushException as e:
        status = e.response.status_code if e.response is not None else None
        print(f"[সমস্যা] পুশ নোটিফিকেশন পাঠানো যায়নি (status={status}): {e}")
        if status in (404, 410):
            return "expired"
        return False


def send_to_all_subscriptions(db, payload):
    """db-তে জমা থাকা সবগুলো সাবস্ক্রিপশনে একটা নোটিফিকেশন পাঠায়।
    পুরনো/অকার্যকর সাবস্ক্রিপশন db থেকে সরিয়ে দেয় (নিজে থেকে save করে
    না - caller-কে পরে save_db() ডাকতে হবে)। ফেরত দেয়: কিছু সরানো
    হয়েছে কিনা (True/False)।"""
    subscriptions = db.get("push_subscriptions", [])
    still_valid = list(subscriptions)

    for sub in list(still_valid):
        result = send_push(sub, payload)
        if result == "expired" and sub in still_valid:
            still_valid.remove(sub)

    changed = len(still_valid) != len(subscriptions)
    if changed:
        db["push_subscriptions"] = still_valid
        print(f"{len(subscriptions) - len(still_valid)}টা পুরনো/অকার্যকর সাবস্ক্রিপশন সরিয়ে ফেলা হলো।")

    return changed
