# ==========================================================
# weekly_report.py — সাপ্তাহিক রিপোর্ট (Web Push দিয়ে, প্রতি শুক্রবার)
# ==========================================================
# প্রতি শুক্রবার একবার চলার কথা। এটা যা করে:
#
#   ১. গত ৭ দিনে যেসব সার্কুলারে "আবেদন করেছি" বলা হয়েছে, সেগুলো গোনে
#   ২. যেসব সার্কুলার "আগ্রহী" কিন্তু এখনো "আবেদন করেছি" বলা হয়নি,
#      সেগুলোর তালিকা বের করে (শেষ তারিখ যাদের কাছাকাছি, আগে থাকবে)
#   ৩. এই সারাংশটা একটা পুশ নোটিফিকেশন আকারে পাঠায়
#
# বিস্তারিত তালিকা এমনিতেই PWA-র "আগ্রহী"/"আবেদন করেছি" ট্যাবে সবসময়
# দেখা যায় - এই রিপোর্টটা মূলত একটা মনে করিয়ে দেওয়া বার্তা, যাতে
# সপ্তাহে অন্তত একবার গিয়ে পুরো অগ্রগতি একনজরে দেখে নেওয়া হয়। নোটিফিকেশনে
# ক্লিক করলে PWA খুলে যাবে, সেখানে সম্পূর্ণ তালিকা দেখা যাবে।
#
# চালানোর আগে (শুধু প্রথমবার): pip install pywebpush
# এর জন্য একই VAPID Secrets লাগবে, যা send_reminders.py-তে ব্যবহার হয়।
# ==========================================================

from datetime import datetime, timedelta

from job_db import load_db, save_db
from push_utils import VAPID_PRIVATE_KEY, send_to_all_subscriptions
from date_utils import get_bd_today, parse_deadline, DEADLINE_KEY


def build_weekly_report(db):
    """গত ৭ দিনে ক'টা আবেদন সম্পন্ন হয়েছে, আর এখনো ক'টা বাকি আছে
    (শেষ তারিখ অনুযায়ী সাজানো) - এই দুটো হিসাব করে।"""
    today = get_bd_today()
    week_ago = today - timedelta(days=7)

    applied_this_week = 0
    still_pending = []

    for entry in db.get("circulars", {}).values():
        status = entry.get("status")

        if status == "applied":
            applied_date_text = entry.get("applied_date")
            if applied_date_text:
                try:
                    applied_date = datetime.strptime(applied_date_text, "%Y-%m-%d").date()
                    if week_ago <= applied_date <= today:
                        applied_this_week += 1
                except ValueError:
                    pass  # পুরনো এন্ট্রি যেগুলোতে এই তারিখ নেই, সেগুলো বাদ

        elif status == "interested":
            deadline_text = (entry.get("details") or {}).get(DEADLINE_KEY)
            deadline = parse_deadline(deadline_text)
            still_pending.append({"entry": entry, "deadline": deadline})

    # শেষ তারিখ যাদের কাছাকাছি, তারা আগে থাকবে; তারিখ বুঝতে না পারা
    # এন্ট্রিগুলো সবার শেষে যাবে
    still_pending.sort(key=lambda item: (item["deadline"] is None, item["deadline"] or today))

    return applied_this_week, still_pending


def build_notification_payload(applied_count, still_pending):
    lines = [
        f"✅ এই সপ্তাহে আবেদন সম্পন্ন: {applied_count}টা",
        f"📋 এখনো বাকি (আগ্রহী): {len(still_pending)}টা",
    ]

    if still_pending:
        nearest = still_pending[0]["entry"]
        deadline_text = (nearest.get("details") or {}).get(DEADLINE_KEY, "তারিখ অজানা")
        lines.append(f"সবচেয়ে কাছের সময়সীমা: {nearest.get('site', '')} — {deadline_text}")

    return {
        "title": "📊 সাপ্তাহিক রিপোর্ট",
        "body": "\n".join(lines),
        "url": "/",
    }


def main():
    if not VAPID_PRIVATE_KEY:
        print("সতর্কতা: VAPID_PRIVATE_KEY পাওয়া যায়নি, রিপোর্ট পাঠানো সম্ভব না।")
        return

    db = load_db()

    if not db.get("push_subscriptions"):
        print("এখনো কেউ নোটিফিকেশনে সাবস্ক্রাইব করেননি, তাই রিপোর্ট পাঠানো হচ্ছে না।")
        return

    applied_count, still_pending = build_weekly_report(db)
    payload = build_notification_payload(applied_count, still_pending)

    print(f"সাপ্তাহিক রিপোর্ট: {applied_count}টা আবেদন সম্পন্ন এই সপ্তাহে, {len(still_pending)}টা এখনো বাকি")

    if send_to_all_subscriptions(db, payload):
        save_db(db)


if __name__ == "__main__":
    main()
