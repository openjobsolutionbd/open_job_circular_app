# ==========================================================
# date_utils.py — তারিখ সংক্রান্ত সাধারণ (শেয়ার করা) ফাংশন
# ==========================================================
# send_reminders.py আর weekly_report.py দুটোই এটা ব্যবহার করে।
# ==========================================================

import re
from datetime import datetime, timedelta, date

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
    bd_now = datetime.utcnow() + timedelta(hours=6)
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
            m2 = re.search(rf"(\d{{1,2}})\s*{month_name}", ascii_text)
            y2 = re.search(r"(\d{4})", ascii_text)
            if m2 and y2:
                try:
                    return date(int(y2.group(1)), month_num, int(m2.group(1)))
                except ValueError:
                    return None

    return None
