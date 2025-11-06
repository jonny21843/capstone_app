document.addEventListener("DOMContentLoaded", () => {
  // Use the website endpoint for viewing files
  const WEBSITE_BASE = "https://dev-feagans-capstone.s3.amazonaws.com";
  // Use REST endpoint for listing files as XML
  const REST_BASE = "https://dev-feagans-capstone.s3.amazonaws.com";

  const categorySelect = document.getElementById("viewCategory");
  const fileList = document.getElementById("fileList");

  // Load available categories from S3 (folders under uploadedfiles/)
  async function loadCategories() {
    const url = `${REST_BASE}?list-type=2&prefix=uploadedfiles/&delimiter=/`;
    const response = await fetch(url);
    const xmlText = await response.text();
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");

    const prefixes = Array.from(xml.getElementsByTagName("CommonPrefixes"))
      .map(el => el.getElementsByTagName("Prefix")[0]?.textContent || "")
      .filter(p => p.startsWith("uploadedfiles/") && p !== "uploadedfiles/");

    categorySelect.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "-- Select a category --";
    categorySelect.appendChild(defaultOption);

    prefixes.forEach(p => {
      const name = p.replace(/^uploadedfiles\//, "").replace(/\/$/, "");
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      categorySelect.appendChild(opt);
    });
  }

  // Render files when a category is chosen
  async function renderCategory(category) {
    if (!category) {
      fileList.innerHTML = "Choose a category to see files.";
      return;
    }

    fileList.innerHTML = "Loading...";

    const prefix = `uploadedfiles/${category}/`;
    const url = `${REST_BASE}?list-type=2&prefix=${encodeURIComponent(prefix)}`;
    const response = await fetch(url);
    const xmlText = await response.text();
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");

    const keys = Array.from(xml.getElementsByTagName("Key"))
      .map(el => el.textContent)
      .filter(k => k && k !== prefix);

    if (keys.length === 0) {
      fileList.innerHTML = "No files found in this category.";
      return;
    }

    const ul = document.createElement("ul");
    keys.forEach(rawKey => {
      const encodedKey = rawKey.split("/").map(encodeURIComponent).join("/");
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `${WEBSITE_BASE}/${encodedKey}`;
      a.textContent = rawKey.split("/").pop();
      a.target = "_blank";
      li.appendChild(a);
      ul.appendChild(li);
    });

    fileList.innerHTML = "";
    fileList.appendChild(ul);
  }

  // Hook up event listener
  categorySelect.addEventListener("change", () => renderCategory(categorySelect.value));

  // Initialize
  loadCategories();
});
