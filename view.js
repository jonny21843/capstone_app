// view.js - presign-only + global/field/category search
console.log("VIEW.JS (presign-only + global search) LOADED");

// -----------------------
// Global state
// -----------------------
let currentField = "";
let currentCategory = "";
let currentFiles = []; // normalized: [{ name, size, lastModified }]

// Search indexes
let fieldIndexCache = {};    // field -> [{ field, category, name }]
let globalIndex = [];        // [{ field, category, name }]
let globalIndexPromise = null;

// Helper to fetch JSON
async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Request failed ${response.status} for ${url}`);
    }
    return response.json();
}

// -----------------------
// Load Fields from API
// -----------------------
async function loadFields() {
    console.log("VIEW: Loading fields via /api/list-fields");
    const data = await fetchJson("/api/list-fields");
    const fields = data.fields || [];

    const fieldSelect = document.getElementById("view-field");
    if (!fieldSelect) {
        console.error("VIEW: #view-field not found");
        return;
    }

    fieldSelect.innerHTML = '<option value="">-- Select Field --</option>';

    fields.forEach(field => {
        const opt = document.createElement("option");
        opt.value = field;
        opt.textContent = field;
        fieldSelect.appendChild(opt);
    });

    currentField = "";
    currentCategory = "";
    currentFiles = [];
    renderFileList([]);
    updateBreadcrumb();
}

// -----------------------
// Load Categories from API
// -----------------------
async function loadCategories(field) {
    console.log("VIEW: Loading categories for field:", field);
    currentField = field;
    currentCategory = "";
    currentFiles = [];
    updateBreadcrumb();

    const encodedField = encodeURIComponent(field);
    const data = await fetchJson(`/api/list-categories?field=${encodedField}`);
    const categories = data.categories || [];

    const categorySelect = document.getElementById("view-category");
    if (!categorySelect) {
        console.error("VIEW: #view-category not found");
        return;
    }

    categorySelect.innerHTML = '<option value="">-- Select Category --</option>';

    categories.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        categorySelect.appendChild(opt);
    });

    renderFileList([]);
}

// -----------------------
// Load Files from API for current field/category
// -----------------------
async function loadFiles(field, category) {
    console.log("VIEW: Loading files for:", field, "/", category);
    currentField = field;
    currentCategory = category;
    updateBreadcrumb();

    const encodedField = encodeURIComponent(field);
    const encodedCategory = encodeURIComponent(category);

    const data = await fetchJson(
        `/api/list-files?field=${encodedField}&category=${encodedCategory}`
    );

    const rawFiles = data.files || [];
    // Normalize files so we always have .name
    currentFiles = rawFiles.map(f => ({
        name: f.name || f.filename || "",
        size: f.size ?? f.Size ?? null,
        lastModified: f.lastModified || f.LastModified || null
    }));

    console.log("VIEW: Files loaded (normalized):", currentFiles);
    renderFileList(currentFiles);
}

// -----------------------
// Build search index for a single field
// -----------------------
async function buildFieldIndex(field) {
    if (fieldIndexCache[field]) {
        return fieldIndexCache[field];
    }

    console.log("VIEW: Building field index for:", field);
    const encodedField = encodeURIComponent(field);
    const catsData = await fetchJson(`/api/list-categories?field=${encodedField}`);
    const categories = catsData.categories || [];

    let list = [];

    for (const category of categories) {
        const encodedCategory = encodeURIComponent(category);
        const filesData = await fetchJson(
            `/api/list-files?field=${encodedField}&category=${encodedCategory}`
        );
        const files = filesData.files || [];
        files.forEach(f => {
            const name = f.name || f.filename || "";
            if (!name) return;
            list.push({ field, category, name });
        });
    }

    fieldIndexCache[field] = list;
    console.log("VIEW: Field index built for", field, "items:", list.length);
    return list;
}

// -----------------------
// Build global search index (all fields/categories)
// -----------------------
async function buildGlobalIndex() {
    if (globalIndexPromise) {
        return globalIndexPromise;
    }

    globalIndexPromise = (async () => {
        console.log("VIEW: Building global search index...");
        const data = await fetchJson("/api/list-fields");
        const fields = data.fields || [];
        let all = [];

        for (const field of fields) {
            const list = await buildFieldIndex(field);
            all = all.concat(list);
        }

        globalIndex = all;
        console.log("VIEW: Global index built, total items:", all.length);
        return all;
    })();

    return globalIndexPromise;
}

// -----------------------
// Render file list (current category context)
// -----------------------
function renderFileList(files) {
    const list = document.getElementById("file-list");
    if (!list) {
        console.error("VIEW: #file-list not found");
        return;
    }

    list.innerHTML = "";

    if (!files || files.length === 0) {
        const li = document.createElement("li");
        li.textContent = "No files found.";
        list.appendChild(li);
        return;
    }

    files.forEach(file => {
        const filename = file.name || file.filename || "";
        const li = document.createElement("li");
        const a = document.createElement("a");

        a.href = "#";
        a.textContent = filename;
        a.addEventListener("click", function (e) {
            e.preventDefault();
            downloadFile(currentField, currentCategory, filename);
        });

        li.appendChild(a);
        list.appendChild(li);
    });
}

// -----------------------
// Render search results (global/field-wide)
// -----------------------
function renderSearchResults(results) {
    const list = document.getElementById("file-list");
    if (!list) {
        console.error("VIEW: #file-list not found");
        return;
    }

    list.innerHTML = "";

    if (!results || results.length === 0) {
        const li = document.createElement("li");
        li.textContent = "No files found.";
        list.appendChild(li);
        return;
    }

    results.forEach(item => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        const filename = item.name;
        const label = `${filename}  (${item.field} / ${item.category})`;

        a.href = "#";
        a.textContent = label;
        a.addEventListener("click", function (e) {
            e.preventDefault();
            // Download from that file's real location
            downloadFile(item.field, item.category, filename);
        });

        li.appendChild(a);
        list.appendChild(li);
    });
}

// -----------------------
// Breadcrumb helper (clickable)
// -----------------------
function updateBreadcrumb() {
    const breadcrumb = document.getElementById("breadcrumb");
    if (!breadcrumb) return;

    const fieldSelect = document.getElementById("view-field");
    const categorySelect = document.getElementById("view-category");
    const searchBox = document.getElementById("search-box");

    // Helper to add one crumb with optional click handler
    function addCrumb(label, onClick) {
        if (breadcrumb.childNodes.length > 0) {
            const sep = document.createElement("span");
            sep.textContent = " / ";
            breadcrumb.appendChild(sep);
        }

        const el = document.createElement(onClick ? "button" : "span");
        el.textContent = label;

        if (onClick) {
            el.type = "button";
            el.className = "crumb-link";
            el.addEventListener("click", (e) => {
                e.preventDefault();
                // Reset search whenever navigating via breadcrumb
                if (searchBox) {
                    searchBox.value = "";
                }
                onClick();
            });
        } else {
            el.className = "crumb-text";
        }

        breadcrumb.appendChild(el);
    }

    // Clear existing content
    breadcrumb.innerHTML = "";

    // Home crumb
    addCrumb("Home", () => {
        currentField = "";
        currentCategory = "";
        currentFiles = [];
        if (fieldSelect) fieldSelect.value = "";
        if (categorySelect) {
            categorySelect.innerHTML =
                '<option value="">-- Select Category --</option>';
        }
        renderFileList([]);
        updateBreadcrumb();
    });

    // Field crumb
    if (currentField) {
        addCrumb(currentField, () => {
            if (fieldSelect) fieldSelect.value = currentField;
            if (categorySelect) {
                categorySelect.value = "";
            }
            currentCategory = "";
            currentFiles = [];
            loadCategories(currentField).catch(err => {
                console.error("VIEW: Error loading categories from breadcrumb:", err);
                alert("Could not load categories.");
            });
        });
    }

    // Category crumb
    if (currentCategory) {
        addCrumb(currentCategory, () => {
            const field = currentField;
            const category = currentCategory;
            if (!field || !category) return;
            if (fieldSelect) fieldSelect.value = field;
            if (categorySelect) categorySelect.value = category;
            loadFiles(field, category).catch(err => {
                console.error("VIEW: Error loading files from breadcrumb:", err);
                alert("Could not load files.");
            });
        });
    }
}


// -----------------------
// Download via /api/presign-download ONLY
// -----------------------
async function downloadFile(field, category, filename) {
    try {
        console.log("VIEW: Requesting presigned URL for:", field, category, filename);

        const data = await fetchJson("/api/presign-download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field, category, filename })
        });

        console.log("VIEW: /api/presign-download response:", data);

        const url = data.downloadUrl || data.url;
        if (!url) {
            alert("Invalid response from server (no download URL).");
            return;
        }

        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (err) {
        console.error("VIEW: Download error:", err);
        alert("Could not start download.");
    }
}

// -----------------------
// Handle search (Option D logic)
// -----------------------
function handleSearch(query, fieldSelect, categorySelect) {
    const q = query.trim().toLowerCase();
    console.log("VIEW: Search query:", q);

    const field = fieldSelect.value;
    const category = categorySelect.value;

    if (!q) {
        console.log("VIEW: Search empty, restoring regular list");
        // If in a category, show that category's files; otherwise show nothing / "No files found"
        renderFileList(currentFiles);
        return;
    }

    // Case 1: field + category selected → search only currentFiles
    if (field && category) {
        const filtered = currentFiles.filter(f => {
            const name = (f.name || "").toLowerCase();
            return name.includes(q);
        });
        console.log("VIEW: Category search results count:", filtered.length);
        renderFileList(filtered);
        return;
    }

    // Case 2: field selected, category NOT selected → search across all categories in that field
    if (field && !category) {
        (async () => {
            try {
                const index = await buildFieldIndex(field);
                const filtered = index.filter(item =>
                    item.name.toLowerCase().includes(q)
                );
                console.log("VIEW: Field-wide search results count:", filtered.length);
                renderSearchResults(filtered);
            } catch (err) {
                console.error("VIEW: Field-wide search error:", err);
                alert("Error searching within field.");
            }
        })();
        return;
    }

    // Case 3: no field selected → global search
    (async () => {
        try {
            const index = await buildGlobalIndex();
            const filtered = index.filter(item =>
                item.name.toLowerCase().includes(q)
            );
            console.log("VIEW: Global search results count:", filtered.length);
            renderSearchResults(filtered);
        } catch (err) {
            console.error("VIEW: Global search error:", err);
            alert("Error performing global search.");
        }
    })();
}

// -----------------------
// Initialize
// -----------------------
function initView() {
    console.log("VIEW: initView starting");

    const searchBox = document.getElementById("search-box");
    const fieldSelect = document.getElementById("view-field");
    const categorySelect = document.getElementById("view-category");
    const fileList = document.getElementById("file-list");
    const breadcrumb = document.getElementById("breadcrumb");

    if (!searchBox || !fieldSelect || !categorySelect || !fileList || !breadcrumb) {
        console.error("VIEW: Missing one or more DOM elements", {
            searchBox: !!searchBox,
            fieldSelect: !!fieldSelect,
            categorySelect: !!categorySelect,
            fileList: !!fileList,
            breadcrumb: !!breadcrumb
        });
        return;
    }

    // Search filter (Option D behavior)
    searchBox.addEventListener("input", function () {
        handleSearch(this.value, fieldSelect, categorySelect);
    });

// Field change
fieldSelect.addEventListener("change", function () {
    const field = this.value;

    // 🔹 Reset search whenever field changes
    searchBox.value = "";
    console.log("VIEW: Field changed, clearing search and regular list");

    if (field) {
        loadCategories(field).catch(err => {
            console.error("VIEW: Error loading categories:", err);
            alert("Could not load categories.");
        });
    } else {
        currentField = "";
        currentCategory = "";
        currentFiles = [];
        categorySelect.innerHTML =
            '<option value="">-- Select Category --</option>';
        renderFileList([]);
        updateBreadcrumb();
    }
});

// Category change
categorySelect.addEventListener("change", function () {
    const field = fieldSelect.value;
    const category = this.value;

    // 🔹 Reset search whenever category changes
    searchBox.value = "";
    console.log("VIEW: Category changed, clearing search and showing full category list");

    if (field && category) {
        loadFiles(field, category).catch(err => {
            console.error("VIEW: Error loading files:", err);
            alert("Could not load files.");
        });
    } else {
        currentCategory = "";
        currentFiles = [];
        renderFileList([]);
        updateBreadcrumb();
    }
});

    // Initial load
    loadFields().catch(err => {
        console.error("VIEW: Error initializing fields:", err);
        alert("Could not load fields.");
    });
}

document.addEventListener("DOMContentLoaded", initView);
