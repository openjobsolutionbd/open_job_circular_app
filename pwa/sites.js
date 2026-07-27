// ==========================================================
// sites.js — "সাইট ম্যানেজ করুন" প্যানেলের ফ্রন্টএন্ড লজিক
// ==========================================================
// এই ফাইলটা /api/websites-এ সাইটের তালিকা আনতে, নতুন সাইট যোগ করতে,
// আর পুরনো সাইট মুছতে অনুরোধ পাঠায়। APP_SECRET app.js থেকে ব্যবহার
// করা হচ্ছে (একই ফাইলে দুইবার লেখার দরকার নেই)।
// ==========================================================

function initSitesPanel() {
  const manageBtn = document.getElementById("manage-sites-btn");
  const panel = document.getElementById("sites-panel");
  const closeBtn = document.getElementById("sites-close");
  const form = document.getElementById("add-site-form");
  const nameInput = document.getElementById("site-name-input");
  const urlInput = document.getElementById("site-url-input");
  const listEl = document.getElementById("sites-list");

  let sites = [];
  let loaded = false;

  function toggle(show) {
    panel.classList.toggle("hidden", !show);
    if (show && !loaded) loadSites();
  }

  manageBtn.addEventListener("click", () => toggle(true));
  closeBtn.addEventListener("click", () => toggle(false));

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderSites() {
    if (sites.length === 0) {
      listEl.innerHTML = `<div class="empty-state">এখনো কোনো সাইট যোগ করা হয়নি।</div>`;
      return;
    }

    listEl.innerHTML = sites
      .map(
        (s) => `
      <div class="site-row">
        <div class="site-row-info">
          <div class="site-row-name">${escapeHtml(s.name)}</div>
          <div class="site-row-url">${escapeHtml(s.url)}</div>
        </div>
        <button class="btn btn-ghost btn-remove-site" data-url="${escapeHtml(s.url)}">🗑️ মুছুন</button>
      </div>`
      )
      .join("");

    listEl.querySelectorAll(".btn-remove-site").forEach((btn) => {
      btn.addEventListener("click", () => removeSite(btn.getAttribute("data-url")));
    });
  }

  async function loadSites() {
    listEl.innerHTML = `<div class="empty-state">তালিকা লোড হচ্ছে...</div>`;
    try {
      const res = await fetch("/api/websites?secret=" + encodeURIComponent(APP_SECRET));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "তালিকা আনা যায়নি");
      sites = data.sites || [];
      loaded = true;
      renderSites();
    } catch (e) {
      listEl.innerHTML = `<div class="detail-error">⚠️ তালিকা লোড করা যায়নি: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function addSite(name, url) {
    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      const res = await fetch("/api/websites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", name, url, secret: APP_SECRET }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "সাইট যোগ করা যায়নি");

      sites = data.sites || sites;
      renderSites();
      nameInput.value = "";
      urlInput.value = "";
      showToast("✅ সাইট যোগ হয়েছে");
    } catch (e) {
      showToast("⚠️ " + e.message);
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function removeSite(url) {
    if (!confirm("এই সাইটটা তালিকা থেকে সরিয়ে ফেলতে চান?")) return;

    try {
      const res = await fetch("/api/websites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", url, secret: APP_SECRET }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "সাইট সরানো যায়নি");

      sites = data.sites || sites;
      renderSites();
      showToast("✅ সাইট সরানো হয়েছে");
    } catch (e) {
      showToast("⚠️ " + e.message);
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    if (!url) {
      showToast("⚠️ ওয়েবসাইটের ঠিকানা লিখুন");
      return;
    }
    addSite(name, url);
  });
}

// স্ক্রিপ্টটা পেজের একদম নিচে লোড হয় বলে, ততক্ষণে এই এলিমেন্টগুলো
// আগে থেকেই তৈরি হয়ে গেছে - তাই সরাসরি চালানো হচ্ছে
initSitesPanel();
