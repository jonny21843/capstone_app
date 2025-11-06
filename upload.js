document.addEventListener("DOMContentLoaded", () => {
  const uploadSel   = document.getElementById("uploadCategory");
  const newCatInput = document.getElementById("newCategory");
  const dropZone    = document.getElementById("dropZone");
  const fileInput   = document.getElementById("fileInput");
  const uploadBtn   = document.getElementById("uploadBtn");
  const statusEl    = document.getElementById("uploadStatus");

  let pendingFile = null;

  function setStatus(ok, msg) {
    statusEl.className = "status " + (ok ? "ok" : "err");
    statusEl.textContent = (ok ? "✅ " : "❌ ") + msg;
    statusEl.style.display = "block";
  }

  // Clicking the drop zone opens file picker
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });

  // Drag visuals
  ["dragenter","dragover"].forEach(ev =>
    dropZone.addEventListener(ev, e => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    })
  );
  ["dragleave","drop"].forEach(ev =>
    dropZone.addEventListener(ev, e => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    })
  );

  dropZone.addEventListener("drop", (e) => {
    pendingFile = e.dataTransfer.files?.[0] || null;
    if (pendingFile) dropZone.textContent = `Selected: ${pendingFile.name}`;
  });

  fileInput.addEventListener("change", () => {
    pendingFile = fileInput.files?.[0] || null;
    if (pendingFile) dropZone.textContent = `Selected: ${pendingFile.name}`;
  });

  uploadBtn.addEventListener("click", async () => {
    statusEl.style.display = "none";

    // Resolve category: existing or new
    let category = (uploadSel.value || "").trim();
    const proposed = (newCatInput.value || "").trim();
    if (!category && proposed) category = proposed;

    if (!category) return setStatus(false, "Pick or create a category.");
    if (!pendingFile) return setStatus(false, "Choose a file to upload.");

    const safe = slugify(category);
    const { bucketRest, prefixRoot } = window.APP;

    // PUT to the website endpoint works for public-write buckets too,
    // but using REST base keeps it consistent with listing.
    const putUrl = `${bucketRest}/${encodeURIComponent(prefixRoot + safe)}/${encodeURIComponent(pendingFile.name)}`;

    try {
      const res = await fetch(putUrl, {
        method: "PUT",
        headers: { "Content-Type": pendingFile.type || "application/octet-stream" },
        body: pendingFile
      });

      if (!res.ok) {
        const t = await res.text();
        console.error(t);
        return setStatus(false, `Upload failed.`);
      }

      setStatus(true, "Upload successful!");
      // Clear selection
      pendingFile = null;
      fileInput.value = "";
      dropZone.textContent = "Drag a file here, or click to select one";

      // If it was a new category, hydrate both dropdowns
      if (!Array.from(uploadSel.options).some(o => o.value === safe)) {
        await window.refreshCategories?.();
        // Select the new category in the upload dropdown
        uploadSel.value = safe;
      }
    } catch (e) {
      console.error(e);
      setStatus(false, "Upload error.");
    }
  });
});
