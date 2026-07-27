# ==========================================================
# চাকরি/নিয়োগ খবর সংগ্রহকারী (Chakri Khobor Collector)
# ==========================================================
# প্রতিদিন একবার এই স্ক্রিপ্টটা চলবে (গিটহাব অ্যাকশনস দিয়ে)। এটা যা করে:
#
#   ১. প্রথম আলোর RSS ফিড আর websites.txt-এ দেওয়া সরকারি সাইটগুলোর
#      নোটিশ পাতা থেকে চাকরির খবর খুঁজে বের করে (পিডিএফ/OCR সহ)
#   ২. প্রতিটা খবরের একটা স্থায়ী পরিচয় (ID) বানায়, আগে থেকে ডাটাবেজে
#      থাকলে বাদ দেয় — একই খবর দ্বিতীয়বার যোগ হয় না
#   ৩. নতুন খবরগুলো "new" স্ট্যাটাসে job_database.json-এ যোগ করে
#      (এই ফাইলটাই PWA দেখাবে, আর গিটহাব অ্যাকশনসের মাধ্যমে
#      রিপোজিটরিতে জমা/commit হয়ে যাবে)
#   ৪. কোনো সাইটে সমস্যা হলে সেটাও ডাটাবেজে টুকে রাখে (PWA-তে দেখা
#      যাবে বলে, আলাদা করে কোথাও পাঠানো লাগে না)
#
# এখানে টেলিগ্রাম সংক্রান্ত কিছু নেই — সব কিছু PWA-র মাধ্যমে দেখা হবে।
#
# চালানোর আগে একবার (শুধু প্রথমবার):
#   pip install requests beautifulsoup4 pypdf pytesseract pdf2image
# ==========================================================

import os
import re
import io
import requests
import xml.etree.ElementTree as ET
from urllib.parse import urljoin
from bs4 import BeautifulSoup
from pypdf import PdfReader
from pdf2image import convert_from_bytes
import pytesseract

from job_db import load_db, save_db, make_id
from date_utils import get_bd_today

# --- সেটিংস ---

RSS_SOURCES = [
    {"name": "প্রথম আলো", "url": "https://www.prothomalo.com/feed/"},
]

WEBSITES_FILE = "websites.txt"

JOB_KEYWORDS = ["নিয়োগ বিজ্ঞপ্তি", "নিয়োগ", "চাকরি", "শূন্য পদ", "job circular", "recruitment"]

DEADLINE_KEY = "আবেদনের শেষ তারিখ"

# কোন কোন সাইটে সমস্যা হলো, সেটা এখানে জমা হবে
FAILED_SITES = []


def is_job_news(text):
    text_to_check = text.lower()
    for word in JOB_KEYWORDS:
        if word.lower() in text_to_check:
            return True
    return False


def extract_text_with_ocr(pdf_bytes, max_pages=3):
    text = ""
    try:
        images = convert_from_bytes(pdf_bytes, first_page=1, last_page=max_pages)
        for image in images:
            text += pytesseract.image_to_string(image, lang="ben") + "\n"
    except Exception as e:
        print(f"[তথ্য] OCR করতে সমস্যা হয়েছে: {e}")
    return text


def extract_pdf_text(pdf_url, max_chars=6000):
    try:
        response = requests.get(
            pdf_url, timeout=25, headers={"User-Agent": "Mozilla/5.0"}
        )
        response.raise_for_status()
        pdf_bytes = response.content

        text = ""
        try:
            reader = PdfReader(io.BytesIO(pdf_bytes))
            for page in reader.pages[:6]:
                text += (page.extract_text() or "") + "\n"
                if len(text) > max_chars:
                    break
        except Exception:
            pass

        if len(text.strip()) < 30:
            print(f"[তথ্য] সরাসরি লেখা পাওয়া যায়নি, OCR দিয়ে পড়া হচ্ছে: {pdf_url}")
            text = extract_text_with_ocr(pdf_bytes)

        return text[:max_chars]

    except Exception as e:
        print(f"[তথ্য] পিডিএফ পড়া যায়নি ({pdf_url}): {e}")
        return ""


DIGIT_CLASS = r"[0-9০-৯]"
BANGLA_MONTHS = "জানুয়ারি|ফেব্রুয়ারি|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর"
DEADLINE_KEYWORDS = r"(শেষ তারিখ|আবেদনের শেষ সময়|আবেদন করার শেষ তারিখ)"


