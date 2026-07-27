# ==========================================================
# date_utils.py — তারিখ সংক্রান্ত সাধারণ (শেয়ার করা) ফাংশন
# ==========================================================
# send_reminders.py আর weekly_report.py দুটোই এটা ব্যবহার করে।
# ==========================================================

import re
from datetime import datetime, timedelta, date, timezone

DEADLINE_KEY = "আবেদনের শেষ তারিখ"

BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯"
ASCII_DIGITS = "0123456789"
DIGIT_TRANSLATION = str.maketrans(BANGLA_DIGITS, ASCII_DIGITS)

BANGLA_MONTHS = {
    "জানুয়ারি": 1, "ফেব্রুয়ারি": 2, "মার্চ": 3, "এপ্রিল": 4, "মে": 5,
    "জুন": 6, "জুলাই": 7, "আগস্ট": 8, "সেপ্টেম্বর": 9, "অক্টোবর": 10,
    "নভেম্বর": 11, "ডিসেম্বর": 12,
}


def get_bd_today():
    """বাংলাদেশ সময় (UTC+6) অনুযায়ী আজকের তারিখ - GitHub Actions সার্ভার
    UTC সময়ে চলে বলে এই হিসাবটা আলাদাভাবে করা দরকার।"""
    bd_now = datetime.now(timezone.utc) + timedelta(hours=6)
    return bd_now.date()


def parse_deadline(text):
    """'১৫-০৮-২০২৬' বা '১৫ আগস্ট, ২০২৬' ধরনের লেখা থেকে আসল তারিখ বের
    করার চেষ্টা করে। বুঝতে না পারলে None দেয় - অনুমান করে ভুল তারিখ
    বসানোর চেয়ে নিরাপদ।"""
    if not text:
        return None

    ascii_text = text.translate(DIGIT_TRANSLATION)

    # প্যাটার্ন ১: সংখ্যা দিয়ে লেখা তারিখ
    m = re.search(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", ascii_text)
    if m:
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if year < 100:
            year += 2000
        try:
            return date(year, month, day)
        except ValueError:
            return None

    # প্যাটার্ন ২: বাংলা মাসের নাম দিয়ে লেখা তারিখ
    for month_name, month_num in BANGLA_MONTHS.items():
        if month_name in text:
            # দিন, মাসের নাম, আর বছর - এই তিনটাই একসাথে, কাছাকাছি
            # (৳{0,15} ফাঁকে) থাকতে হবে। আগে বছরটা আলাদাভাবে
            # (re.search(r"(\d{4})", ...)) পুরো টেক্সটে যেকোনো জায়গায়
            # খোঁজা হতো - তাতে টেক্সটে দূরে থাকা অন্য কোনো ৪-অঙ্কের
            # সংখ্যা (যেমন স্মারক নম্বর, বিজ্ঞপ্তি নম্বর) ভুলভাবে বছর
            # হিসেবে ধরা পড়ে একেবারে অর্থহীন তারিখ (যেমন সাল ১২৩৪)
            # তৈরি করে ফেলত, আর সেই ভুল তারিখের কারণে আসল রিমাইন্ডার
            # চুপচাপ মিস হয়ে যেত।
            m2 = re.search(rf"(\d{{1,2}})\s*{month_name}\D{{0,15}}?(\d{{4}})", ascii_text)
            if m2:
                try:
                    return date(int(m2.group(2)), month_num, int(m2.group(1)))
                except ValueError:
                    return None

    return None
