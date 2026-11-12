const notesState = {
    notes: [],
    uploadNoteId: null,
    editingNoteId: null,
    activeView: "my-notes"
};

function apiUrl(path) {
    return `${getApiBaseUrl()}${path}`;
}

async function authenticatedFetch(path, options = {}) {
    const token = getAccessToken();
    if (!token) throw new Error("Please sign in first.");

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(apiUrl(path), { ...options, headers });

    if (response.status === 401 || response.status === 403) {
        clearTokens();
        await updateAuthUi();
        renderSignedInState();
        throw new Error("Your session expired. Please sign in again.");
    }

    return response;
}

async function loadProfile() {
    if (!isAuthenticated()) {
        return null;
    }

    const response = await authenticatedFetch("/api/profile");
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Unable to load profile.");
    }

    return data.profile;
}

function showProfilePanel(profile) {
    const panel = document.getElementById("profile-panel");

    if (!panel) {
        return;
    }

    const complete = Boolean(profile?.complete);
    panel.hidden = complete;

    if (!complete) {
        document.getElementById("profile-first-name").value = profile?.firstName || "";
        document.getElementById("profile-last-name").value = profile?.lastName || "";
    }
}

async function saveProfile(event) {
    event.preventDefault();

    const firstName = document.getElementById("profile-first-name").value.trim();
    const lastName = document.getElementById("profile-last-name").value.trim();
    const status = document.getElementById("profile-status");
    const button = document.getElementById("profile-submit");

    if (!firstName || !lastName) {
        status.textContent = "First name and last name are required.";
        status.className = "status-text error";
        return;
    }

    button.disabled = true;
    status.textContent = "Saving profile...";
    status.className = "status-text";

    try {
        const response = await authenticatedFetch("/api/profile", {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({firstName, lastName})
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Unable to save profile.");
        }

        status.textContent = `Saved. Public notes will show ${data.profile.publicAuthor}.`;
        status.className = "status-text success";
        showProfilePanel(data.profile);
    } catch (error) {
        status.textContent = error.message || "Unable to save profile.";
        status.className = "status-text error";
    } finally {
        button.disabled = false;
    }
}

function setActiveView(view) {
    notesState.activeView = view;
    document.getElementById("my-notes-view").hidden = view !== "my-notes";
    document.getElementById("explore-view").hidden = view !== "explore";
    document.getElementById("my-notes-tab").classList.toggle("active", view === "my-notes");
    document.getElementById("explore-tab").classList.toggle("active", view === "explore");

    if (view === "explore") {
        loadPublicNotes();
    }
}

function renderSignedInState() {
    const signedIn = isAuthenticated();
    const signedOutPanel = document.getElementById("signed-out-panel");
    const notesApp = document.getElementById("notes-app");
    const myNotesTab = document.getElementById("my-notes-tab");

    signedOutPanel.hidden = signedIn;
    notesApp.hidden = !signedIn;
    myNotesTab.hidden = !signedIn;

    if (!signedIn && notesState.activeView === "my-notes") {
        setActiveView("explore");
    }
}

function showCreatePanel(show) {
    const panel = document.getElementById("create-note-panel");
    panel.hidden = !show;

    if (!show) {
        notesState.editingNoteId = null;
        document.getElementById("create-note-form")?.reset();
        document.getElementById("note-form-title").textContent = "Create a note";
        document.getElementById("note-form-submit").textContent = "Create Note";
    }

    if (show) document.getElementById("note-title")?.focus();
}

function startEditNote(note) {
    notesState.editingNoteId = note.noteId;
    document.getElementById("note-title").value = note.title || "";
    document.getElementById("note-subject").value = note.subject || "";
    document.getElementById("note-collection").value = note.collection || "";
    document.getElementById("note-description").value = note.description || "";
    document.getElementById("note-form-title").textContent = "Edit note";
    document.getElementById("note-form-submit").textContent = "Save Changes";
    setCreateStatus("");
    showCreatePanel(true);
}

function setCreateStatus(message, type = "") {
    const element = document.getElementById("create-note-status");
    element.textContent = message || "";
    element.className = `status-text ${type}`.trim();
}

function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
    }).format(date);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function noteMeta(note) {
    return [note.subject, note.collection].filter(Boolean);
}

