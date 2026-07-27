# ==========================================================
# job_db.py — সবগুলো স্ক্রিপ্টের জন্য একটা সাধারণ (শেয়ার করা) ফাইল
# ==========================================================
# এই ফাইলে শুধু ডাটাবেজ (pwa/job_database.json) পড়া আর লেখার জন্য
# ছোট কিছু ফাংশন আছে। এটা নিজে থেকে চলে না, অন্য স্ক্রিপ্টগুলো
# (chakri_khobor.py, send_reminders.py, weekly_report.py) এটাকে
# "import" করে ব্যবহার করবে।
#
# ডাটাবেজের গঠন (সহজ ভাষায়):
# {
#   "circulars": {
#       "<একটা ছোট কোড>": {
#           "site": "কোন সাইট থেকে এসেছে",
#           "title": "শিরোনাম",
#           "link": "লিংক",
#           "details": {"পদসংখ্যা": "...", "আবেদনের শেষ তারিখ": "..."},
#           "is_pdf": true/false,
#           "status": "new" | "interested" | "not_interested" | "applied",
#           "first_seen": "2026-07-23"
#       },
#       ...
#   },
#   "last_run": {"date": "...", "new_count": 0, "failed_sites": []},
#   "push_subscriptions": []   -- PWA থেকে পাওয়া নোটিফিকেশন-ঠিকানাগুলো
# }
# ==========================================================

import json
import os
import copy
import hashlib

# ডাটাবেজ ফাইলটা এখন pwa/ ফোল্ডারের ভেতরে রাখা হচ্ছে, যাতে Cloudflare
# Pages (যেটা pwa/ ফোল্ডারটাই দেখায়) এটা সরাসরি একটা স্ট্যাটিক ফাইল
# হিসেবে দেখাতে পারে - আলাদা কোনো সার্ভার/API লাগে না শুধু পড়ার জন্য।
DB_FILE = os.path.join("pwa", "job_database.json")

DEFAULT_DB = {"circulars": {}, "push_subscriptions": []}


def make_id(site, link):
    """প্রতিটা সার্কুলারের জন্য একটা ছোট, স্থায়ী পরিচয় (ID) বানায়,
    যাতে একই সার্কুলার দ্বিতীয়বার দেখলে চেনা যায়।"""
    raw = f"{site}|{link}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:12]


def load_db():
    """ডাটাবেজ ফাইল থেকে তথ্য পড়ে। ফাইল না থাকলে বা নষ্ট হলে, খালি
    একটা ডাটাবেজ দিয়ে শুরু করে (প্রোগ্রাম থেমে যায় না)।"""
    if not os.path.exists(DB_FILE):
        return copy.deepcopy(DEFAULT_DB)

    try:
        with open(DB_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"[সতর্কতা] ডাটাবেজ ফাইল পড়তে সমস্যা হয়েছে, নতুন করে শুরু করা হচ্ছে: {e}")
        return copy.deepcopy(DEFAULT_DB)

    data.setdefault("circulars", {})
    data.setdefault("push_subscriptions", [])
    return data


def save_db(db):
    """ডাটাবেজ ফাইলে তথ্য লিখে রাখে।"""
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
