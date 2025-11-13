// upload.js

document.addEventListener("DOMContentLoaded", () => {
  const { BUCKET_URL, BASE_PREFIX, buildPrefix } = window.__S3_CONFIG__ || {};

  const fieldSelect = document.getElementById("uploadField");
  const categorySelect = document.getElementById("uploadCategory");
  const newCategoryInput = document.getElementById("newCategoryInput");
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const uploadButton = document.getElementById("uploadButton");
  const uploadStatus = document.getElementById("uploadStatus");

  if (!dropZone || !fileInput || !uploadButton) return;

  // Allowed extensions (no zips, exes, etc.)
  const allowedExtensions = [
    "pdf",
    "doc",
    "docx",
    "ppt",
    "pptx",
    "pptm",
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "tif",
    "tiff"
  ];

  function setStatus(message, isSuccess) {
    if (!uploadStatus) return;
    uploadStatus.textContent = message;
    uploadStatus.classList.remove("status-success", "status-error");
    if (isSuccess === true) {
      uploadStatus.classList.add("status-success");
    } else if (isSuccess === false) {
      uploadStatus.classList.add("status-error");
    }
  }

  function validateFile(file) {
    const name = file.name || "";
    const ext = name.split(".").pop().toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      throw new Error(
        "File type not allowed. Please upload PDF, Word, PowerPoint, or image files."
      );
    }
  }

  function handleFiles(files) {
    if (!files || files.length === 0) return;
    fileInput.files = files; // for simplicity keep it as a 1-file control
    setStatus(`Selected: ${files[0].name}`, true);
  }

  // Drag-and-drop events
  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFiles(fileInput.files);
    }
  });

  uploadButton.addEventListener("click", async () => {
    try {
      setStatus("", false);

      if (!fieldSelect.value) {
        setStatus("Please select a field.", false);
        return;
      }

      let category = categorySelect.value;
      const newCat = newCategoryInput.value.trim();

      if (!category && newCat) {
        category = newCat;
      }

      if (!category) {
        setStatus("Please select or create a category.", false);
        return;
      }

      const files = fileInput.files;
      if (!files || files.length === 0) {
        setStatus("Please select a file first.", false);
        return;
      }

      const file = files[0];
      validateFile(file);

      const field = fieldSelect.value;

      // Construct key: uploadedfiles/<Field>/<Category>/<filename>
      const rawKey = `${BASE_PREFIX}${field}/${category}/${file.name}`;
      const encodedKey = encodeURIComponent(rawKey).replace(/%2F/g, "/");
      const uploadUrl = `${BUCKET_URL}/${encodedKey}`;

      const res = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });

      if (!res.ok) {
        console.error("Upload error:", res.status, await res.text());
        setStatus("❌ Upload failed. Please try again.", false);
        return;
      }

      setStatus("✅ Upload successful!", true);

      // If it was a brand new category, add it to the dropdown
      if (newCat && !Array.from(categorySelect.options).some((o) => o.value === newCat)) {
        const opt = document.createElement("option");
        opt.value = newCat;
        opt.textContent = newCat;
        categorySelect.appendChild(opt);
        categorySelect.value = newCat;
      }

      // Reset file input
      fileInput.value = "";
    } catch (err) {
      console.error(err);
      setStatus(`❌ ${err.message || "Upload failed."}`, false);
    }
  });
});
