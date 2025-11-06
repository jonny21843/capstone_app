document.addEventListener("DOMContentLoaded", function () {
  const viewCategory = document.querySelector("#viewCategory");
  const fileListContainer = document.querySelector("#fileList");

  viewCategory.addEventListener("change", function () {
    const category = viewCategory.value;
    listFilesInCategory(category);
  });

  async function listFilesInCategory(category) {
    fileListContainer.innerHTML = "🔄 Loading files...";

    const bucketUrl = "https://dev-feagans-capstone.s3.amazonaws.com";
    const prefix = `uploadedfiles/${category}/`;
    const listUrl = `${bucketUrl}?prefix=${encodeURIComponent(prefix)}`;

    try {
      const response = await fetch(listUrl);
      const text = await response.text();

      const parser = new DOMParser();
      const xml = parser.parseFromString(text, "application/xml");
      const keys = Array.from(xml.getElementsByTagName("Key"))
        .map(el => el.textContent)
        .filter(key => key !== prefix);

      if (keys.length === 0) {
        fileListContainer.innerHTML = "<p>No files found.</p>";
        return;
      }

      const ul = document.createElement("ul");
      keys.forEach(key => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `${bucketUrl}/${key}`;
        a.textContent = key.replace(prefix, "");
        a.target = "_blank";
        li.appendChild(a);
        ul.appendChild(li);
      });

      fileListContainer.innerHTML = "";
      fileListContainer.appendChild(ul);
    } catch (err) {
      console.error("Error fetching file list:", err);
      fileListContainer.innerHTML = "<p>Error loading files.</p>";
    }
  }
});
