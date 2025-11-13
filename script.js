// script.js

// --- S3 config ---
const BUCKET_URL = "https://dev-feagans-capstone.s3.amazonaws.com";
const BASE_PREFIX = "uploadedfiles/";

// Utility: build a URL-safe prefix string (keeps /, encodes spaces etc.)
function buildPrefix(path) {
  // path like "uploadedfiles/IT/" or "uploadedfiles/IT/Linux Notes/"
  return encodeURIComponent(path).replace(/%2F/g, "/");
}

// --- Tab switching ---
function showTab(tabId) {
  const tabs = document.querySelectorAll(".tab-content");
  tabs.forEach((tab) => tab.classList.remove("active"));

  const target = document.getElementById(tabId);
  if (target) target.classList.add("active");

  const navButtons = document.querySelectorAll(".nav-btn");
  navButtons.forEach((btn) => btn.classList.remove("active-tab"));
  const activeBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  if (activeBtn) activeBtn.classList.add("active-tab");
}

// Make showTab available globally
window.showTab = showTab;

// --- S3 listing helpers ---
async function listFieldsFromS3() {
  const prefix = buildPrefix(BASE_PREFIX);
  const url = `${BUCKET_URL}?list-type=2&prefix=${prefix}&delimiter=/`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error("Error listing fields:", res.status, await res.text());
    throw new Error("Failed to list fields");
  }

  const text = await res.text();
  const xml = new DOMParser().parseFromString(text, "application/xml");

  const prefixes = Array.from(xml.getElementsByTagName("CommonPrefixes"));
  const fields = prefixes
    .map((cp) => cp.getElementsByTagName("Prefix")[0]?.textContent || "")
    .map((p) => p.replace(BASE_PREFIX, "").replace(/\/$/, ""))
    .filter((name) => name); // remove empty

  return fields;
}

async function listCategoriesForField(fieldName) {
  if (!fieldName) return [];

  const prefixPath = `${BASE_PREFIX}${fieldName}/`;
  const prefix = buildPrefix(prefixPath);
  const url = `${BUCKET_URL}?list-type=2&prefix=${prefix}&delimiter=/`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error("Error listing categories:", res.status, await res.text());
    throw new Error("Failed to list categories");
  }

  const text = await res.text();
  const xml = new DOMParser().parseFromString(text, "application/xml");

  const prefixes = Array.from(xml.getElementsByTagName("CommonPrefixes"));
  const categories = prefixes
    .map((cp) => cp.getElementsByTagName("Prefix")[0]?.textContent || "")
    .map((p) =>
      p
        .replace(`${BASE_PREFIX}${fieldName}/`, "")
        .replace(/\/$/, "")
    )
    .filter((name) => name);

  return categories;
}

// Populate <select> options helper
function fillSelect(selectEl, items, placeholderText) {
  if (!selectEl) return;
  selectEl.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = placeholderText;
  selectEl.appendChild(placeholder);

  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    selectEl.appendChild(opt);
  });
}

// --- Initial load ---
document.addEventListener("DOMContentLoaded", async () => {
  const uploadFieldSelect = document.getElementById("uploadField");
  const viewFieldSelect = document.getElementById("viewField");

  try {
    const fields = await listFieldsFromS3();

    fillSelect(uploadFieldSelect, fields, "-- Select a field --");
    fillSelect(viewFieldSelect, fields, "-- Select a field --");
  } catch (err) {
    console.error(err);
  }

  // When field changes on UPLOAD tab, load categories
  uploadFieldSelect?.addEventListener("change", async () => {
    const field = uploadFieldSelect.value;
    const categorySelect = document.getElementById("uploadCategory");
    if (!field) {
      fillSelect(categorySelect, [], "-- Select category --");
      return;
    }
    try {
      const cats = await listCategoriesForField(field);
      fillSelect(categorySelect, cats, "-- Select category --");
    } catch (e) {
      console.error(e);
    }
  });

  // When field changes on VIEW tab, load categories
  viewFieldSelect?.addEventListener("change", async () => {
    const field = viewFieldSelect.value;
    const categorySelect = document.getElementById("viewCategory");
    const fileList = document.getElementById("fileList");
    if (fileList) fileList.innerHTML = "<p>Choose a category to see files.</p>";

    if (!field) {
      fillSelect(categorySelect, [], "-- Select a category --");
      return;
    }
    try {
      const cats = await listCategoriesForField(field);
      fillSelect(categorySelect, cats, "-- Select a category --");
    } catch (e) {
      console.error(e);
    }
  });

  // Default tab
  showTab("uploadTab");
});

// Expose S3 helpers to other scripts
window.__S3_CONFIG__ = {
  BUCKET_URL,
  BASE_PREFIX,
  buildPrefix,
};
