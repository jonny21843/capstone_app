// view.js

document.addEventListener("DOMContentLoaded", () => {
  const { BUCKET_URL, BASE_PREFIX, buildPrefix } = window.__S3_CONFIG__ || {};

  const fieldSelect = document.getElementById("viewField");
  const categorySelect = document.getElementById("viewCategory");
  const fileListContainer = document.getElementById("fileList");

  if (!fieldSelect || !categorySelect || !fileListContainer) return;

  async function listFiles(field, category) {
    if (!field || !category) {
      fileListContainer.innerHTML = "<p>Choose a field and category to see files.</p>";
      return;
    }

    fileListContainer.innerHTML = "<p>Loading files...</p>";

    const prefixPath = `${BASE_PREFIX}${field}/${category}/`;
    const prefix = buildPrefix(prefixPath);
    const url = `${BUCKET_URL}?list-type=2&prefix=${prefix}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error("Error listing files:", res.status, await res.text());
        fileListContainer.innerHTML = "<p>Error loading files.</p>";
        return;
      }

      const text = await res.text();
      const xml = new DOMParser().parseFromString(text, "application/xml");
      const keyEls = Array.from(xml.getElementsByTagName("Key"));

      const keys = keyEls
        .map((el) => el.textContent || "")
        .filter((k) => k && !k.endsWith("/")); // ignore folder placeholders

      if (keys.length === 0) {
        fileListContainer.innerHTML = "<p>No files found in this category.</p>";
        return;
      }

      const ul = document.createElement("ul");

      keys.forEach((key) => {
        const li = document.createElement("li");
        const link = document.createElement("a");

        // Display only the filename
        const filename = key.split("/").pop();

        // Build URL: BUCKET_URL/<encoded-key>
        const encodedKey = encodeURIComponent(key).replace(/%2F/g, "/");
        link.href = `${BUCKET_URL}/${encodedKey}`;
        link.textContent = filename;
        link.target = "_blank";
        link.rel = "noopener";

        li.appendChild(link);
        ul.appendChild(li);
      });

      fileListContainer.innerHTML = "";
      fileListContainer.appendChild(ul);
    } catch (err) {
      console.error("Error fetching file list:", err);
      fileListContainer.innerHTML = "<p>Error loading files.</p>";
    }
  }

  // When category changes, list files
  categorySelect.addEventListener("change", () => {
    const field = fieldSelect.value;
    const category = categorySelect.value;
    listFiles(field, category);
  });

  // If both are already selected (e.g., after reload), show files
  if (fieldSelect.value && categorySelect.value) {
    listFiles(fieldSelect.value, categorySelect.value);
  }
});
