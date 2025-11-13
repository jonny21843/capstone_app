console.log("UPLOAD.JS ACTIVE");

document.addEventListener("DOMContentLoaded", () => {

    // DOM elements
    const fieldSelect = document.getElementById("upload-field");
    const newFieldInput = document.getElementById("new-field");
    const categorySelect = document.getElementById("upload-category");
    const newCategoryInput = document.getElementById("new-category");

    const dropZone = document.getElementById("drop-zone");
    const fileInput = document.getElementById("file-input");
    const uploadBtn = document.getElementById("upload-btn");
    const statusBox = document.getElementById("upload-status");

    // Load fields on start
    loadFields();

    // -------- LOAD FIELDS ----------
    async function loadFields() {
        const res = await fetch(`${BUCKET_URL}?list-type=2&delimiter=/&prefix=uploadedfiles/`);
        const xml = new DOMParser().parseFromString(await res.text(), "application/xml");

        const prefixes = [...xml.getElementsByTagName("Prefix")];
        fieldSelect.innerHTML = "";

        prefixes.forEach(p => {
            let field = p.textContent.replace("uploadedfiles/", "").replace("/", "");
            if (!field) return;

            const opt = document.createElement("option");
            opt.value = field;
            opt.textContent = field;
            fieldSelect.appendChild(opt);
        });

        loadCategories();
    }

    // -------- LOAD CATEGORIES ----------
    async function loadCategories() {
        const field = fieldSelect.value;
        if (!field) return;

        const res = await fetch(`${BUCKET_URL}?list-type=2&delimiter=/&prefix=uploadedfiles/${field}/`);
        const xml = new DOMParser().parseFromString(await res.text(), "application/xml");

        const prefixes = [...xml.getElementsByTagName("Prefix")];
        categorySelect.innerHTML = "";

        prefixes.forEach(p => {
            let category = p.textContent.replace(`uploadedfiles/${field}/`, "").replace("/", "");
            if (!category) return;

            const opt = document.createElement("option");
            opt.value = category;
            opt.textContent = category;
            categorySelect.appendChild(opt);
        });
    }

    // Refresh categories when field changes
    fieldSelect.addEventListener("change", loadCategories);

    // -------- DRAG & DROP ----------
    dropZone.addEventListener("click", () => fileInput.click());

    dropZone.addEventListener("dragover", e => {
        e.preventDefault();
        dropZone.classList.add("drag-active");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-active");
    });

    dropZone.addEventListener("drop", e => {
        e.preventDefault();
        dropZone.classList.remove("drag-active");
        fileInput.files = e.dataTransfer.files;
        statusBox.textContent = `${fileInput.files[0].name} ready to upload`;
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length)
            statusBox.textContent = `${fileInput.files[0].name} ready to upload`;
    });

    // -------- PERFORM UPLOAD ----------
    uploadBtn.addEventListener("click", async () => {

        if (!fileInput.files.length) {
            statusBox.textContent = "❌ Please choose a file first";
            return;
        }

        let field = newFieldInput.value || fieldSelect.value;
        let category = newCategoryInput.value || categorySelect.value;

        if (!field || !category) {
            statusBox.textContent = "❌ Field and Category are required";
            return;
        }

        const file = fileInput.files[0];
        const s3Key = `uploadedfiles/${field}/${category}/${file.name}`;

        statusBox.textContent = "Uploading...";

        try {
            const uploadRes = await fetch(`${BUCKET_URL}/${s3Key}`, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type }
            });

            if (uploadRes.ok) {
                statusBox.textContent = "✅ Upload complete!";
                fileInput.value = "";
            } else {
                statusBox.textContent = "❌ Upload failed";
            }

        } catch (err) {
            console.error(err);
            statusBox.textContent = "❌ Upload error";
        }
    });

});
