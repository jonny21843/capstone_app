const BUCKET_URL = "https://dev-feagans-capstone.s3.amazonaws.com";

// DOM elements
const uploadField = document.getElementById("upload-field");
const uploadCategory = document.getElementById("upload-category");
const newFieldInput = document.getElementById("new-field");
const newCategoryInput = document.getElementById("new-category");
const dropZone = document.getElementById("drop-zone");
const uploadBtn = document.getElementById("upload-btn");

const viewField = document.getElementById("view-field");
const viewCategory = document.getElementById("view-category");
const fileList = document.getElementById("file-list");
const searchBox = document.getElementById("search-box");

// Holds parsed S3 structure
let structure = {};

async function loadS3Structure() {
    const res = await fetch(`${BUCKET_URL}?list-type=2`);
    const text = await res.text();

    const xml = new DOMParser().parseFromString(text, "application/xml");
    const keys = [...xml.getElementsByTagName("Key")].map(k => k.textContent);

    structure = {};

    keys.forEach(key => {
        const parts = key.split("/");

        if (parts.length >= 3 && parts[0] === "uploadedfiles") {
            const field = parts[1];
            const category = parts[2];
            const file = parts.slice(3).join("/");

            if (!structure[field]) structure[field] = {};
            if (!structure[field][category]) structure[field][category] = [];

            if (file) structure[field][category].push({
                name: file,
                url: `${BUCKET_URL}/${key}`
            });
        }
    });

    populateFieldDropdowns();
}

function populateFieldDropdowns() {
    [uploadField, viewField].forEach(drop => {
        drop.innerHTML = `<option value="">-- Select Field --</option>`;
        Object.keys(structure).forEach(field => {
            drop.innerHTML += `<option value="${field}">${field}</option>`;
        });
    });

    uploadCategory.innerHTML = "";
    viewCategory.innerHTML = "";
}

uploadField.addEventListener("change", () => {
    loadCategories(uploadField.value, uploadCategory);
});

viewField.addEventListener("change", () => {
    loadCategories(viewField.value, viewCategory);
    loadFiles();
});

viewCategory.addEventListener("change", loadFiles);
searchBox.addEventListener("input", loadFiles);

function loadCategories(field, dropdown) {
    dropdown.innerHTML = `<option value="">-- Select Category --</option>`;

    if (structure[field]) {
        Object.keys(structure[field]).forEach(cat => {
            dropdown.innerHTML += `<option value="${cat}">${cat}</option>`;
        });
    }
}

function loadFiles() {
    const field = viewField.value;
    const category = viewCategory.value;
    const search = searchBox.value.toLowerCase();

    fileList.innerHTML = "";

    if (!field || !category) return;

    const files = structure[field][category] || [];

    files
        .filter(f => f.name.toLowerCase().includes(search))
        .forEach(f => {
            const li = document.createElement("li");
            li.innerHTML = `<a href="${f.url}" target="_blank">${f.name}</a>`;
            fileList.appendChild(li);
        });
}

// Upload Logic
dropZone.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = () => uploadFile(input.files[0]);
    input.click();
});

dropZone.addEventListener("dragover", e => {
    e.preventDefault();
    dropZone.classList.add("drag-hover");
});

dropZone.addEventListener("dragleave", () =>
    dropZone.classList.remove("drag-hover")
);

dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("drag-hover");
    uploadFile(e.dataTransfer.files[0]);
});

function uploadFile(file) {
    const field = newFieldInput.value || uploadField.value;
    const category = newCategoryInput.value || uploadCategory.value;

    if (!file || !field || !category) {
        alert("Please select a field and category.");
        return;
    }

    const key = `uploadedfiles/${field}/${category}/${file.name}`;

    fetch(`${BUCKET_URL}/${key}`, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file
    })
        .then(() => {
            alert("Upload successful!");
            loadS3Structure();
        })
        .catch(() => alert("Upload failed."));
}

// Start
loadS3Structure();
