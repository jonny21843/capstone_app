document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("uploadForm");
  const fileInput = document.getElementById("fileInput");
  const categorySelect = document.getElementById("fileCategory");
  const statusDiv = document.getElementById("uploadStatus");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const file = fileInput.files[0];
    const category = categorySelect.value;

    if (!file || !category) {
      statusDiv.textContent = "Please select a file and category.";
      return;
    }

    const bucketName = "dev-feagans-capstone";
    const folder = `uploadedfiles/${category}/`;
    const url = `https://${bucketName}.s3.amazonaws.com/${folder}${encodeURIComponent(file.name)}`;

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": file.type
        },
        body: file
      });

      if (response.ok) {
        statusDiv.textContent = "✅ Upload successful!";
        form.reset();
      } else {
        statusDiv.textContent = "❌ Upload failed.";
      }
    } catch (err) {
      console.error("Upload error:", err);
      statusDiv.textContent = "❌ Upload error.";
    }
  });
});