function renderEmbeddedSource(file) {
    const contentType = (file.contentType || "").toLowerCase();
    const filename = (file.filename || "").toLowerCase();
    const url = escapeHtml(file.viewUrl);
    const name = escapeHtml(file.filename || "Source file");

    if (contentType === "application/pdf" || filename.endsWith(".pdf")) {
        return `
            <section class="source-viewer-card">
                <div class="source-viewer-header">
                    <div>
                        <h3>${name}</h3>
                        <p>PDF source</p>
                    </div>
                    <a class="button button-secondary" href="${url}" target="_blank" rel="noopener">
                        Open Original ↗
                    </a>
                </div>
                <iframe
                    class="source-pdf-frame"
                    src="${url}#view=FitH"
                    title="${name}"
                ></iframe>
            </section>
        `;
    }

    if (contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(filename)) {
        return `
            <section class="source-viewer-card">
                <div class="source-viewer-header">
                    <div>
                        <h3>${name}</h3>
                        <p>Image source</p>
                    </div>
                    <a class="button button-secondary" href="${url}" target="_blank" rel="noopener">
                        Open Original ↗
                    </a>
                </div>
                <div class="source-image-wrap">
                    <img class="source-image" src="${url}" alt="${name}">
                </div>
            </section>
        `;
    }

    const isPowerPoint =
        contentType === "application/vnd.ms-powerpoint" ||
        contentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
        /\.(ppt|pptx)$/.test(filename);

    return `
        <section class="source-viewer-card">
            <div class="source-viewer-header">
                <div>
                    <h3>${name}</h3>
                    <p>${isPowerPoint ? "PowerPoint source · preview not available yet." : "Preview is not available for this file type."}</p>
                </div>
                <a class="button button-primary" href="${url}" target="_blank" rel="noopener">
                    Open Original ↗
                </a>
            </div>
        </section>
    `;
}

function renderNotes() {
    const grid = document.getElementById("notes-grid");
    const status = document.getElementById("notes-status");
    grid.innerHTML = "";

    if (notesState.notes.length === 0) {
        status.hidden = true;
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.innerHTML = `
            <h3>No notes yet</h3>
            <p>Create your first note, add a description, and upload a PDF or image.</p>
            <button class="button button-primary" type="button">+ Create Your First Note</button>
        `;
        empty.querySelector("button").addEventListener("click", () => showCreatePanel(true));
        grid.appendChild(empty);
        return;
    }

    status.hidden = true;

    notesState.notes.forEach((note) => {
        const card = document.createElement("article");
        card.className = "note-card";
        card.dataset.noteId = note.noteId;

        const meta = noteMeta(note);
        const metaHtml = meta.length
            ? meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("<span>·</span>")
            : "<span>Uncategorized</span>";

        const files = note.files || [];
        const fileCount = files.length;
        const published = note.visibility === "public";
        const sourceListHtml = files.length
            ? `
                <div class="owner-source-list">
                    ${files.map((file) => `
                        <div class="owner-source-row">
                            <span title="${escapeHtml(file.filename || "Source file")}">
                                ${escapeHtml(file.filename || "Source file")}
                            </span>
                            <button
                                class="button button-danger-text"
                                type="button"
                                data-remove-source
                                data-file-id="${escapeHtml(file.fileId || "")}"
                            >
                                Remove
                            </button>
                        </div>
                    `).join("")}
                </div>
            `
            : "";

        card.innerHTML = `
            <span class="badge">${escapeHtml(note.visibility || "private")}</span>
            <h3>${escapeHtml(note.title || "Untitled Note")}</h3>
            <div class="note-meta">${metaHtml}</div>
            <p class="note-description">${escapeHtml(note.description || "No description yet.")}</p>
            <div class="note-meta"><span>${fileCount} source file${fileCount === 1 ? "" : "s"}</span></div>
            ${sourceListHtml}
            <div class="note-card-footer">
                <span class="note-date">${escapeHtml(formatDate(note.publishedAt || note.createdAt))}</span>
                <div class="upload-block">
                    <span class="upload-status" data-upload-status></span>
                    <div class="note-actions">
                        <button class="button button-secondary" type="button" data-edit-note>Edit</button>
                        <button class="button button-secondary" type="button" data-upload-note>Upload Source</button>
                        <button class="button ${published ? "button-secondary" : "button-primary"}" type="button" data-publish-note>
                            ${published ? "Unpublish" : "Publish"}
                        </button>
                        <button class="button button-danger" type="button" data-delete-note>Delete Note</button>
                    </div>
                </div>
            </div>
        `;

        card.querySelector("[data-edit-note]").addEventListener("click", () => {
            startEditNote(note);
        });

        card.querySelectorAll("[data-remove-source]").forEach((button) => {
            button.addEventListener("click", () => {
                const fileId = button.dataset.fileId;
                if (fileId) {
                    deleteSourceFile(note, fileId);
                }
            });
        });

        card.querySelector("[data-upload-note]").addEventListener("click", () => {
            if (fileCount >= 10) {
                alert("A note can have at most 10 source files.");
                return;
            }

            notesState.uploadNoteId = note.noteId;
            const input = document.getElementById("note-upload-input");
            input.value = "";
            input.click();
        });

        card.querySelector("[data-publish-note]").addEventListener("click", () => {
            setPublished(note.noteId, !published);
        });

        card.querySelector("[data-delete-note]").addEventListener("click", () => {
            deleteNote(note);
        });

        grid.appendChild(card);
    });
}

