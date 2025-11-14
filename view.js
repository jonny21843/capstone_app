console.log("VIEW.JS LOADED");

// -----------------------
// Load Fields from S3
// -----------------------
async function listFields() {
    const url = `${window.BUCKET_URL}/?list-type=2&delimiter=/&prefix=uploadedfiles/`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Cannot list fields");

    const text = await response.text();
    const xml = new window.DOMParser().parseFromString(text, "text/xml");

    const prefixes = [...xml.getElementsByTagName("CommonPrefixes")];
    return prefixes.map(p =>
        p.getElementsByTagName("Prefix")[0].textContent.replace("uploadedfiles/", "").replace("/", "")
    );
}

// -----------------------
// Load Categories for a Field
// -----------------------
async function listCategories(field) {
    const prefix = `uploadedfiles/${field}/`;
    const url = `${window.BUCKET_URL}/?list-type=2&delimiter=/&prefix=${prefix}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Cannot list categories");

    const text = await response.text();
    const xml = new window.DOMParser().parseFromString(text, "text/xml");

    const prefixes = [...xml.getElementsByTagName("CommonPrefixes")];
    return prefixes.map(p =>
        p.getElementsByTagName("Prefix")[0].textContent.replace(prefix, "").replace("/", "")
    );
}

// -----------------------
// Load Files Within Category
// -----------------------
async function listFiles(field, category) {
    const prefix = `uploadedfiles/${field}/${category}/`;
    const url = `${window.BUCKET_URL}/?list-type=2&prefix=${prefix}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Cannot list files");

    const text = await response.text();
    const xml = new window.DOMParser().parseFromString(text, "text/xml");

    const contents = [...xml.getElementsByTagName("Contents")];

    return contents
        .filter(c => !c.getElementsByTagName("Key")[0].textContent.endsWith("/"))
        .map(c => c.getElementsByTagName("Key")[0].textContent.replace(prefix, ""));
}

// -----------------------
// Update Breadcrumb
// -----------------------
function updateBreadcrumb(field, category) {
    const breadcrumb = document.getElementById("breadcrumb");
    breadcrumb.innerHTML = `
        <a href="#" id="crumb-home">Home</a> /
        <a href="#" id="crumb-field">${field}</a> /
        <span>${category}</span>
    `;

    document.getElementById("crumb-home").onclick = () => init();
    document.getElementById("crumb-field").onclick = () => {
        document.getElementById("view-field").value = field;
        loadCategories(field);
    };
}

// -----------------------
// Display Files
// -----------------------
async function loadFiles(field, category) {
    updateBreadcrumb(field, category);

    const fileList = document.getElementById("file-list");
    fileList.innerHTML = `<li>Loading...</li>`;

    const files = await listFiles(field, category);

    fileList.innerHTML = files
        .map(file => {
            const link = `${window.BUCKET_URL}/uploadedfiles/${field}/${category}/${file}`;
            return `<li><a href="${link}" target="_blank">${file}</a></li>`;
        })
        .join("");
}

// -----------------------
// Load Categories (UI update)
// -----------------------
async function loadCategories(field) {
    const categorySelect = document.getElementById("view-category");
    categorySelect.innerHTML = `<option value="">-- Select Category --</option>`;

    const categories = await listCategories(field);

    categories.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        categorySelect.appendChild(opt);
    });

    document.getElementById("file-list").innerHTML = "";
}

// -----------------------
// GLOBAL SEARCH (works anywhere)
// -----------------------
document.getElementById("search-box").addEventListener("input", async function () {
    const query = this.value.trim().toLowerCase();
    const fileList = document.getElementById("file-list");

    if (query.length < 2) {
        fileList.innerHTML = "";
        return;
    }

    let resultsHTML = "<li><strong>Searching...</strong></li>";
    fileList.innerHTML = resultsHTML;

    const fields = await listFields();
    let results = [];

    for (const field of fields) {
        const categories = await listCategories(field);

        for (const cat of categories) {
            const files = await listFiles(field, cat);

            files.forEach(file => {
                if (file.toLowerCase().includes(query)) {
                    const link = `${window.BUCKET_URL}/uploadedfiles/${field}/${cat}/${file}`;
                    results.push(`<li><a href="${link}" target="_blank">${file}</a> <em>(${field} / ${cat})</em></li>`);
                }
            });
        }
    }

    fileList.innerHTML = results.length ? results.join("") : "<li>No results found.</li>";
});

// -----------------------
// INIT
// -----------------------
async function init() {
    const fieldSelect = document.getElementById("view-field");
    const categorySelect = document.getElementById("view-category");

    fieldSelect.innerHTML = `<option value="">-- Select Field --</option>`;
    categorySelect.innerHTML = `<option value="">-- Select Category --</option>`;
    document.getElementById("file-list").innerHTML = "";
    document.getElementById("breadcrumb").innerHTML = "";

    const fields = await listFields();

    fields.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        fieldSelect.appendChild(opt);
    });
}

// Field changed
document.getElementById("view-field").addEventListener("change", function () {
    const field = this.value;
    if (field) loadCategories(field);
});

// Category changed
document.getElementById("view-category").addEventListener("change", function () {
    const field = document.getElementById("view-field").value;
    const category = this.value;
    if (field && category) loadFiles(field, category);
});

init();
