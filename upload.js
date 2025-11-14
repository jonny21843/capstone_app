console.log("UPLOAD.JS ACTIVE");

const BUCKET_URL = window.BUCKET_URL;

document.addEventListener("DOMContentLoaded", () => {
    loadUploadFields();

    const dropZone = document.getElementById("drop-zone");
    const fileInput = document.getElementById("file-input");
    const uploadBtn = document.getElementById("upload-btn");

    dropZone.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        if (e.target.files.length > 0) {
            dropZone.textContent = "Selected: " + e.target.files[0].name;
        }
    };

    uploadBtn.onclick = uploadFile;
});

/* -------------------------------
   LOAD FIELDS FROM S3
-------------------------------- */
async function loadUploadFields() {
    try {
        const url = `${BUCKET_URL}/?list-type=2&prefix=uploadedfiles/&delimiter=/`;

        const xml = await fetch(url).then(r => r.text())
            .then(str => new DOMParser().parseFromString(str, "application/xml"));

        const prefixes = [...xml.getElementsByTagName("CommonPrefixes")];

        const fieldSelect = document.getElementById("upload-field");
        fieldSelect.innerHTML = "";

        prefixes.forEach(p => {
            let name = p.textContent.replace("uploadedfiles/", "").replace("/", "");
            if (name.length > 0) {
                let opt = document.createElement("option");
                opt.value = name;
                opt.textContent = name;
                fieldSelect.appendChild(opt);
            }
        });

        // Load categories when field changes
        fieldSelect.onchange = loadUploadCategories;

    } catch (e) {
        console.error("Error loading upload fields:", e);
    }
}

/* -------------------------------
   LOAD CATEGORIES
-------------------------------- */
async function loadUploadCategories() {
    const field = document.getElementById("upload-field").value;
    const categorySelect = document.getElementById("upload-category");

    if (!field) return;

    const url = `${BUCKET_URL}/?list-type=2&prefix=uploadedfiles/${field}/&delimiter=/`;

    const xml = await fetch(url).then(r => r.text())
        .then(str => new DOMParser().parseFromString(str, "application/xml"));

    const prefixes = [...xml.getElementsByTagName("CommonPrefixes")];

    categorySelect.innerHTML = "";

    prefixes.forEach(p => {
        let name = p.textContent.replace(`uploadedfiles/${field}/`, "").replace("/", "");
        if (name.length > 0) {
            let opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            categorySelect.appendChild(opt);
        }
    });
}

/* -------------------------------
   UPLOAD FILE
-------------------------------- */
async function uploadFile() {
    const field = document.getElementById("upload-field").value;
    const category = document.getElementById("upload-category").value;
    const file = document.getElementById("file-input").files[0];
    const status = document.getElementById("upload-status");

    if (!file || !field || !category) {
        status.textContent = "Missing field, category, or file.";
        return;
    }

    const key = `uploadedfiles/${field}/${category}/${file.name}`;

    const uploadUrl = `${BUCKET_URL}/${key}`;

    try {
        await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file
        });

        status.textContent = "Upload successful!";
    } catch (e) {
        console.error(e);
        status.textContent = "Upload failed.";
    }
}
