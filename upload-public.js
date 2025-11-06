const bucketBaseUrl = "https://dev-feagans-capstone.s3.amazonaws.com/";

document.getElementById("uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const category = document.getElementById("category").value;
  const file = document.getElementById("fileInput").files[0];
  if (!file) return alert("No file selected.");

  const uploadUrl = `${bucketBaseUrl}${category}/${encodeURIComponent(file.name)}`;

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type
    },
    body: file
  });

  if (response.ok) {
    alert("✅ Upload successful!");
  } else {
    alert("❌ Upload failed.");
    console.error(await response.text());
  }
});
