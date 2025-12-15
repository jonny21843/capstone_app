// upload.js - presign-only + progress + status icons
console.log("UPLOAD.JS (presign-only + progress) LOADED");

// Helper to fetch JSON
async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Request failed ${response.status} for ${url}`);
    }
    return response.json();
}

let selectedFile = null;

document.addEventListener("DOMContentLoaded", () => {
    initUploadUI();
});

function initUploadUI() {
    const dropZone = document.getElementById("drop-zone");
    const fileInput = document.getElementById("file-input");
    const uploadBtn = document.getElementById("upload-btn");

    if (!dropZone || !fileInput || !uploadBtn) {
        console.error("UPLOAD: Missing elements.");
        return;
    }

    dropZone.addEventListener("click", () => fileInput.click());

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
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            selectedFile = e.dataTransfer.files[0];
            dropZone.textContent = "Selected: " + selectedFile.name;
        }
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files && fileInput.files.length > 0) {
            selectedFile = fileInput.files[0];
            dropZone.textContent = "Selected: " + selectedFile.name;
        }
    });

    uploadBtn.addEventListener("click", uploadFile);

    loadUploadFields().catch(err => console.error("UPLOAD: load fields error", err));
}

// -------- list fields/categories via API --------

async function loadUploadFields() {
    const fieldSelect = document.getElementById("upload-field");
    const categorySelect = document.getElementById("upload-category");

    fieldSelect.innerHTML = '<option value="">-- Select Field --</option>';
    categorySelect.innerHTML = '<option value="">-- Select Category --</option>';

    const data = await fetchJson("/api/list-fields");
    const fields = data.fields || [];

    for (const f of fields) {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        fieldSelect.appendChild(opt);
    }

    fieldSelect.onchange = () => {
        const field = fieldSelect.value;
        if (field) {
            loadUploadCategories(field).catch(err =>
                console.error("UPLOAD: load cats", err)
            );
        } else {
            categorySelect.innerHTML =
                '<option value="">-- Select Category --</option>';
        }
    };

    if (fields.length > 0) {
        await loadUploadCategories(fields[0]);
    }
}

async function loadUploadCategories(field) {
    const categorySelect = document.getElementById("upload-category");
    categorySelect.innerHTML = '<option value="">-- Select Category --</option>';

    const encodedField = encodeURIComponent(field);
    const data = await fetchJson(`/api/list-categories?field=${encodedField}`);
    const categories = data.categories || [];

    for (const c of categories) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        categorySelect.appendChild(opt);
    }
}

// -------- helper: upload with progress (XHR) --------

function uploadWithProgress(url, file, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url, true);
        xhr.setRequestHeader(
            "Content-Type",
            file.type || "application/octet-stream"
        );

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && typeof onProgress === "function") {
                const percent = Math.round((event.loaded / event.total) * 100);
                onProgress(percent);
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                onProgress(100);
                resolve();
            } else {
                reject(
                    new Error(
                        "Upload failed with status " + xhr.status + " " + xhr.statusText
                    )
                );
            }
        };

        xhr.onerror = () => {
            reject(new Error("Network error during upload"));
        };

        xhr.send(file);
    });
}

// -------- helpers: status & progress UI --------

function resetStatusUI() {
    const status = document.getElementById("upload-status");
    const icon = document.getElementById("upload-status-icon");
    const bar = document.getElementById("upload-progress-bar");

    if (status) status.textContent = "";
    if (icon) {
        icon.classList.remove("success", "error");
        icon.textContent = "";
    }
    if (bar) {
        bar.style.width = "0%";
    }
}

function setStatus(text, type) {
    const status = document.getElementById("upload-status");
    const icon = document.getElementById("upload-status-icon");

    if (status) status.textContent = text || "";

    if (icon) {
        icon.classList.remove("success", "error");
        if (type === "success") {
            icon.classList.add("success");
            icon.textContent = "✓";
        } else if (type === "error") {
            icon.classList.add("error");
            icon.textContent = "✕";
        } else {
            icon.textContent = "";
        }
    }
}

function setProgress(percent) {
    const bar = document.getElementById("upload-progress-bar");
    if (bar) {
        bar.style.width = `${Math.min(Math.max(percent, 0), 100)}%`;
    }
}

// -------- upload via presigned URL only --------

async function uploadFile() {
    const fieldSelect = document.getElementById("upload-field");
    const categorySelect = document.getElementById("upload-category");
    const newFieldInput = document.getElementById("upload-new-field");
    const newCategoryInput = document.getElementById("upload-new-category");
    const fileInput = document.getElementById("file-input");
    const dropZone = document.getElementById("drop-zone");

    resetStatusUI();

    const fileFromInput = fileInput.files && fileInput.files[0];
    const file = fileFromInput || selectedFile;

    const newField = (newFieldInput.value || "").trim();
    const newCategory = (newCategoryInput.value || "").trim();

    const field = newField || (fieldSelect.value || "").trim();
    const category = newCategory || (categorySelect.value || "").trim();

    if (!file) {
        setStatus("Please choose a file to upload.", "error");
        return;
    }
    if (!field || !category) {
        setStatus("Please choose or create a field and a category.", "error");
        return;
    }

    try {
        setStatus("Requesting upload URL...", null);

        const presign = await fetchJson("/api/presign-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field,
                category,
                filename: file.name,
                contentType: file.type || "application/octet-stream"
            })
        });

        const uploadUrl = presign.uploadUrl || presign.url;
        if (!uploadUrl) {
            throw new Error("Backend did not return uploadUrl/url.");
        }

        setStatus("Uploading...", null);
        setProgress(0);

        await uploadWithProgress(uploadUrl, file, (p) => {
            setProgress(p);
        });

        setStatus("Upload successful!", "success");

        // Clear inputs & reload dropdowns
        fileInput.value = "";
        selectedFile = null;
        newFieldInput.value = "";
        newCategoryInput.value = "";
        if (dropZone) {
            dropZone.textContent =
                "Drag & drop a file here or click to select";
        }

        await loadUploadFields();

    } catch (err) {
        console.error("UPLOAD: upload failed", err);
        setStatus("Upload failed: " + err.message, "error");
    }
}
