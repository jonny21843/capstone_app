const notesState = {
    notes: [],
    uploadNoteId: null
};

function apiUrl(path) {
    return `${getApiBaseUrl()}${path}`;
}

async function authenticatedFetch(path, options = {}) {
    const token = getAccessToken();

    if (!token) {
        throw new Error("Please sign in first.");
    }

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(apiUrl(path), {
        ...options,
        headers
    });

    if (response.status === 401 || response.status === 403) {
        clearTokens();
        await updateAuthUi();
        renderSignedInState();
        throw new Error("Your session expired. Please sign in again.");
    }

    return response;
}

function renderSignedInState() {
    const signedOutPanel = document.getElementById("signed-out-panel");
    const notesApp = document.getElementById("notes-app");
    const signedIn = isAuthenticated();

    if (signedOutPanel) {
        signedOutPanel.hidden = signedIn;
    }

    if (notesApp) {
        notesApp.hidden = !signedIn;
    }
}

function showCreatePanel(show) {
    const panel = document.getElementById("create-note-panel");

    if (!panel) {
        return;
    }

    panel.hidden = !show;

    if (show) {
        document.getElementById("note-title")?.focus();
    }
}

function setCreateStatus(message, type = "") {
    const element = document.getElementById("create-note-status");

    if (!element) {
        return;
    }

    element.textContent = message || "";
    element.className = `status-text ${type}`.trim();
}

function formatDate(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
    }).format(date);
}

function noteMeta(note) {
    return [note.subject, note.collection].filter(Boolean);
}

function renderNotes() {
    const grid = document.getElementById("notes-grid");
    const status = document.getElementById("notes-status");

    if (!grid || !status) {
        return;
    }

    grid.innerHTML = "";

    if (notesState.notes.length === 0) {
        status.hidden = true;

        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.innerHTML = `
            <h3>No notes yet</h3>
            <p>Create your first note, then upload a PDF or image of your source material.</p>
            <button class="button button-primary" type="button">+ Create Your First Note</button>
        `;

        empty.querySelector("button")?.addEventListener("click", () => {
            showCreatePanel(true);
        });

        grid.appendChild(empty);
        return;
    }

    status.hidden = true;

    notesState.notes.forEach((note) => {
        const card = document.createElement("article");
        card.className = "note-card";

        const meta = noteMeta(note);
        const metaHtml = meta.length
            ? meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("<span>·</span>")
            : "<span>Uncategorized</span>";

        card.innerHTML = `
            <span class="badge">${escapeHtml(note.visibility || "private")}</span>
            <h3>${escapeHtml(note.title || "Untitled Note")}</h3>
            <div class="note-meta">${metaHtml}</div>
            <div class="note-card-footer">
                <span class="note-date">${escapeHtml(formatDate(note.createdAt))}</span>
                <div class="upload-block">
                    <span class="upload-status" data-upload-status></span>
                    <button class="button button-secondary" type="button" data-upload-note>
                        Upload Source
                    </button>
                </div>
            </div>
        `;

        card.querySelector("[data-upload-note]")?.addEventListener("click", () => {
            notesState.uploadNoteId = note.noteId;
            const fileInput = document.getElementById("note-upload-input");

            if (fileInput) {
                fileInput.value = "";
                fileInput.click();
            }
        });

        card.dataset.noteId = note.noteId;
        grid.appendChild(card);
    });
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function setNotesStatus(message, isError = false) {
    const status = document.getElementById("notes-status");

    if (!status) {
        return;
    }

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

        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `Unable to load notes (${response.status})`);
        }

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
    const title = document.getElementById("note-title")?.value.trim() || "";
    const subject = document.getElementById("note-subject")?.value.trim() || "";
    const collection = document.getElementById("note-collection")?.value.trim() || "";
    const submitButton = form.querySelector('button[type="submit"]');

    if (!title) {
        setCreateStatus("A title is required.", "error");
        return;
    }

    submitButton.disabled = true;
    setCreateStatus("Creating note...");

    try {
        const response = await authenticatedFetch("/api/notes", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                title,
                subject,
                collection
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Unable to create note.");
        }

        form.reset();
        setCreateStatus("Note created.", "success");
        showCreatePanel(false);
        await loadNotes();
    } catch (error) {
        console.error("Create note failed:", error);
        setCreateStatus(error.message || "Unable to create note.", "error");
    } finally {
        submitButton.disabled = false;
    }
}

function findUploadStatus(noteId) {
    const card = document.querySelector(`.note-card[data-note-id="${CSS.escape(noteId)}"]`);

    return card?.querySelector("[data-upload-status]") || null;
}

async function uploadFileForNote(file, noteId) {
    const status = findUploadStatus(noteId);
    const contentType = file.type || "application/octet-stream";

    if (status) {
        status.textContent = "Preparing upload...";
        status.className = "upload-status";
    }

    try {
        const presignResponse = await authenticatedFetch(
            `/api/notes/${encodeURIComponent(noteId)}/upload`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    filename: file.name,
                    contentType
                })
            }
        );

        const presign = await presignResponse.json();

        if (!presignResponse.ok) {
            throw new Error(presign.error || "Unable to prepare upload.");
        }

        if (status) {
            status.textContent = "Uploading...";
        }

        const uploadResponse = await fetch(presign.uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Type": contentType
            },
            body: file
        });

        if (!uploadResponse.ok) {
            throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        if (status) {
            status.textContent = "Uploaded successfully";
            status.className = "upload-status success";
        }
    } catch (error) {
        console.error("Upload failed:", error);

        if (status) {
            status.textContent = error.message || "Upload failed";
            status.className = "upload-status error";
        }
    }
}

async function handleUploadSelection(event) {
    const file = event.target.files?.[0];
    const noteId = notesState.uploadNoteId;

    if (!file || !noteId) {
        return;
    }

    await uploadFileForNote(file, noteId);
    notesState.uploadNoteId = null;
}

document.addEventListener("DOMContentLoaded", async () => {
    renderSignedInState();

    document.getElementById("hero-sign-in-btn")?.addEventListener("click", signIn);
    document.getElementById("new-note-btn")?.addEventListener("click", () => {
        setCreateStatus("");
        showCreatePanel(true);
    });
    document.getElementById("cancel-note-btn")?.addEventListener("click", () => {
        setCreateStatus("");
        showCreatePanel(false);
    });
    document.getElementById("create-note-form")?.addEventListener("submit", createNote);
    document.getElementById("note-upload-input")?.addEventListener("change", handleUploadSelection);

    if (isAuthenticated()) {
        await loadNotes();
    }

    window.addEventListener("focus", () => {
        renderSignedInState();
    });
});