function setNotesStatus(message, isError = false) {
    const status = document.getElementById("notes-status");
    status.hidden = false;
    status.textContent = message;
    status.style.color = isError ? "#b42318" : "";
}

async function loadNotes() {
    if (!isAuthenticated()) {
        notesState.notes = [];
        renderSignedInState();
        return;
    }

    setNotesStatus("Loading your notes...");

    try {
        const response = await authenticatedFetch("/api/notes");
        if (!response.ok) throw new Error(await response.text() || `Unable to load notes (${response.status})`);

        const data = await response.json();
        notesState.notes = data.notes || [];
        renderNotes();
    } catch (error) {
        console.error("Unable to load notes:", error);
        setNotesStatus(error.message || "Unable to load your notes.", true);
    }
}

async function createNote(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const title = document.getElementById("note-title").value.trim();
    const subject = document.getElementById("note-subject").value.trim();
    const collection = document.getElementById("note-collection").value.trim();
    const description = document.getElementById("note-description").value.trim();
    const submitButton = form.querySelector('button[type="submit"]');
    const editingNoteId = notesState.editingNoteId;

    if (!title) {
        setCreateStatus("A title is required.", "error");
        return;
    }

    submitButton.disabled = true;
    setCreateStatus(editingNoteId ? "Saving changes..." : "Creating note...");

    try {
        const response = await authenticatedFetch(
            editingNoteId ? `/api/notes/${encodeURIComponent(editingNoteId)}` : "/api/notes",
            {
                method: editingNoteId ? "PATCH" : "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({title, subject, collection, description})
            }
        );

        const data = await response.json();
        if (!response.ok) {
            throw new Error(
                data.error || (editingNoteId ? "Unable to update note." : "Unable to create note.")
            );
        }

        notesState.editingNoteId = null;
        form.reset();
        showCreatePanel(false);
        await loadNotes();
    } catch (error) {
        setCreateStatus(
            error.message || (editingNoteId ? "Unable to update note." : "Unable to create note."),
            "error"
        );
    } finally {
        submitButton.disabled = false;
    }
}

function findUploadStatus(noteId) {
    return document
        .querySelector(`.note-card[data-note-id="${CSS.escape(noteId)}"]`)
        ?.querySelector("[data-upload-status]") || null;
}

async function uploadFileForNote(file, noteId) {
    const status = findUploadStatus(noteId);
    const contentType = file.type || "application/octet-stream";
    const allowedTypes = new Set([
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ]);
    const maxFileBytes = 20 * 1024 * 1024;

    if (!allowedTypes.has(contentType)) {
        status.textContent = "Unsupported file type. Use PDF, JPG, PNG, WEBP, PPT, or PPTX.";
        status.className = "upload-status error";
        return;
    }

    if (file.size > maxFileBytes) {
        status.textContent = "File is too large. Maximum size is 20 MB.";
        status.className = "upload-status error";
        return;
    }

    status.textContent = "Preparing upload...";
    status.className = "upload-status";

    try {
        const presignResponse = await authenticatedFetch(
            `/api/notes/${encodeURIComponent(noteId)}/upload`,
            {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    filename: file.name,
                    contentType,
                    fileSize: file.size
                })
            }
        );

        const presign = await presignResponse.json();
        if (!presignResponse.ok) throw new Error(presign.error || "Unable to prepare upload.");

        status.textContent = "Uploading...";

        const uploadResponse = await fetch(presign.uploadUrl, {
            method: "PUT",
            headers: {"Content-Type": contentType},
            body: file
        });

        if (!uploadResponse.ok) throw new Error(`S3 upload failed with status ${uploadResponse.status}`);

        status.textContent = "Saving file...";
        const registerResponse = await authenticatedFetch(
            `/api/notes/${encodeURIComponent(noteId)}/files`,
            {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    key: presign.key,
                    filename: file.name,
                    contentType
                })
            }
        );

        const registered = await registerResponse.json();
        if (!registerResponse.ok) throw new Error(registered.error || "Uploaded, but could not register file.");

        status.textContent = "Uploaded successfully";
        status.className = "upload-status success";
        await loadNotes();
    } catch (error) {
        console.error("Upload failed:", error);
        status.textContent = error.message || "Upload failed";
        status.className = "upload-status error";
    }
}

