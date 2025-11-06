// ---------- Shared config ----------
window.APP = {
  // Website URL for READs (public object URLs)
  websiteBase: "https://dev-feagans-capstone.s3-website-us-east-1.amazonaws.com",
  // REST/Listing endpoint for LIST + building object links
  bucketRest: "https://dev-feagans-capstone.s3.amazonaws.com",
  prefixRoot: "uploadedfiles/",
};

// Turn display name into a folder-safe slug
window.slugify = (name) =>
  name.trim()
      .replace(/[\/\\]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");

// ---------- Tabs ----------
document.addEventListener("DOMContentLoaded", () => {
  const sections = document.querySelectorAll(".tab-content");
  const buttons  = document.querySelectorAll(".nav-btn");

  function showTab(id) {
    sections.forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
  }

  buttons.forEach(btn => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  // default tab
  showTab("upload");

  // Populate categories on both dropdowns at load
  hydrateCategories();
});

// Query S3 for first-level folders under uploadedfiles/
async function listCategories() {
  const { bucketRest, prefixRoot } = window.APP;
  const url = `${bucketRest}?list-type=2&prefix=${encodeURIComponent(prefixRoot)}&delimiter=%2F`;

  const res  = await fetch(url);
  const text = await res.text();
  const xml  = new DOMParser().parseFromString(text, "application/xml");

  const prefixes = Array.from(xml.getElementsByTagName("CommonPrefixes"))
    .map(cp => cp.getElementsByTagName("Prefix")[0]?.textContent || "")
    .filter(p => p.startsWith(prefixRoot) && p.endsWith("/"))
    .map(p => p.slice(prefixRoot.length, -1)) // strip 'uploadedfiles/' and trailing '/'
    .filter(Boolean);

  // sort by display name
  return prefixes.sort((a, b) => a.localeCompare(b));
}

async function hydrateCategories() {
  try {
    const cats = await listCategories();

    const uploadSel = document.getElementById("uploadCategory");
    const viewSel   = document.getElementById("viewCategory");

    const setOptions = (select) => {
      // clear
      select.innerHTML = "";
      select.appendChild(new Option("-- Select --", ""));
      cats.forEach(c => select.appendChild(new Option(c, c)));
    };

    if (uploadSel) setOptions(uploadSel);
    if (viewSel)   setOptions(viewSel);

    // Fire initial view render (if on View tab, user will already have the dropdown)
    const evt = new Event("change");
    if (viewSel) viewSel.dispatchEvent(evt);
  } catch (e) {
    console.error("Category load failed:", e);
  }
}

// Expose so upload.js can re-hydrate after creating a new category
window.refreshCategories = hydrateCategories;