def extract_job_details(pdf_text):
    """best effort - সবসময় নাও মিলতে পারে।"""
    details = {}

    # প্যাটার্ন ১: সংখ্যা আগে, "পদ" পরে (যেমন "৫টি পদ")
    post_match = re.search(rf"({DIGIT_CLASS}+)\s*(?:টি)?\s*পদ", pdf_text)
    if post_match:
        details["পদসংখ্যা"] = post_match.group(1)
    else:
        # প্যাটার্ন ২: "পদ" আগে, সংখ্যা পরে (যেমন "শূন্য পদ ১০টি",
        # "পদসংখ্যা: ১০") - সরকারি নোটিশে এই ক্রমটাও সাধারণ, আগের
        # প্যাটার্নে এটা ধরা পড়ত না
        post_match2 = re.search(rf"পদ(?:সংখ্যা)?\s*[:：]?\s*({DIGIT_CLASS}+)\s*(?:টি)?", pdf_text)
        if post_match2:
            details["পদসংখ্যা"] = post_match2.group(1)

    # প্যাটার্ন ১: সংখ্যা দিয়ে লেখা তারিখ (যেমন ১৫-০৮-২০২৬)
    date_match = re.search(
        rf"{DEADLINE_KEYWORDS}[^0-9০-৯]{{0,25}}({DIGIT_CLASS}{{1,2}}[-/.]{DIGIT_CLASS}{{1,2}}[-/.]{DIGIT_CLASS}{{2,4}})",
        pdf_text,
    )

    # প্যাটার্ন ২: বাংলা মাসের নাম দিয়ে লেখা তারিখ (যেমন ১৫ আগস্ট, ২০২৬)
    if not date_match:
        date_match = re.search(
            rf"{DEADLINE_KEYWORDS}[^0-9০-৯]{{0,25}}"
            rf"({DIGIT_CLASS}{{1,2}}\s*(?:{BANGLA_MONTHS})\s*,?\s*{DIGIT_CLASS}{{4}})",
            pdf_text,
        )

    if date_match:
        details[DEADLINE_KEY] = date_match.group(2)

    return details


def fetch_from_rss(source):
    results = []
    try:
        response = requests.get(source["url"], timeout=15)
        response.raise_for_status()

        root = ET.fromstring(response.content)
        for item in root.iter("item"):
            title = item.findtext("title", default="").strip()
            link = item.findtext("link", default="").strip()
            if is_job_news(title):
                results.append(
                    {"site": source["name"], "title": title, "link": link, "is_pdf": False, "details": {}}
                )

    except Exception as e:
        error_message = str(e)
        print(f"[সমস্যা] {source['name']} থেকে খবর আনা যায়নি: {error_message}")
        FAILED_SITES.append({"site": source["name"], "error": error_message})

    return results


def fetch_from_gov_site(base_url):
    results = []
    notice_url = base_url.rstrip("/") + "/pages/notices"
    site_label = base_url.replace("https://", "").replace("http://", "").strip("/")

    try:
        response = requests.get(
            notice_url, timeout=20, headers={"User-Agent": "Mozilla/5.0"}
        )
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        tables = soup.find_all("table")
        if not tables:
            print(f"[তথ্য] {site_label} - কোনো নোটিশ টেবিল পাওয়া যায়নি।")
            FAILED_SITES.append(
                {"site": site_label, "error": "নোটিশ টেবিল খুঁজে পাওয়া যায়নি (হয়তো পাতার গঠন পাল্টেছে)"}
            )
            return results

        # পাতার মধ্যে টেবিলের ভেতর টেবিল (nested) থাকলে সেটার বড় "বাইরের"
        # টেবিলটা ভুল করে বেছে নেওয়া এড়াতে, শুধু সবচেয়ে বাইরের
        # (top-level) টেবিলগুলোর মধ্যে থেকে বেছে নেওয়া হচ্ছে
        top_level_tables = [t for t in tables if t.find_parent("table") is None]
        candidate_tables = top_level_tables or tables

        notice_table = max(candidate_tables, key=lambda t: len(t.find_all("tr")))

        for row in notice_table.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) < 2:
                continue

            title = cells[1].get_text(strip=True) if len(cells) > 1 else cells[0].get_text(strip=True)
            if not title:
                continue

            link_tag = row.find("a", href=True)
            link = urljoin(notice_url, link_tag["href"]) if link_tag else notice_url

            is_pdf = link.lower().endswith(".pdf")
            pdf_text = ""

            matched = is_job_news(title)
            if is_pdf and not matched:
                pdf_text = extract_pdf_text(link)
                if pdf_text:
                    matched = is_job_news(pdf_text)

            if matched:
                if is_pdf and not pdf_text:
                    pdf_text = extract_pdf_text(link)

                details = extract_job_details(pdf_text) if pdf_text else {}
                results.append(
                    {
                        "site": site_label,
                        "title": title,
                        "link": link,
                        "details": details,
                        "is_pdf": is_pdf,
                    }
                )

    except Exception as e:
        error_message = str(e)
        print(f"[সমস্যা] {site_label} থেকে খবর আনা যায়নি: {error_message}")
        FAILED_SITES.append({"site": site_label, "error": error_message})

    return results