async function handleUploadSelection(event) {
    const file = event.target.files?.[0];
    const noteId = notesState.uploadNoteId;
    if (!file || !noteId) return;

    await uploadFileForNote(file, noteId);
    notesState.uploadNoteId = null;
}

async function deleteSourceFile(note, fileId) {
    const file = (note.files || []).find((item) => item.fileId === fileId);
    const filename = file?.filename || "this source file";

    if (!window.confirm(`Remove "${filename}" from this note? This deletes the stored file too.`)) {
        return;
    }

    try {
        const response = await authenticatedFetch(
            `/api/notes/${encodeURIComponent(note.noteId)}/files/${encodeURIComponent(fileId)}`,
            {method: "DELETE"}
        );

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Unable to remove source file.");
        }

        await loadNotes();

        if (notesState.activeView === "explore") {
            await loadPublicNotes();
        }
    } catch (error) {
        alert(error.message || "Unable to remove source file.");
    }
}

async function deleteNote(note) {
    const warning = note.visibility === "public"
        ? `Delete "${note.title}"? It is currently public and will disappear from Explore immediately. Its stored source files will also be deleted.`
        : `Delete "${note.title}"? Its stored source files will also be deleted.`;

    if (!window.confirm(warning)) {
        return;
    }

    try {
        const response = await authenticatedFetch(
            `/api/notes/${encodeURIComponent(note.noteId)}`,
            {method: "DELETE"}
        );

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Unable to delete note.");
        }

        await loadNotes();

        if (notesState.activeView === "explore") {
            await loadPublicNotes();
        }
    } catch (error) {
        alert(error.message || "Unable to delete note.");
    }
}

async function setPublished(noteId, published) {
    try {
        const response = await authenticatedFetch(
            `/api/notes/${encodeURIComponent(noteId)}/publish`,
            {
                method: "PATCH",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({published})
            }
        );

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to update publishing status.");

        await loadNotes();
        if (notesState.activeView === "explore") await loadPublicNotes();
    } catch (error) {
        alert(error.message || "Unable to update publishing status.");
    }
}

function setPublicStatus(message, isError = false) {
    const status = document.getElementById("public-status");
    status.hidden = false;
    status.textContent = message;
    status.style.color = isError ? "#b42318" : "";
}

