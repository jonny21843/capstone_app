console.log("UPLOAD_JS ACTIVE");

document.addEventListener("DOMContentLoaded", () => {
    // Make sure BUCKET_URL is available from config.js
    if (typeof BUCKET_URL === "undefined") {
        console.error("BUCKET_URL is not defined. Check config.js and script order in index.html.");
        return;
    }

    // Try both the old and new ID patterns so we don't break your HTML
    const fieldSelect =
        document.getElementById("upload-field") ||
        document.getElementById("uploadField");

    const newFieldInput =
        document.getElementById("upload-new-field") ||
        document.getElementById("new-field") ||
        document.getElementById("newField");

    const categorySelect =
        document.getElementById("upload-category") ||
        document.getElementById("uploadCategory");

    const newCategoryInput =
        document.getElementById("upload-new-category") ||
        document.getElementById("new-category") ||
        document.getElementById("newCategory");

    const dropZone =
        document.getElementById("upload-dropzone") ||
        document.getElementById("drop-zone") ||
        document.getElementById("dropZone");

    const uploadBtn =
        document.getElementById("upload-btn") ||
        document.getElementById("uploadBtn");

    const fileInput =
        document.getElementById("hidden-file-input") ||
        document.getElementById("file-input") ||
        document.getElementById("fileInput");

    const statusBox =
        document.getElementById("upload-status") ||
        document.getElementById("uploadStatus");

    // If we can't even find the selects, bail early
    if (!fieldSelect || !categorySelect) {
        console.error("Upload fields not found in DOM. Check IDs in index.html.");
        return;
    }

    // -------------------------------
    // Allowed file types & size limit
    // -------------------------------
    const allowedTypes = [
        "application/pdf", // PDFs
        "image/jpeg",      // JPG/JPEG
        "image/png",       // PNG
        "application/msword", // .doc
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" // .docx
    ];

    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (tweak if you want)

    function validateFile(file) {
        if (!file) return false;

        if (!allowedTypes.includes(file.type)) {
            alert("Only PDF, Word documents, JPG, and PNG files are allowed.");
            return false;
        }

        if (file.size > MAX_FILE_SIZE) {
            alert("File is too large. Max allowed size is 25 MB.");
            return false;
        }

        return true;
    }

    let selectedFile = null;

    // -------------------------------
    // Load fields from S3
    // -------------------------------
    async function loadFields() {
        try {
            const url = `${BUCKET_URL}/?list-type=2&delimiter=/&prefix=uploadedfiles/`;
            const resp = await fetch(url);
            const xmlText = await resp.text();
            const xml = new DOMParser().parseFromString(xmlText, "application/xml");

            fieldSelect.innerHTML = "";

            const prefixes = [...xml.getElementsByTagName("Prefix")];
            prefixes.forEach(p => {
                const field = p.textContent.replace("uploadedfiles/", "").replace("/", "");
                if (field) {
                    const opt = document.createElement("option");
                    opt.value = field;
                    opt.textContent = field;
                    fieldSelect.appendChild(opt);
                }
            });

            // Once fields are loaded, load categories for the first one
            await loadCategories();
        } catch (err) {
            console.error("Error loading fields:", err);
        }
    }

    // -------------------------------
    // Load categories for selected field
    // -------------------------------
    async function loadCategories() {
        try {
            const field = fieldSelect.value;
            if (!field) return;

            const url = `${BUCKET_URL}/?list-type=2&delimiter=/&prefix=uploadedfiles/${encodeURIComponent(field)}/`;
            const resp = await fetch(url);
            const xmlText = await resp.text();
            const xml = new DOMParser().parseFromString(xmlText, "application/xml");

            categorySelect.innerHTML = "";

            const prefixes = [...xml.getElementsByTagName("Prefix")];
            prefixes.forEach(p => {
                const cat = p.textContent
                    .replace(`uploadedfiles/${field}/`, "")
                    .replace("/", "");
                if (cat) {
                    const opt = document.createElement("option");
                    opt.value = cat;
                    opt.textContent = cat;
                    categorySelect.appendChild(opt);
                }
            });
        } catch (err) {
            console.error("Error loading categories:", err);
        }
    }

    fieldSelect.addEventListener("change", loadCategories);

    // -------------------------------
    // Drag & drop handling
    // -------------------------------
    if (dropZone) {
        dropZone.addEventListener("dragover", e => {
            e.preventDefault();
            dropZone.classList.add("dragover");
        });

        dropZone.addEventListener("dragleave", () => {
            dropZone.classList.remove("dragover");
        });

        dropZone.addEventListener("drop", e => {
            e.preventDefault();
            dropZone.classList.remove("dragover");

            const file = e.dataTransfer.files[0];
            if (!validateFile(file)) return;

            selectedFile = file;
            dropZone.textContent = `Selected: ${file.name}`;
        });

        // Click to open file picker
        dropZone.addEventListener("click", () => {
            if (fileInput) fileInput.click();
        });
    }

    // -------------------------------
    // File picker change
    // -------------------------------
    if (fileInput) {
        fileInput.addEventListener("change", () => {
            const file = fileInput.files[0];
            if (!validateFile(file)) {
                fileInput.value = "";
                return;
            }
            selectedFile = file;
            if (dropZone) {
                dropZone.textContent = `Selected: ${file.name}`;
            }
        });
    }

    // -------------------------------
    // Upload button click
    // -------------------------------
    if (uploadBtn) {
        uploadBtn.addEventListener("click", async () => {
            try {
                if (!selectedFile) {
                    alert("Please select a file first (drag & drop or click the box).");
                    return;
                }

                if (statusBox) statusBox.textContent = "Uploading...";

                // Use new field/category if provided, otherwise the selected ones
                const field =
                    (newFieldInput && newFieldInput.value.trim()) ||
                    fieldSelect.value ||
                    "General";

                const category =
                    (newCategoryInput && newCategoryInput.value.trim()) ||
                    categorySelect.value ||
                    "Unsorted";

                const safeField = encodeURIComponent(field);
                const safeCat = encodeURIComponent(category);
                const safeName = encodeURIComponent(selectedFile.name);

                const key = `uploadedfiles/${safeField}/${safeCat}/${safeName}`;
                const uploadURL = `${BUCKET_URL}/${key}`;

                const resp = await fetch(uploadURL, {
                    method: "PUT",
                    headers: {
                        "Content-Type": selectedFile.type || "application/octet-stream"
                    },
                    body: selectedFile
                });

                if (resp.ok) {
                    if (statusBox) statusBox.textContent = "Upload complete!";

                    // Reset UI a bit
                    selectedFile = null;
                    if (dropZone) {
                        dropZone.textContent = "Drag & drop a file here or click to select";
                    }
                    if (fileInput) {
                        fileInput.value = "";
                    }
                    if (newFieldInput) newFieldInput.value = "";
                    if (newCategoryInput) newCategoryInput.value = "";

                    // Reload fields/categories to include any new ones
                    await loadFields();
                } else {
                    console.error("Upload failed:", resp.status, resp.statusText);
                    if (statusBox) statusBox.textContent = "Upload failed. See console for details.";
                }
            } catch (err) {
                console.error("Error during upload:", err);
                if (statusBox) statusBox.textContent = "Upload failed. See console for details.";
            }
        });
    }

    // Kick everything off
    loadFields();
});
