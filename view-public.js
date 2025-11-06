// view-public.js

const bucketUrl = "https://dev-feagans-capstone.s3.amazonaws.com/";

// This assumes your files are uploaded to the root or a known prefix (like "uploadedfiles/")
const listUrl = "https://dev-feagans-capstone.s3.amazonaws.com?list-type=2&prefix=uploadedfiles/";

document.addEventListener("DOMContentLoaded", () => {
  const viewTabButton = document.querySelector("button[onclick=\"showTab('viewTab')\"]");

  viewTabButton.addEventListener("click", async () => {
    const fileList = document.getElementById("fileList");
    fileList.innerHTML = ""; // Clear previous items

    try {
      const response = await fetch(listUrl);
      const xml = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xml, "application/xml");

      const contents = xmlDoc.getElementsByTagName("Contents");

      if (contents.length === 0) {
        fileList.innerHTML = "<li>No files found.</li>";
      } else {
        for (let i = 0; i < contents.length; i++) {
          const key = contents[i].getElementsByTagName("Key")[0].textContent;

          const filename = key.split("/").pop();
          if (filename) {
            const url = bucketUrl + key;
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.href = url;
            a.textContent = filename;
            a.target = "_blank";
            li.appendChild(a);
            fileList.appendChild(li);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching file list:", err);
      fileList.innerHTML = "<li>Error loading file list.</li>";
    }
  });
});
