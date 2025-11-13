console.log("VIEW.JS LOADED");

document.addEventListener("DOMContentLoaded", () => {

    const fieldSelect = document.getElementById("view-field");
    const categorySelect = document.getElementById("view-category");
    const fileList = document.getElementById("file-list");
    const searchBox = document.getElementById("search-box");

    loadFields();

    async function loadFields() {
        const response = await fetch(`${BUCKET_URL}?list-type=2&delimiter=/&prefix=uploadedfiles/`);
        const xml = new DOMParser().parseFromString(await response.text(), "application/xml");

        const prefixes = [...xml.getElementsByTagName("Prefix")];
        fieldSelect.innerHTML = "";

        prefixes.forEach(p => {
            let field = p.textContent.replace("uploadedfiles/", "").replace("/", "");
            if (field) {
                let opt = document.createElement("option");
                opt.value = field;
                opt.textContent = field;
                fieldSelect.appendChild(opt);
            }
        });

        loadCategories();
    }

    async function loadCategories() {
        const field = fieldSelect.value;
        categorySelect.innerHTML = "";

        const response = await fetch(`${BUCKET_URL}?list-type=2&delimiter=/&prefix=uploadedfiles/${field}/`);
        const xml = new DOMParser().parseFromString(await response.text(), "application/xml");

        const prefixes = [...xml.getElementsByTagName("Prefix")];

        prefixes.forEach(p => {
            let category = p.textContent.replace(`uploadedfiles/${field}/`, "").replace("/", "");
            if (category) {
                let opt = document.createElement("option");
                opt.value = category;
                opt.textContent = category;
                categorySelect.appendChild(opt);
            }
        });

        loadFiles();
    }

    async function loadFiles() {
        fileList.innerHTML = "";

        const search = searchBox.value.toLowerCase();

        // GLOBAL SEARCH MODE
        if (search.length > 0) {
            const allResponse = await fetch(`${BUCKET_URL}?list-type=2&prefix=uploadedfiles/`);
            const xml = new DOMParser().parseFromString(await allResponse.text(), "application/xml");
            const contents = [...xml.getElementsByTagName("Contents")];

            contents.forEach(c => {
                let key = c.getElementsByTagName("Key")[0].textContent;

                if (key.endsWith("/")) return;

                let name = key.split("/").pop();

                if (name.toLowerCase().includes(search)) {
                    let li = document.createElement("li");
                    li.innerHTML = `<a href="${BUCKET_URL}/${key}" target="_blank">${name}</a>`;
                    fileList.appendChild(li);
                }
            });

            return;
        }

        // Normal load
        const field = fieldSelect.value;
        const category = categorySelect.value;
        const response = await fetch(`${BUCKET_URL}?list-type=2&prefix=uploadedfiles/${field}/${category}/`);

        const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
        const contents = [...xml.getElementsByTagName("Contents")];

        contents.forEach(c => {
            let key = c.getElementsByTagName("Key")[0].textContent;

            if (key.endsWith("/")) return;

            let name = key.split("/").pop();

            let li = document.createElement("li");
            li.innerHTML = `<a href="${BUCKET_URL}/${key}" target="_blank">${name}</a>`;
            fileList.appendChild(li);
        });
    }

    fieldSelect.addEventListener("change", loadCategories);
    categorySelect.addEventListener("change", loadFiles);
    searchBox.addEventListener("input", loadFiles);
});
