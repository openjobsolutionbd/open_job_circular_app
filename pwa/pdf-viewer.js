// ==========================================================
// pdf-viewer.js — পিডিএফকে ছবি আকারে দেখানোর লজিক
// ==========================================================
// "বিস্তারিত দেখুন"-এ ক্লিক করলে, নতুন ট্যাবে পিডিএফ না খুলে, এখানে
// pdf.js ব্যবহার করে পাতাগুলো ছবি (canvas) আকারে এই প্যানেলে দেখানো হয়।
// ==========================================================

function initPdfViewer() {
  const panel = document.getElementById("detail-panel");
  const closeBtn = document.getElementById("detail-close");
  const titleBar = document.getElementById("detail-title-bar");
  const content = document.getElementById("detail-content");

  function closePanel() {
    panel.classList.add("hidden");
    content.innerHTML = "";
  }

  closeBtn.addEventListener("click", closePanel);

  function showError(entry) {
    content.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "detail-error";
    wrap.textContent = "⚠️ পিডিএফ দেখানো যায়নি। ";

    const link = document.createElement("a");
    link.href = entry.link;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "সরাসরি লিংকে দেখুন";

    wrap.appendChild(link);
    content.appendChild(wrap);
  }

  function addDownloadLink(entry) {
    const downloadLink = document.createElement("a");
    downloadLink.href = entry.link;
    downloadLink.target = "_blank";
    downloadLink.rel = "noopener";
    downloadLink.className = "detail-download-link";
    downloadLink.textContent = "⬇️ পুরো পিডিএফ ডাউনলোড করুন";
    content.appendChild(downloadLink);
  }

  window.openPdfViewer = async function (entry) {
    titleBar.textContent = entry.site || "বিস্তারিত";
    content.innerHTML = '<div class="detail-loading">পিডিএফ লোড হচ্ছে...</div>';
    panel.classList.remove("hidden");

    if (!window.pdfjsLib) {
      showError(entry);
      return;
    }

    try {
      const proxyUrl =
        "/api/pdf-proxy?url=" +
        encodeURIComponent(entry.link) +
        "&secret=" +
        encodeURIComponent(APP_SECRET);

      const pdf = await window.pdfjsLib.getDocument(proxyUrl).promise;

      content.innerHTML = "";
      const maxPages = Math.min(pdf.numPages, 10);

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });

        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page-canvas";
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        content.appendChild(canvas);
      }

      if (pdf.numPages > maxPages) {
        const note = document.createElement("p");
        note.className = "detail-note";
        note.textContent = `মোট ${pdf.numPages} পাতা, প্রথম ${maxPages}টা দেখানো হচ্ছে।`;
        content.appendChild(note);
      }

      addDownloadLink(entry);
    } catch (e) {
      console.error(e);
      showError(entry);
    }
  };
}

initPdfViewer();
