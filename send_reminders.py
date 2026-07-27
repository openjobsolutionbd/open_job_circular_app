# ==========================================================
# send_reminders.py — শেষ তারিখের রিমাইন্ডার (Web Push দিয়ে)
# ==========================================================
# দিনে কয়েকবার (সকাল ৭টা, বেলা ১১টা, বিকাল ৩টা, সন্ধ্যা ৭টা - বাংলাদেশ
# সময়) এই স্ক্রিপ্টটা চলার কথা। এটা যা করে:
#
#   ১. যেসব সার্কুলার "আগ্রহী" (status = interested) হিসেবে চিহ্নিত,
#      কিন্তু এখনো "আবেদন করেছি" বলা হয়নি, সেগুলো দেখে
#   ২. যাদের আবেদনের শেষ তারিখ আজ থেকে ৩ দিনের মধ্যে (আজ, কাল বা
#      পরশু), তাদের জন্য পুশ নোটিফিকেশন পাঠায়
#   ৩. PWA থেকে সংরক্ষিত সবগুলো push_subscriptions-এ পাঠানো হয়
#   ৪. কোনো সাবস্ক্রিপশন আর বৈধ না থাকলে (ব্যবহারকারী নোটিফিকেশন বন্ধ
#      করে দিয়েছেন), সেটা ডাটাবেজ থেকে সরিয়ে দেয়
#
# চালানোর আগে (শুধু প্রথমবার): pip install pywebpush
#
# এর জন্য দুটো জিনিস দরকার (GitHub Secrets এ):
#   VAPID_PRIVATE_KEY  -- Web Push-এর নিজের পরিচয়ের গোপন কি
#   VAPID_CLAIMS_SUB    -- একটা যোগাযোগের ইমেইল (mailto:...), Web Push
#                          স্ট্যান্ডার্ডের নিয়ম অনুযায়ী লাগে
# ==========================================================

from job_db import load_db, save_db
from push_utils import VAPID_PRIVATE_KEY, send_to_all_subscriptions
from date_utils import get_bd_today, parse_deadline, DEADLINE_KEY

REMINDER_WINDOW_DAYS = 3


def find_due_reminders(db):
    """যাদের এখনই রিমাইন্ডার পাঠানো দরকার, তাদের একটা তালিকা বানায়।"""
    today = get_bd_today()
    due = []

    for entry in db.get("circulars", {}).values():
        if entry.get("status") != "interested":
            continue  # শুধু "আগ্রহী" চিহ্নিত করা সার্কুলারের জন্যই রিমাইন্ডার

        deadline_text = (entry.get("details") or {}).get(DEADLINE_KEY)
        deadline = parse_deadline(deadline_text)

        if deadline is None:
            continue  # তারিখ বুঝতে না পারলে রিমাইন্ডার পাঠানো সম্ভব না

        days_left = (deadline - today).days

        if 0 <= days_left <= REMINDER_WINDOW_DAYS:
            due.append({"entry": entry, "days_left": days_left})

    return due


def build_notification_payload(item):
    entry = item["entry"]
    days_left = item["days_left"]

    if days_left == 0:
        time_text = "⏰ আজই শেষ দিন!"
    elif days_left == 1:
        time_text = "⏰ আগামীকাল শেষ দিন"
    else:
        time_text = f"⏰ আর {days_left} দিন বাকি"

    return {
        "title": f"{time_text} — {entry['site']}",
        "body": entry["title"],
        "url": entry["link"],
    }


def main():
    if not VAPID_PRIVATE_KEY:
        print("সতর্কতা: VAPID_PRIVATE_KEY পাওয়া যায়নি, রিমাইন্ডার পাঠানো সম্ভব না।")
        return

    db = load_db()

    if not db.get("push_subscriptions"):
        print("এখনো কেউ নোটিফিকেশনে সাবস্ক্রাইব করেননি, তাই কিছু পাঠানো হচ্ছে না।")
        return

    due_reminders = find_due_reminders(db)
    print(f"{len(due_reminders)}টা সার্কুলারের রিমাইন্ডার পাঠানোর সময় হয়েছে।")

    changed = False
    for item in due_reminders:
        payload = build_notification_payload(item)
        print(f"পাঠানো হচ্ছে: {payload['title']} — {payload['body']}")
        if send_to_all_subscriptions(db, payload):
            changed = True

    if changed:
        save_db(db)


if __name__ == "__main__":
    main()
