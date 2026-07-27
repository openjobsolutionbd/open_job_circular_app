// ==========================================================
// chat.js — PWA-র চ্যাট বক্সের ফ্রন্টএন্ড লজিক
// ==========================================================
// এই ফাইলটা /api/chat-এ প্রশ্ন পাঠায় আর উত্তর দেখায়। এখানে APP_SECRET
// app.js থেকে ব্যবহার করা হচ্ছে (একই ফাইলে দুইবার লেখার দরকার নেই)।
// ==========================================================

function initChat() {
  const fab = document.getElementById("chat-fab");
  const panel = document.getElementById("chat-panel");
  const closeBtn = document.getElementById("chat-close");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const messages = document.getElementById("chat-messages");

  function toggleChat(show) {
    panel.classList.toggle("hidden", !show);
    if (show) input.focus();
  }

  fab.addEventListener("click", () => toggleChat(true));
  closeBtn.addEventListener("click", () => toggleChat(false));

  function addBubble(role, text) {
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble chat-" + role;
    bubble.textContent = text;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    input.value = "";
    input.disabled = true;
    addBubble("user", question);
    const loadingBubble = addBubble("assistant", "উত্তর তৈরি হচ্ছে...");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, secret: APP_SECRET }),
      });

      const data = await res.json();

      if (!res.ok) {
        loadingBubble.textContent = "⚠️ " + (data.error || "উত্তর পাওয়া যায়নি");
      } else {
        loadingBubble.textContent = data.answer;
      }
    } catch (err) {
      loadingBubble.textContent = "⚠️ নেটওয়ার্ক সমস্যা, আবার চেষ্টা করুন।";
    } finally {
      input.disabled = false;
      input.focus();
      messages.scrollTop = messages.scrollHeight;
    }
  });
}

// স্ক্রিপ্টটা পেজের একদম নিচে লোড হয় বলে, ততক্ষণে এই এলিমেন্টগুলো
// আগে থেকেই তৈরি হয়ে গেছে - তাই সরাসরি চালানো হচ্ছে, DOMContentLoaded-এর
// অপেক্ষা করার দরকার নেই (অপেক্ষা করলে ইভেন্টটা তখন ইতিমধ্যে চলে
// যাওয়ায় ফাংশনটা আর চালুই হতো না)
initChat();
