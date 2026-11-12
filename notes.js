const notesState = {
    notes: [],
    uploadNoteId: null,
    editingNoteId: null,
    activeView: "my-notes",
    uploadInProgress: false,
    replaceFileId: null,
    publicPage: 1,
    publicTotalPages: 1,
    profile: null,
    uploadFeedback: {},
    isAdmin: false
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

    if (response.status === 401) {
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
    notesState.profile = profile || null;
    const panel = document.getElementById("profile-panel");

    if (panel) {
        const complete = Boolean(profile?.complete);
        panel.hidden = complete;

        if (!complete) {
            document.getElementById("profile-first-name").value = profile?.firstName || "";
            document.getElementById("profile-last-name").value = profile?.lastName || "";
        }
    }

    const settingsFirst = document.getElementById("settings-first-name");
    const settingsLast = document.getElementById("settings-last-name");
    const preview = document.getElementById("settings-public-preview");
    if (settingsFirst) settingsFirst.value = profile?.firstName || "";
    if (settingsLast) settingsLast.value = profile?.lastName || "";
    if (preview) {
        preview.textContent = profile?.publicAuthor
            ? `Public notes currently show: ${profile.publicAuthor}`
            : "Complete your profile before publishing.";
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

async function saveSettingsProfile(event) {
    event.preventDefault();
    const firstName = document.getElementById("settings-first-name").value.trim();
    const lastName = document.getElementById("settings-last-name").value.trim();
    const status = document.getElementById("settings-profile-status");
    const button = document.getElementById("settings-profile-submit");

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
        if (!response.ok) throw new Error(data.error || "Unable to save profile.");
        showProfilePanel(data.profile);
        status.textContent = `Saved. Public notes will show ${data.profile.publicAuthor}.`;
        status.className = "status-text success";
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
    document.getElementById("settings-view").hidden = view !== "settings";
    document.getElementById("analytics-view").hidden = view !== "analytics";
    document.getElementById("my-notes-tab").classList.toggle("active", view === "my-notes");
    document.getElementById("explore-tab").classList.toggle("active", view === "explore");
    document.getElementById("settings-tab").classList.toggle("active", view === "settings");
    document.getElementById("analytics-tab").classList.toggle("active", view === "analytics");

    if (view === "explore") {
        loadPublicNotes();
    } else if (view === "analytics") {
        loadAdminAnalytics();
    }
}

function isConfiguredAdmin() {
    const claims = decodeJwtPayload(sessionStorage.getItem("id_token")) || {};
    const email = String(claims.email || "").trim().toLowerCase();
    const allowed = (APP_CONFIG.adminEmails || []).map((item) => String(item).trim().toLowerCase());
    return Boolean(email && allowed.includes(email));
}

function renderSignedInState() {
    const signedIn = isAuthenticated();
    const signedOutPanel = document.getElementById("signed-out-panel");
    const notesApp = document.getElementById("notes-app");
    const myNotesTab = document.getElementById("my-notes-tab");
    const settingsTab = document.getElementById("settings-tab");
    const analyticsTab = document.getElementById("analytics-tab");

    signedOutPanel.hidden = signedIn;
    notesApp.hidden = !signedIn;
    myNotesTab.hidden = !signedIn;
    settingsTab.hidden = !signedIn;
    analyticsTab.hidden = !signedIn || !isConfiguredAdmin();

    if (!signedIn && ["my-notes", "settings", "analytics"].includes(notesState.activeView)) {
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

function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

function setUploadFeedback(noteId, message, type = "") {
    notesState.uploadFeedback[noteId] = {message: message || "", type};
    const status = findUploadStatus(noteId);
    if (status) {
        status.textContent = message || "";
        status.className = `upload-status ${type}`.trim();
    }
}

function validateSourceFile(file) {
    if (!file) return null;

    const allowedTypes = new Set([
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ]);
    const contentType = file.type || "application/octet-stream";
    const maxFileBytes = 20 * 1024 * 1024;

    if (!allowedTypes.has(contentType)) {
        return "Unsupported file type. Use PDF, JPG, PNG, WEBP, PPT, or PPTX.";
    }
    if (file.size > maxFileBytes) {
        return "File is too large. Maximum size is 20 MB.";
    }
    return null;
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
                            <div class="owner-source-info">
                                <span title="${escapeHtml(file.filename || "Source file")}">
                                    ${escapeHtml(file.filename || "Source file")}
                                </span>
                                <small>${escapeHtml(formatBytes(file.sizeBytes))}</small>
                            </div>
                            <div class="source-actions">
                                <button class="button button-mini" type="button" data-move-source="up" data-file-id="${escapeHtml(file.fileId || "")}" title="Move up">↑</button>
                                <button class="button button-mini" type="button" data-move-source="down" data-file-id="${escapeHtml(file.fileId || "")}" title="Move down">↓</button>
                                <button class="button button-mini" type="button" data-rename-source data-file-id="${escapeHtml(file.fileId || "")}">Rename</button>
                                <button class="button button-mini" type="button" data-replace-source data-file-id="${escapeHtml(file.fileId || "")}">Replace</button>
                                <button class="button button-danger-text" type="button" data-remove-source data-file-id="${escapeHtml(file.fileId || "")}">Remove</button>
                            </div>
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
                    <span class="upload-status ${escapeHtml(notesState.uploadFeedback[note.noteId]?.type || "")}" data-upload-status>${escapeHtml(notesState.uploadFeedback[note.noteId]?.message || "")}</span>
                    <div class="note-actions">
                        <button class="button button-secondary" type="button" data-edit-note>Edit</button>
                        <button class="button button-secondary" type="button" data-upload-note ${notesState.uploadInProgress ? "disabled" : ""}>${notesState.uploadInProgress ? "Upload in progress…" : "Upload Source"}</button>
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

        card.querySelectorAll("[data-rename-source]").forEach((button) => {
            button.addEventListener("click", () => renameSourceFile(note, button.dataset.fileId));
        });

        card.querySelectorAll("[data-move-source]").forEach((button) => {
            button.addEventListener("click", () => moveSourceFile(note, button.dataset.fileId, button.dataset.moveSource));
        });

        card.querySelectorAll("[data-replace-source]").forEach((button) => {
            button.addEventListener("click", () => {
                if (notesState.uploadInProgress) {
                    alert("Please wait for the current upload to finish.");
                    return;
                }
                notesState.uploadNoteId = note.noteId;
                notesState.replaceFileId = button.dataset.fileId || null;
                const input = document.getElementById("note-upload-input");
                input.value = "";
                input.click();
            });
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
            if (notesState.uploadInProgress) {
                alert("Please wait for the current upload to finish before starting another one.");
                return;
            }

            if (fileCount >= 10) {
                alert("A note can have at most 10 source files.");
                return;
            }

            notesState.uploadNoteId = note.noteId;
            notesState.replaceFileId = null;
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
    const sourceFile = document.getElementById("note-form-source").files?.[0] || null;
    const publishAfterSave = document.getElementById("note-form-publish").checked;
    const submitButton = form.querySelector('button[type="submit"]');
    const editingNoteId = notesState.editingNoteId;

    if (!title) {
        setCreateStatus("A title is required.", "error");
        return;
    }

    const sourceValidationError = validateSourceFile(sourceFile);
    if (sourceValidationError) {
        setCreateStatus(sourceValidationError, "error");
        return;
    }

    if (sourceFile && notesState.uploadInProgress) {
        setCreateStatus("Please wait for the current upload to finish.", "error");
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

        const targetNoteId = editingNoteId || data.note?.noteId;

        if (sourceFile && targetNoteId) {
            notesState.uploadInProgress = true;
            setCreateStatus("Uploading source file...");
            const uploadOk = await uploadFileForNote(
                sourceFile,
                targetNoteId,
                null,
                document.getElementById("create-note-status")
            );
            notesState.uploadInProgress = false;

            if (!uploadOk) {
                notesState.editingNoteId = targetNoteId;
                document.getElementById("note-form-title").textContent = "Edit note";
                document.getElementById("note-form-submit").textContent = "Save Changes";
                await loadNotes();
                return;
            }
        }

        if (publishAfterSave && targetNoteId) {
            setCreateStatus("Publishing note...");
            const publishResponse = await authenticatedFetch(
                `/api/notes/${encodeURIComponent(targetNoteId)}/publish`,
                {
                    method: "PATCH",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({published: true})
                }
            );
            const publishData = await publishResponse.json();
            if (!publishResponse.ok) {
                notesState.editingNoteId = targetNoteId;
                document.getElementById("note-form-title").textContent = "Edit note";
                document.getElementById("note-form-submit").textContent = "Save Changes";
                throw new Error(publishData.error || "Note saved, but could not be published.");
            }
        }

        notesState.editingNoteId = null;
        form.reset();
        showCreatePanel(false);
        await loadNotes();
    } catch (error) {
        notesState.uploadInProgress = false;
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

async function uploadFileForNote(file, noteId, replaceFileId = null, statusOverride = null) {
    const status = statusOverride || findUploadStatus(noteId);
    const contentType = file.type || "application/octet-stream";

    const updateStatus = (message, type = "") => {
        if (!statusOverride) {
            setUploadFeedback(noteId, message, type);
        }
        if (status) {
            status.textContent = message || "";
            status.className = statusOverride
                ? `status-text ${type}`.trim()
                : `upload-status ${type}`.trim();
        }
    };

    const validationError = validateSourceFile(file);
    if (validationError) {
        updateStatus(validationError, "error");
        return false;
    }

    updateStatus("Preparing upload...");

    try {
        const presignResponse = await authenticatedFetch(
            `/api/notes/${encodeURIComponent(noteId)}/upload`,
            {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    filename: file.name,
                    contentType,
                    fileSize: file.size,
                    replaceFileId
                })
            }
        );

        const presign = await presignResponse.json();
        if (!presignResponse.ok) throw new Error(presign.error || "Unable to prepare upload.");

        updateStatus("Uploading...");

        const uploadBody = new FormData();
        Object.entries(presign.uploadFields || {}).forEach(([name, value]) => {
            uploadBody.append(name, value);
        });
        uploadBody.append("file", file);

        const uploadResponse = await fetch(presign.uploadUrl, {
            method: "POST",
            body: uploadBody
        });

        if (!uploadResponse.ok) {
            if (uploadResponse.status === 400 || uploadResponse.status === 403) {
                throw new Error("Upload rejected: file must be an allowed type and no larger than 20 MB.");
            }
            throw new Error(`Upload failed with status ${uploadResponse.status}.`);
        }

        updateStatus("Saving file...");
        const registerResponse = await authenticatedFetch(
            `/api/notes/${encodeURIComponent(noteId)}/files`,
            {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    key: presign.key,
                    filename: file.name,
                    contentType,
                    replaceFileId
                })
            }
        );

        const registered = await registerResponse.json();
        if (!registerResponse.ok) throw new Error(registered.error || "Uploaded, but could not register file.");

        updateStatus(replaceFileId ? "Replaced successfully" : "Uploaded successfully", "success");
        await loadNotes();
        return true;
    } catch (error) {
        console.error("Upload failed:", error);
        updateStatus(error.message || "Upload failed", "error");
        return false;
    }
}

async function handleUploadSelection(event) {
    const file = event.target.files?.[0];
    const noteId = notesState.uploadNoteId;
    const replaceFileId = notesState.replaceFileId;
    if (!file || !noteId) return;

    if (notesState.uploadInProgress) {
        alert("Please wait for the current upload to finish before starting another one.");
        return;
    }

    notesState.uploadInProgress = true;
    renderNotes();

    try {
        await uploadFileForNote(file, noteId, replaceFileId);
    } finally {
        notesState.uploadInProgress = false;
        notesState.uploadNoteId = null;
        notesState.replaceFileId = null;
        renderNotes();
    }
}

async function updateSourceFile(note, fileId, payload) {
    try {
        const response = await authenticatedFetch(
            `/api/notes/${encodeURIComponent(note.noteId)}/files/${encodeURIComponent(fileId)}`,
            {
                method: "PATCH",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(payload)
            }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to update source file.");
        await loadNotes();
    } catch (error) {
        alert(error.message || "Unable to update source file.");
    }
}

async function renameSourceFile(note, fileId) {
    const file = (note.files || []).find((item) => item.fileId === fileId);
    if (!file) return;
    const filename = window.prompt("Rename source file:", file.filename || "");
    if (filename === null) return;
    const trimmed = filename.trim();
    if (!trimmed) {
        alert("Filename cannot be empty.");
        return;
    }
    await updateSourceFile(note, fileId, {action: "rename", filename: trimmed});
}

async function moveSourceFile(note, fileId, direction) {
    await updateSourceFile(note, fileId, {action: "move", direction});
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

async function probeAdminAccess() {
    if (!isAuthenticated()) return false;

    try {
        const response = await authenticatedFetch("/api/admin/analytics?probe=1");
        if (response.status === 403) {
            notesState.isAdmin = false;
            document.getElementById("analytics-tab").hidden = true;
            return false;
        }
        if (!response.ok) return false;
        notesState.isAdmin = true;
        document.getElementById("analytics-tab").hidden = !isConfiguredAdmin();
        return true;
    } catch (error) {
        console.error("Unable to check admin analytics access:", error);
        return false;
    }
}

function renderAnalyticsList(elementId, items, emptyText) {
    const element = document.getElementById(elementId);
    if (!element) return;

    if (!items?.length) {
        element.innerHTML = `<p class="note-description">${escapeHtml(emptyText)}</p>`;
        return;
    }

    element.innerHTML = items.map((item) => `
        <div class="analytics-list-row">
            <span>${escapeHtml(item.label)}</span>
            <strong>${Number(item.count || 0)}</strong>
        </div>
    `).join("");
}

async function loadAdminAnalytics() {
    const status = document.getElementById("analytics-status");
    const content = document.getElementById("analytics-content");
    status.hidden = false;
    status.textContent = "Loading analytics...";
    status.style.color = "";
    content.hidden = true;

    try {
        const response = await authenticatedFetch("/api/admin/analytics");
        let data = {};
        try {
            data = await response.json();
        } catch {
            data = {};
        }

        if (response.status === 403) {
            notesState.isAdmin = false;
            document.getElementById("analytics-tab").hidden = true;
            setActiveView("my-notes");
            return;
        }
        if (!response.ok) {
            const detail = data.detail ? ` — ${data.detail}` : "";
            throw new Error((data.error || `Unable to load analytics (HTTP ${response.status}).`) + detail);
        }

        const metrics = data.metrics || {};
        document.getElementById("metric-users").textContent = Number(metrics.users || 0);
        document.getElementById("metric-notes").textContent = Number(metrics.notes || 0);
        document.getElementById("metric-public-notes").textContent = Number(metrics.publicNotes || 0);
        document.getElementById("metric-private-notes").textContent = Number(metrics.privateNotes || 0);
        document.getElementById("metric-source-files").textContent = Number(metrics.sourceFiles || 0);
        document.getElementById("metric-storage").textContent = formatBytes(metrics.storageBytes || 0) || "0 B";
        document.getElementById("metric-views").textContent = Number(metrics.views || 0);
        document.getElementById("metric-average-files").textContent = Number(metrics.averageFilesPerNote || 0).toFixed(2);

        const warnings = data.warnings || [];
        if (warnings.length) {
            status.hidden = false;
            status.textContent = warnings.map((warning) => warning.message).join(" ");
            status.style.color = "#b54708";
        }

        renderAnalyticsList("analytics-subjects", data.topSubjects || [], "No subjects yet.");
        renderAnalyticsList("analytics-collections", data.topCollections || [], "No collections yet.");

        const recent = document.getElementById("analytics-recent");
        if (!(data.recentPublished || []).length) {
            recent.innerHTML = '<p class="note-description">No published notes yet.</p>';
        } else {
            recent.innerHTML = data.recentPublished.map((note) => `
                <div class="analytics-recent-row">
                    <div>
                        <strong>${escapeHtml(note.title || "Untitled note")}</strong>
                        <span>${escapeHtml([note.subject, note.collection].filter(Boolean).join(" · "))}</span>
                    </div>
                    <div class="analytics-recent-meta">
                        <span>${Number(note.viewCount || 0)} views</span>
                        <span>${Number(note.fileCount || 0)} files</span>
                        <span>${escapeHtml(formatDate(note.publishedAt))}</span>
                    </div>
                </div>
            `).join("");
        }

        if (!(data.warnings || []).length) {
            status.hidden = true;
        }
        content.hidden = false;
    } catch (error) {
        status.textContent = error.message || "Unable to load analytics.";
        status.style.color = "#b42318";
    }
}

function showCopyToast(event) {
    const toast = document.createElement("div");
    toast.className = "copy-toast";
    toast.textContent = "Copied";
    const x = event?.clientX ?? window.innerWidth / 2;
    const y = event?.clientY ?? 80;
    toast.style.left = `${Math.min(x + 10, window.innerWidth - 90)}px`;
    toast.style.top = `${Math.min(y + 10, window.innerHeight - 50)}px`;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 1100);
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
    const collection = document.getElementById("public-collection").value;
    const sort = document.getElementById("public-sort").value;

    detail.hidden = true;
    grid.hidden = false;
    grid.innerHTML = "";
    setPublicStatus("Loading public notes...");

    try {
        const url = new URL(apiUrl("/api/public/notes"));
        if (query) url.searchParams.set("q", query);
        if (subject) url.searchParams.set("subject", subject);
        if (collection) url.searchParams.set("collection", collection);
        if (sort) url.searchParams.set("sort", sort);
        url.searchParams.set("page", String(notesState.publicPage));
        url.searchParams.set("pageSize", "12");

        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load public notes.");

        const notes = data.notes || [];
        const subjectSelect = document.getElementById("public-subject");
        const currentSubject = subjectSelect.value;
        const collectionSelect = document.getElementById("public-collection");
        const currentCollection = collectionSelect.value;

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

        if (collectionSelect.options.length <= 1 || currentCollection === "") {
            const collectionOptions = ['<option value="">All collections</option>']
                .concat(
                    (data.collections || []).map(
                        (item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`
                    )
                );
            collectionSelect.innerHTML = collectionOptions.join("");
            collectionSelect.value = currentCollection;
        }

        notesState.publicPage = data.page || 1;
        notesState.publicTotalPages = data.totalPages || 1;
        const pagination = document.getElementById("public-pagination");
        const pageLabel = document.getElementById("public-page-label");
        pagination.hidden = (data.totalPages || 1) <= 1;
        pageLabel.textContent = `Page ${notesState.publicPage} of ${notesState.publicTotalPages} · ${data.total || 0} notes`;
        document.getElementById("public-prev-page").disabled = notesState.publicPage <= 1;
        document.getElementById("public-next-page").disabled = notesState.publicPage >= notesState.publicTotalPages;

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
                <div class="note-meta">
                    <span>Posted by ${escapeHtml(note.publicAuthor || "Community member")}</span>
                    <span>·</span>
                    <span>${Number(note.viewCount || 0)} views</span>
                </div>
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

function publicNoteShareUrl(noteId) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("note", noteId);
    return url.toString();
}

async function sharePublicNote(noteId, event = null) {
    const url = publicNoteShareUrl(noteId);
    try {
        await navigator.clipboard.writeText(url);
        showCopyToast(event);
    } catch {
        window.prompt("Copy this note link:", url);
    }
}

async function openPublicNote(noteId, updateUrl = true) {
    const grid = document.getElementById("public-grid");
    const detail = document.getElementById("public-note-detail");
    const content = document.getElementById("public-note-content");

    try {
        const response = await fetch(apiUrl(`/api/public/notes/${encodeURIComponent(noteId)}`));
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to open note.");

        const note = data.note;
        const files = note.files || [];

        if (updateUrl) {
            const url = new URL(window.location.href);
            url.searchParams.set("note", noteId);
            window.history.replaceState({}, "", url);
        }

        content.innerHTML = `
            <p class="eyebrow">Published note</p>
            <h2>${escapeHtml(note.title)}</h2>
            <div class="note-meta">
                ${[note.subject, note.collection].filter(Boolean).map((item) => `<span>${escapeHtml(item)}</span>`).join("<span>·</span>")}
            </div>
            <p class="note-description">${escapeHtml(note.description || "")}</p>
            <div class="note-meta">
                <span>Posted by ${escapeHtml(note.publicAuthor || "Community member")}</span>
                <span>·</span>
                <span>${Number(note.viewCount || 0)} views</span>
            </div>
            <div class="public-detail-actions">
                <button id="share-public-note" class="button button-secondary" type="button">Copy Share Link</button>
            </div>
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
        document.getElementById("share-public-note")?.addEventListener("click", (event) => sharePublicNote(noteId, event));
    } catch (error) {
        setPublicStatus(error.message || "Unable to open note.", true);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    renderSignedInState();

    document.getElementById("hero-sign-in-btn").addEventListener("click", signIn);
    document.getElementById("my-notes-tab").addEventListener("click", () => setActiveView("my-notes"));
    document.getElementById("explore-tab").addEventListener("click", () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("note");
        window.history.replaceState({}, "", url);
        notesState.publicPage = 1;
        setActiveView("explore");
    });
    document.getElementById("settings-tab").addEventListener("click", () => setActiveView("settings"));
    document.getElementById("analytics-tab").addEventListener("click", () => setActiveView("analytics"));
    document.getElementById("refresh-analytics").addEventListener("click", loadAdminAnalytics);
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
    document.getElementById("settings-profile-form").addEventListener("submit", saveSettingsProfile);
    document.getElementById("create-note-form").addEventListener("submit", createNote);
    document.getElementById("note-upload-input").addEventListener("change", handleUploadSelection);
    document.getElementById("public-search-btn").addEventListener("click", () => {
        notesState.publicPage = 1;
        loadPublicNotes();
    });
    document.getElementById("public-search-clear").addEventListener("click", () => {
        document.getElementById("public-search").value = "";
        document.getElementById("public-subject").value = "";
        document.getElementById("public-collection").value = "";
        document.getElementById("public-sort").value = "newest";
        notesState.publicPage = 1;
        loadPublicNotes();
    });
    document.getElementById("public-subject").addEventListener("change", () => {
        notesState.publicPage = 1;
        loadPublicNotes();
    });
    document.getElementById("public-collection").addEventListener("change", () => {
        notesState.publicPage = 1;
        loadPublicNotes();
    });
    document.getElementById("public-sort").addEventListener("change", () => {
        notesState.publicPage = 1;
        loadPublicNotes();
    });
    document.getElementById("public-prev-page").addEventListener("click", () => {
        if (notesState.publicPage > 1) {
            notesState.publicPage -= 1;
            loadPublicNotes();
        }
    });
    document.getElementById("public-next-page").addEventListener("click", () => {
        if (notesState.publicPage < notesState.publicTotalPages) {
            notesState.publicPage += 1;
            loadPublicNotes();
        }
    });
    document.getElementById("public-search").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            notesState.publicPage = 1;
            loadPublicNotes();
        }
    });
    document.getElementById("close-public-note").addEventListener("click", () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("note");
        window.history.replaceState({}, "", url);
        loadPublicNotes();
    });

    if (isAuthenticated()) {
        try {
            const profile = await loadProfile();
            showProfilePanel(profile);
        } catch (error) {
            console.error("Unable to load profile:", error);
        }

        renderSignedInState();
        await probeAdminAccess();
        await loadNotes();
    }

    const sharedNoteId = new URL(window.location.href).searchParams.get("note");
    if (sharedNoteId) {
        notesState.activeView = "explore";
        document.getElementById("my-notes-view").hidden = true;
        document.getElementById("settings-view").hidden = true;
        document.getElementById("analytics-view").hidden = true;
        document.getElementById("explore-view").hidden = false;
        document.getElementById("my-notes-tab").classList.remove("active");
        document.getElementById("settings-tab").classList.remove("active");
        document.getElementById("analytics-tab").classList.remove("active");
        document.getElementById("explore-tab").classList.add("active");
        await openPublicNote(sharedNoteId, false);
    }
});