async function loadPublicNotes() {
    const grid = document.getElementById("public-grid");
    const detail = document.getElementById("public-note-detail");
    const query = document.getElementById("public-search").value.trim();
    const subject = document.getElementById("public-subject").value;
    const sort = document.getElementById("public-sort").value;

    detail.hidden = true;
    grid.hidden = false;
    grid.innerHTML = "";
    setPublicStatus("Loading public notes...");

    try {
        const url = new URL(apiUrl("/api/public/notes"));
        if (query) url.searchParams.set("q", query);
        if (subject) url.searchParams.set("subject", subject);
        if (sort) url.searchParams.set("sort", sort);

        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load public notes.");

        const notes = data.notes || [];
        const subjectSelect = document.getElementById("public-subject");
        const currentSubject = subjectSelect.value;

        if (subjectSelect.options.length <= 1 || currentSubject === "") {
            const options = ['<option value="">All subjects</option>']
                .concat(
                    (data.subjects || []).map(
                        (item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`
                    )
                );
            subjectSelect.innerHTML = options.join("");
            subjectSelect.value = currentSubject;
        }

        document.getElementById("public-status").hidden = true;

        if (!notes.length) {
            grid.innerHTML = `
                <div class="empty-state">
                    <h3>No public notes found</h3>
                    <p>Try a different keyword or check back as the community library grows.</p>
                </div>
            `;
            return;
        }

        notes.forEach((note) => {
            const card = document.createElement("article");
            card.className = "note-card";
            const meta = [note.subject, note.collection].filter(Boolean);
            card.innerHTML = `
                <span class="badge">Public</span>
                <h3>${escapeHtml(note.title)}</h3>
                <div class="note-meta">
                    ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("<span>·</span>")}
                </div>
                <p class="note-description">${escapeHtml(note.description || "")}</p>
                <div class="note-meta"><span>Posted by ${escapeHtml(note.publicAuthor || "Community member")}</span></div>
                <div class="note-card-footer">
                    <span class="note-date">${escapeHtml(formatDate(note.publishedAt))}</span>
                    <button class="button button-primary" type="button">View Note</button>
                </div>
            `;
            card.querySelector("button").addEventListener("click", () => openPublicNote(note.noteId));
            grid.appendChild(card);
        });
    } catch (error) {
        console.error("Unable to load public notes:", error);
        setPublicStatus(error.message || "Unable to load public notes.", true);
    }
}

async function openPublicNote(noteId) {
    const grid = document.getElementById("public-grid");
    const detail = document.getElementById("public-note-detail");
    const content = document.getElementById("public-note-content");

    try {
        const response = await fetch(apiUrl(`/api/public/notes/${encodeURIComponent(noteId)}`));
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to open note.");

        const note = data.note;
        const files = note.files || [];

        content.innerHTML = `
            <p class="eyebrow">Published note</p>
            <h2>${escapeHtml(note.title)}</h2>
            <div class="note-meta">
                ${[note.subject, note.collection].filter(Boolean).map((item) => `<span>${escapeHtml(item)}</span>`).join("<span>·</span>")}
            </div>
            <p class="note-description">${escapeHtml(note.description || "")}</p>
            <div class="note-meta"><span>Posted by ${escapeHtml(note.publicAuthor || "Community member")}</span></div>
            <h3>Source notes</h3>
            <div class="source-viewer-list">
                ${files.length
                    ? files.map((file) => renderEmbeddedSource(file)).join("")
                    : '<p class="note-description">No source files are available for this note.</p>'}
            </div>
        `;

        grid.hidden = true;
        document.getElementById("public-status").hidden = true;
        detail.hidden = false;
    } catch (error) {
        setPublicStatus(error.message || "Unable to open note.", true);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    renderSignedInState();

    document.getElementById("hero-sign-in-btn").addEventListener("click", signIn);
    document.getElementById("my-notes-tab").addEventListener("click", () => setActiveView("my-notes"));
    document.getElementById("explore-tab").addEventListener("click", () => setActiveView("explore"));
    document.getElementById("new-note-btn").addEventListener("click", () => {
        notesState.editingNoteId = null;
        document.getElementById("create-note-form").reset();
        document.getElementById("note-form-title").textContent = "Create a note";
        document.getElementById("note-form-submit").textContent = "Create Note";
        setCreateStatus("");
        showCreatePanel(true);
    });
    document.getElementById("cancel-note-btn").addEventListener("click", () => showCreatePanel(false));
    document.getElementById("profile-form").addEventListener("submit", saveProfile);
    document.getElementById("create-note-form").addEventListener("submit", createNote);
    document.getElementById("note-upload-input").addEventListener("change", handleUploadSelection);
    document.getElementById("public-search-btn").addEventListener("click", loadPublicNotes);
    document.getElementById("public-search-clear").addEventListener("click", () => {
        document.getElementById("public-search").value = "";
        document.getElementById("public-subject").value = "";
        document.getElementById("public-sort").value = "newest";
        loadPublicNotes();
    });
    document.getElementById("public-subject").addEventListener("change", loadPublicNotes);
    document.getElementById("public-sort").addEventListener("change", loadPublicNotes);
    document.getElementById("public-search").addEventListener("keydown", (event) => {
        if (event.key === "Enter") loadPublicNotes();
    });
    document.getElementById("close-public-note").addEventListener("click", loadPublicNotes);

    if (isAuthenticated()) {
        try {
            const profile = await loadProfile();
            showProfilePanel(profile);
        } catch (error) {
            console.error("Unable to load profile:", error);
        }

        await loadNotes();
    }
});
