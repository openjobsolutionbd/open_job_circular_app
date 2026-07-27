// ==========================================================
// app.js — PWA-র মূল লজিক
// ==========================================================
// এই ফাইলটা করে:
//   ১. job_database.json থেকে তথ্য এনে তালিকা দেখানো
//   ২. "আগ্রহী" / "প্রয়োজন নেই" / "আবেদন করেছি" বাটনে চাপলে
//      /api/update-এ পাঠিয়ে গিটহাবে আপডেট করা
//   ৩. নোটিফিকেশনের অনুমতি নেওয়া ও /api/subscribe-এ পাঠানো
// ==========================================================

// ⚠️ এই কোডটা এখানে বসান, যেটা Cloudflare Pages-এর APP_SECRET
// এনভায়রনমেন্ট ভ্যারিয়েবলে দেওয়া কোডের সাথে হুবহু মিলবে।
// এটা কোনো শক্তিশালী নিরাপত্তা না (যে কেউ পেজের সোর্স দেখলে এটা
// দেখতে পারবে), কিন্তু র‍্যান্ডম ইন্টারনেট থেকে কেউ সরাসরি API
// কল করে তথ্য পাল্টে ফেলতে পারবে না, এইটুকু সুরক্ষা দেয়।
const APP_SECRET = "এখানে_নিজের_একটা_গোপন_কোড_বসান";

// আপনার নিজের ব্রাউজার থেকে পাওয়া VAPID পাবলিক-কি (এটা তৈরি করা হয়ে
// গেছে, এটাই ব্যবহার করুন - আলাদা কিছু বসাতে হবে না)
const VAPID_PUBLIC_KEY = "BE6CnxhcgU5adBRYJx2zuk6cpLbXhp45ZIa_mcbvBMYtCeD56MEfOWtkm1eK_bZny_Ec960qTlqQWzgAGcW0YWI";

const TAB_ORDER = ["new", "interested", "applied", "not_interested", "all"];
const STATUS_LABEL = {
  new: "নতুন",
  interested: "আগ্রহী",
  applied: "আবেদন করেছি",
  not_interested: "প্রয়োজন নেই",
};

let db = { circulars: {}, last_run: {} };
let activeTab = "new";

// ---------- তথ্য লোড করা ----------

async function loadData() {
  let loadFailed = false;
  try {
    const res = await fetch("/job_database.json?t=" + Date.now());
    if (!res.ok) throw new Error("ফাইল পাওয়া যায়নি");
    db = await res.json();
  } catch (e) {
    loadFailed = true;
    db = { circulars: {}, last_run: {} };
  }
  renderHeader(loadFailed);
  render();
}

function renderHeader(loadFailed = false) {
  const lastRun = db.last_run || {};
  const subtitle = document.getElementById("header-subtitle");
  if (lastRun.date) {
    subtitle.textContent = `সর্বশেষ হালনাগাদ: ${lastRun.date} — ${lastRun.new_count || 0}টা নতুন খবর`;
  } else {
    subtitle.textContent = "চাকরি ও নিয়োগ বিজ্ঞপ্তি";
  }

  const statusBar = document.getElementById("status-bar");

  // তথ্য লোড করাই ব্যর্থ হলে, এই এররটাই সবচেয়ে গুরুত্বপূর্ণ - এটা যেন
  // নিচের "failed_sites" চেক করে মুছে না যায়, তাই এখানেই আলাদাভাবে দেখানো
  if (loadFailed) {
    statusBar.innerHTML =
      '<span class="error">⚠️ তথ্য লোড করতে সমস্যা হয়েছে। একটু পর আবার চেষ্টা করুন।</span>';
    return;
  }

  const failedSites = lastRun.failed_sites || [];
  if (failedSites.length > 0) {
    statusBar.innerHTML = `<span class="error">⚠️ ${failedSites.length}টা সাইটে সমস্যা হয়েছে</span>`;
  } else {
    statusBar.textContent = "";
  }
}

// ---------- তালিকা দেখানো ----------

function getCircularsForTab(tab) {
  const all = Object.values(db.circulars || {});
  if (tab === "all") return all;
  return all.filter((c) => (c.status || "new") === tab);
}

function render() {
  const main = document.getElementById("main-content");
  const items = getCircularsForTab(activeTab).sort((a, b) => {
    // যাদের শেষ তারিখ আছে, তারা আগে দেখাবে; না থাকলে তালিকার শেষে যাবে
    const da = (a.details || {})["আবেদনের শেষ তারিখ"] || "";
    const db_ = (b.details || {})["আবেদনের শেষ তারিখ"] || "";
    if (!da && !db_) return 0;
    if (!da) return 1;
    if (!db_) return -1;
    return da.localeCompare(db_);
  });

  if (items.length === 0) {
    main.innerHTML = `<div class="empty-state">এই তালিকায় এখনো কিছু নেই।</div>`;
    return;
  }

  main.innerHTML = items.map(renderCard).join("");

  // প্রতিটা কার্ডের বাটনে ক্লিক-শোনা যোগ করা হচ্ছে
  main.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      updateStatus(id, action);
    });
  });

  // পিডিএফ লিংকে ক্লিক করলে নতুন ট্যাবের বদলে ভেতরেই ছবি আকারে দেখানো হবে
  main.querySelectorAll("[data-view-pdf]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const id = link.getAttribute("data-view-pdf");
      const entry = db.circulars[id];
      if (entry && window.openPdfViewer) {
        window.openPdfViewer(entry);
      } else if (entry) {
        window.open(entry.link, "_blank");
      }
    });
  });
}