def load_website_list():
    """websites.txt থেকে সাইটের URL-গুলো পড়ে। ফরম্যাট: 'নাম|url' -
    প্রতি লাইনে একটা করে। পুরনো ফরম্যাটের লাইন (শুধু URL, '|' ছাড়া)
    থাকলেও কাজ করবে (backward-compatible)। শুধু URL অংশটাই এখানে
    দরকার, নামটা PWA-র "সাইট ম্যানেজ করুন" অংশে দেখানোর জন্য ব্যবহৃত হয়।"""
    sites = []
    if not os.path.exists(WEBSITES_FILE):
        print(f"[তথ্য] {WEBSITES_FILE} ফাইল পাওয়া যায়নি, তাই সরকারি সাইট বাদ দেওয়া হলো।")
        return sites

    with open(WEBSITES_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "|" in line:
                _name, _, url = line.partition("|")
                url = url.strip()
            else:
                url = line
            if url:
                sites.append(url)

    return sites


def fetch_all_job_news():
    all_results = []

    for source in RSS_SOURCES:
        print(f"{source['name']} থেকে খবর আনা হচ্ছে...")
        all_results.extend(fetch_from_rss(source))

    for site in load_website_list():
        print(f"{site} থেকে খবর আনা হচ্ছে...")
        all_results.extend(fetch_from_gov_site(site))

    return all_results


def filter_new_circulars(candidates, db):
    """যেসব সার্কুলার আগে কখনো দেখা যায়নি (ডাটাবেজে নেই), শুধু সেগুলো
    বেছে নেয় এবং ডাটাবেজে যোগ করে।"""
    new_items = []
    today_str = get_bd_today().strftime("%Y-%m-%d")

    for news in candidates:
        circular_id = make_id(news["site"], news["link"])
        if circular_id in db["circulars"]:
            continue  # আগে থেকেই আছে, বাদ

        entry = {
            "id": circular_id,
            "site": news["site"],
            "title": news["title"],
            "link": news["link"],
            "details": news.get("details") or {},
            "is_pdf": news.get("is_pdf", False),
            "status": "new",
            "first_seen": today_str,
        }
        db["circulars"][circular_id] = entry
        new_items.append(entry)

    return new_items


def save_daily_summary_file(new_items):
    """আজকের নতুন খবরের একটা মার্কডাউন কপি রেখে দেয় (রেকর্ড হিসেবে,
    PWA ছাড়াও চাইলে সরাসরি ফাইলেও দেখা যায়)।"""
    today = get_bd_today().strftime("%d-%m-%Y")
    filename = f"chakri_khobor_{today}.md"

    with open(filename, "w", encoding="utf-8") as f:
        f.write(f"# আজকের নতুন চাকরির খবর ({today})\n\n")

        if not new_items:
            f.write("আজ কোনো নতুন চাকরির খবর পাওয়া যায়নি।\n")
        else:
            for entry in new_items:
                f.write(f"- **[{entry['site']}]** [{entry['title']}]({entry['link']})\n")
                details = entry.get("details") or {}
                if details:
                    detail_text = " | ".join(f"{k}: {v}" for k, v in details.items())
                    f.write(f"  - {detail_text}\n")
                if DEADLINE_KEY not in details:
                    f.write("  - ⚠️ শেষ তারিখ পাওয়া যায়নি\n")

        if FAILED_SITES:
            f.write("\n## যে সাইটগুলোতে সমস্যা হয়েছে\n\n")
            for fail in FAILED_SITES:
                f.write(f"- **{fail['site']}** — কারণ: {fail['error']}\n")

    print(f"রেকর্ড সেভ হয়েছে: {filename}")


# --- এখন আসল কাজটা চালানো হচ্ছে ---
if __name__ == "__main__":
    db = load_db()

    candidates = fetch_all_job_news()
    new_items = filter_new_circulars(candidates, db)

    print(f"মোট {len(candidates)}টা মিলেছে, এর মধ্যে {len(new_items)}টা নতুন (আগে দেখা হয়নি)।")

    # সাইটের সমস্যাগুলো ডাটাবেজে টুকে রাখা হচ্ছে, যাতে PWA-তে দেখা যায়
    db["last_run"] = {
        "date": get_bd_today().strftime("%Y-%m-%d"),
        "new_count": len(new_items),
        "failed_sites": FAILED_SITES,
    }

    save_daily_summary_file(new_items)
    save_db(db)
