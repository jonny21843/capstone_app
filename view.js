document.addEventListener("DOMContentLoaded", () => {
  // Find whichever select you have on the View tab
  const categorySelect =
    document.querySelector("#viewCategory") ||
    document.querySelector("#fileCategory") ||
    document.querySelector("#listCategory");

  const fileListContainer = document.getElementById("fileList");

  // Bail if the elements aren't present on this page
  if (!categorySelect || !fileListContainer) return;

  const BUCKET = "dev-feagans-capstone";
  const REST_BASE = `https://${BUCKET}.s3.amazonaws.com`;

  // Same slug rules as used on upload (spaces -> "-", collapse multiple dashes, remove slashes)
  function slugify(name) {
    return String(name || "")
      .trim()
      .replace(/[\/\\]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }

  // Encode each path segment, but keep slashes
  function encodeKey(key) {
    return key.split("/").map(encodeURIComponent).join("/");
  }

  // Build a prefix query param that keeps slashes as slashes
  function buildPrefixParam(pathWithSlashes) {
    // encodeURIComponent, then restore %2F back to /
    return encodeURIComponent(pathWithSlashes).replace(/%2F/g, "/");
  }

  async function listKeysForPrefix(prefix) {
    // Use list-type=2 and a prefix; do NOT set delimiter here since we want object keys under that folder
    const url = `${REST_BASE}?list-type=2&prefix=${buildPrefixParam(prefix)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`S3 list failed: ${res.status}`);
    const xml = new DOMParser().parseFromString(await res.text(), "application/xml");
    const contents = Array.from(xml.getElementsByTagName("Contents"));
    const keys = contents
      .map(c => c.getElementsByTagName("Key")[0]?.textContent || "")
      .filter(k => k && k !== prefix); // exclude the "folder marker"
    return keys;
  }

  async function listFiles(category) {
    if (!category || category === "-- Select --" || category === "-- Select a category --") {
      fileListContainer.innerHTML = "<p>Please select a category.</p>";
      return;
    }

    fileListContainer.innerHTML = "<p>Loading files…</p>";

    const rawPrefix  = `uploadedfiles/${category}/`;
    const slugPrefix = `uploadedfiles/${slugify(category)}/`;

    try {
      // Try raw category first
      let keys = await listKeysForPrefix(rawPrefix);

      // If no files found under raw, try slugged folder (covers uploads that used slugify)
      if (keys.length === 0 && slugPrefix !== rawPrefix) {
        keys = await listKeysForPrefix(slugPrefix);
      }

      if (keys.length === 0) {
        fileListContainer.innerHTML = "<p>No files found in this category.</p>";
        return;
      }

      // Determine which prefix matched so we can trim it for display
      const effectivePrefix = keys[0].startsWith(rawPrefix) ? rawPrefix : slugPrefix;

      const ul = document.createElement("ul");
      keys.forEach(key => {
        const li = document.createElement("li");
        const a  = document.createElement("a");
        a.href = `${REST_BASE}/${encodeKey(key)}`; // open via HTTPS REST endpoint
        a.textContent = key.replace(effectivePrefix, "");
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        li.appendChild(a);
        ul.appendChild(li);
      });

      fileListContainer.innerHTML = "";
      fileListContainer.appendChild(ul);
    } catch (err) {
      console.error("Error loading S3 list:", err);
      fileListContainer.innerHTML = "<p>Error loading files from S3.</p>";
    }
  }

  // Wire up change + initial render if already selected
  categorySelect.addEventListener("change", () => listFiles(categorySelect.value));
  if (categorySelect.value) listFiles(categorySelect.value);
});