function renderCard(entry) {
  const details = entry.details || {};
  const deadline = details["আবেদনের শেষ তারিখ"];
  const status = entry.status || "new";

  // "আবেদনের শেষ তারিখ" ছাড়া বাকি সব ডিটেইলস (যেমন পদসংখ্যা) সাধারণভাবে দেখানো হবে
  let detailsHtml = "";
  Object.entries(details).forEach(([key, value]) => {
    if (key === "আবেদনের শেষ তারিখ") return;
    detailsHtml += `<div>📋 ${escapeHtml(key)}: ${escapeHtml(value)}</div>`;
  });

  // শিরোনামের ঠিক নিচে, লাল রঙে, ডেডলাইন
  const deadlineHtml = deadline
    ? `<p class="card-deadline">Deadline: ${escapeHtml(deadline)}</p>`
    : `<div class="card-warning">⚠️ শেষ তারিখ স্বয়ংক্রিয়ভাবে বোঝা যায়নি — নিজে চেক করুন</div>`;

  let actionsHtml = "";
  if (status === "new") {
    actionsHtml = `
      <div class="card-actions">
        <button class="btn btn-primary" data-action="interested" data-id="${entry.id}">✅ আগ্রহী</button>
        <button class="btn btn-ghost" data-action="not_interested" data-id="${entry.id}">❌ প্রয়োজন নেই</button>
      </div>`;
  } else if (status === "interested") {
    actionsHtml = `
      <div class="card-actions">
        <button class="btn btn-success" data-action="applied" data-id="${entry.id}">🎉 আবেদন করেছি</button>
        <button class="btn btn-ghost" data-action="not_interested" data-id="${entry.id}">❌ প্রয়োজন নেই</button>
      </div>`;
  } else if (status === "not_interested") {
    actionsHtml = `
      <div class="card-actions">
        <button class="btn btn-primary" data-action="interested" data-id="${entry.id}">✅ আবার আগ্রহী করুন</button>
      </div>`;
  } else if (status === "applied") {
    actionsHtml = `
      <div class="card-actions">
        <button class="btn btn-ghost" data-action="interested" data-id="${entry.id}">↩️ ফিরিয়ে নিন</button>
      </div>`;
  }

  const linkAttr = entry.is_pdf
    ? `href="#" data-view-pdf="${entry.id}"`
    : `href="${escapeHtml(entry.link)}" target="_blank" rel="noopener"`;

  return `
    <div class="card">
      <div class="card-top">
        <span class="card-site">${escapeHtml(entry.site || "")}</span>
        <span class="badge badge-${status}">${STATUS_LABEL[status] || status}</span>
      </div>
      <p class="card-title">${escapeHtml(entry.title || "")}</p>
      ${deadlineHtml}
      <div class="card-details">${detailsHtml}</div>
      ${actionsHtml}
      <a class="card-link" ${linkAttr}>🔗 বিস্তারিত দেখুন</a>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- স্ট্যাটাস আপডেট করা (আগ্রহী/আবেদন করেছি/প্রয়োজন নেই) ----------

async function updateStatus(id, status) {
  const entry = db.circulars[id];
  if (!entry) return;

  const previousStatus = entry.status;
  entry.status = status; // সাথে সাথে স্ক্রিনে দেখানো হচ্ছে (optimistic update)
  render();
  showToast("সেভ হচ্ছে...");

  try {
    const res = await fetch("/api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, secret: APP_SECRET }),
    });

    if (!res.ok) throw new Error("সেভ করা যায়নি");

    showToast("✅ সেভ হয়েছে");
  } catch (e) {
    entry.status = previousStatus; // ব্যর্থ হলে আগের অবস্থায় ফিরিয়ে দেওয়া
    render();
    showToast("⚠️ সেভ করা যায়নি, আবার চেষ্টা করুন");
  }
}

function showToast(text) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2000);
}

// ---------- ট্যাব সুইচ করা ----------

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;

  const tabName = btn.getAttribute("data-tab");
  if (!tabName) return; // data-tab নেই মানে এটা আসলে ট্যাব-সুইচার বাটন না
  // (যেমন "সাইট ম্যানেজ করুন" বাটন, যেটা আলাদা প্যানেল খোলে)

  activeTab = tabName;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  render();
});

// ---------- নোটিফিকেশন চালু করা ----------

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function enableNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    showToast("⚠️ এই ব্রাউজারে নোটিফিকেশন সমর্থিত না");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    showToast("⚠️ নোটিফিকেশনের অনুমতি দেওয়া হয়নি");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription, secret: APP_SECRET }),
    });

    if (!res.ok) throw new Error("সাবস্ক্রিপশন সেভ করা যায়নি");

    document.getElementById("notify-text").textContent = "✅ নোটিফিকেশন চালু আছে";
    document.getElementById("notify-btn").style.display = "none";
    showToast("✅ নোটিফিকেশন চালু হয়েছে");
  } catch (e) {
    showToast("⚠️ নোটিফিকেশন চালু করা যায়নি: " + e.message);
  }
}

document.getElementById("notify-btn").addEventListener("click", enableNotifications);

// ---------- থিম বদলানো (হালকা/গাঢ়ো) ----------

function applyThemeButtonIcon() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  document.getElementById("theme-toggle").textContent = current === "dark" ? "☀️" : "🌙";
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  applyThemeButtonIcon();
}

document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
applyThemeButtonIcon();

// ---------- শুরু করা ----------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

loadData();
