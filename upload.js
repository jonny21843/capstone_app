console.log("UPLOAD.JS v3 LOADED");

// S3 bucket base URL comes from config.js
const BUCKET_URL = window.BUCKET_URL;

/* =======================================
   INIT
======================================= */

document.addEventListener("DOMContentLoaded", () => {
    initUploadUI();
});

function initUploadUI() {
    const dropZone = document.getElementById("drop-zone");
    const fileInput = document.getElementById("file-input");
    const uploadBtn = document.getElementById("upload-btn");

    // Drag & drop / click behavior
    dropZone.addEventListener("click", () => fileInput.click());

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            dropZone.textContent = "Selected: " + fileInput.files[0].name;
        }
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            dropZone.textContent = "Selected: " + fileInput.files[0].name;
        }
    });

    uploadBtn.addEventListener("click", uploadFile);

    // Load existing fields/categories from S3
    loadUploadFields();
}

/* =======================================
   LOAD FIELDS & CATEGORIES FROM S3
======================================= */

// Populate the "Choose Field" dropdown from S3 prefixes
async function loadUploadFields() {
    const fieldSelect = document.getElementById("upload-field");
    const categorySelect = document.getElementById("upload-category");

    fieldSelect.innerHTML = "";
    categorySelect.innerHTML = "";

    try {
        const url = `${BUCKET_URL}/?list-type=2&prefix=uploadedfiles/&delimiter=/`;
        const response = await fetch(url);

        if (!response.ok) {
            console.error("Failed to list fields. Status:", response.status);
            return;
        }

        const text = await response.text();
        const xml = new DOMParser().parseFromString(text, "application/xml");
        const prefixes = [...xml.getElementsByTagName("CommonPrefixes")];

        const fields = [];
        for (const p of prefixes) {
            const prefixNode = p.getElementsByTagName("Prefix")[0];
            if (!prefixNode) continue;
            const prefix = prefixNode.textContent; // e.g. uploadedfiles/Business/
            const parts = prefix.split("/");
            if (parts.length >= 2 && parts[1]) {
                fields.push(parts[1]);
            }
        }

        // Fill dropdown
        for (const f of fields) {
            const opt = document.createElement("option");
            opt.value = f;
            opt.textContent = f;
            fieldSelect.appendChild(opt);
        }

        // When field changes, load categories for that field
        fieldSelect.onchange = () => {
            const field = fieldSelect.value;
            if (field) {
                loadUploadCategories(field);
            } else {
                categorySelect.innerHTML = "";
            }
        };

        // Auto-load categories for the first field (if any)
        if (fields.length > 0) {
            loadUploadCategories(fields[0]);
        }

    } catch (err) {
        console.error("Error loading upload fields:", err);
    }
}

// Populate "Choose Category" for a given field
async function loadUploadCategories(field) {
    const categorySelect = document.getElementById("upload-category");
    categorySelect.innerHTML = "";

    try {
        const url = `${BUCKET_URL}/?list-type=2&prefix=uploadedfiles/${encodeURIComponent(field)}/&delimiter=/`;
        const response = await fetch(url);

        if (!response.ok) {
            console.error("Failed to list categories. Status:", response.status);
            return;
        }

        const text = await response.text();
        const xml = new DOMParser().parseFromString(text, "application/xml");
        const prefixes = [...xml.getElementsByTagName("CommonPrefixes")];

        const categories = [];
        for (const p of prefixes) {
            const prefixNode = p.getElementsByTagName("Prefix")[0];
            if (!prefixNode) continue;
            const prefix = prefixNode.textContent; // uploadedfiles/Field/Category/
            const parts = prefix.split("/");
            if (parts.length >= 3 && parts[2]) {
                categories.push(parts[2]);
            }
        }

        for (const c of categories) {
            const opt = document.createElement("option");
            opt.value = c;
            opt.textContent = c;
            categorySelect.appendChild(opt);
        }
    } catch (err) {
        console.error("Error loading upload categories:", err);
    }
}

/* =======================================
   UPLOAD FILE
======================================= */

async function uploadFile() {
    const fieldSelect = document.getElementById("upload-field");
    const categorySelect = document.getElementById("upload-category");
    const newFieldInput = document.getElementById("upload-new-field");
    const newCategoryInput = document.getElementById("upload-new-category");
    const fileInput = document.getElementById("file-input");
    const status = document.getElementById("upload-status");
    const dropZone = document.getElementById("drop-zone");

    status.textContent = "";

    const file = fileInput.files[0];

    // Prefer NEW field/category text boxes if filled; otherwise use dropdowns
    const newField = (newFieldInput.value || "").trim();
    const newCategory = (newCategoryInput.value || "").trim();

    const field = newField.length > 0
        ? newField
        : (fieldSelect.value || "").trim();

    const category = newCategory.length > 0
        ? newCategory
        : (categorySelect.value || "").trim();

    console.log("UPLOAD.JS v3 using field/category:", {
        newField,
        newCategory,
        finalField: field,
        finalCategory: category
    });

    if (!file || !field || !category) {
        status.textContent = "Please choose or create a field, a category, and a file.";
        return;
    }

    // Clean for S3 key (avoid slashes)
    const safeField = field.replace(/[/\\]/g, "_");
    const safeCategory = category.replace(/[/\\]/g, "_");
    const key = `uploadedfiles/${safeField}/${safeCategory}/${file.name}`;
    const uploadUrl = `${BUCKET_URL}/${key}`;

    console.log("Uploading to S3 key:", key);

    status.textContent = "Uploading...";

    try {
        const res = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Type": file.type || "application/octet-stream"
            },
            body: file
        });

        if (!res.ok) {
            throw new Error("S3 responded with status " + res.status);
        }

        status.textContent = "Upload successful!";

        // Clear inputs
        fileInput.value = "";
        newFieldInput.value = "";
        newCategoryInput.value = "";
        dropZone.textContent = "Drag & drop a file here or click to select";

        // Refresh dropdowns so the new field/category appear next time
        await loadUploadFields();

    } catch (err) {
        console.error(err);
        status.textContent = "Upload failed: " + err.message;
    }
}
