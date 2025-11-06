document.addEventListener("DOMContentLoaded", () => {
  const categorySel = document.getElementById("viewCategory");
  const listEl      = document.getElementById("fileList");
  if (!categorySel || !listEl) return;

  categorySel.addEventListener("change", () => renderList(categorySel.value));

  async function renderList(category) {
    if (!category) { listEl.textContent = "Choose a category to see files."; return; }

    listEl.textContent = "Loading…";
    const { bucketRest, websiteBase, prefixRoot } = window.APP;

    const prefix = `${prefixRoot}${category}/`;
    const url = `${bucketRest}?list-type=2&prefix=${encodeURIComponent(prefix)}`;

    try {
      const res = await fetch(url);
      const text = await res.text();
      const xml  = new DOMParser().parseFromString(text, "application/xml");

      const keys = Array.from(xml.getElementsByTagName("Contents"))
        .map(c => c.getElementsByTagName("Key")[0]?.textContent || "")
        .filter(k => k.endsWith("/") === false); // ignore folder placeholders

      if (keys.length === 0) {
        listEl.textContent = "No files found in this category.";
        return;
      }

      const ul = document.createElement("ul");
      keys.forEach(k => {
        const a = document.createElement("a");
        a.href = `${websiteBase}/${k}`;     // public website URL
        a.textContent = k.replace(prefix, "");
        a.target = "_blank";

        const li = document.createElement("li");
        li.appendChild(a);
        ul.appendChild(li);
      });

      listEl.innerHTML = "";
      listEl.appendChild(ul);

    } catch (e) {
      console.error(e);
      listEl.textContent = "Error loading files.";
    }
  }

  // First render (if a category is preset)
  renderList(categorySel.value);
});
