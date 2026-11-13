const CURATED_SUBJECTS = [
    "Technology",
    "Medicine & Health",
    "Engineering",
    "Science",
    "Space & Astronomy",
    "Psychology",
    "Mathematics",
    "Business & Finance",
    "Law & Government",
    "Education",
    "History",
    "Arts & Humanities",
    "Social Sciences",
    "Languages"
];

let publicTaxonomy = {
    subjects: [...CURATED_SUBJECTS],
    topics: [],
    subjectTopics: {}
};

function normalizeOptions(values) {
    return [...new Set((values || []).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
}

function getSearchSelectValues(type) {
    if (type === "subject") {
        return publicTaxonomy.subjects;
    }

    const subject = document.getElementById("note-subject")?.value.trim() || "";

    if (!subject) {
        return publicTaxonomy.topics;
    }

    const subjectKey = Object.keys(publicTaxonomy.subjectTopics || {}).find(
        (key) => key.toLowerCase() === subject.toLowerCase()
    );

    return subjectKey
        ? publicTaxonomy.subjectTopics[subjectKey]
        : [];
}

function closeSearchSelect(container) {
    const menu = container?.querySelector(".search-select-menu");
    const toggle = container?.querySelector(".search-select-toggle");
    if (menu) menu.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function renderSearchSelectOptions(container, forceOpen = false) {
    if (!container) return;

    const type = container.dataset.searchSelect;
    const input = container.querySelector("input");
    const menu = container.querySelector(".search-select-menu");
    const toggle = container.querySelector(".search-select-toggle");
    const query = (input?.value || "").trim().toLowerCase();

    const values = normalizeOptions(getSearchSelectValues(type));
    const filtered = query
        ? values.filter((value) => value.toLowerCase().includes(query))
        : values;

    if (!menu || !input) return;

    if (!filtered.length) {
        menu.innerHTML = `
            <div class="search-select-empty">
                No matching existing ${type}. You can keep your custom value.
            </div>
        `;
    } else {
        menu.innerHTML = filtered
            .map(
                (value) => `
                    <button
                        class="search-select-option"
                        type="button"
                        data-value="${escapeHtml(value)}"
                    >
                        ${escapeHtml(value)}
                    </button>
                `
            )
            .join("");

        menu.querySelectorAll(".search-select-option").forEach((option) => {
            option.addEventListener("click", () => {
                input.value = option.dataset.value || "";
                closeSearchSelect(container);

                if (type === "subject") {
                    refreshTopicSuggestions();
                    document.getElementById("note-collection")?.focus();
                }
            });
        });
    }

    if (forceOpen || document.activeElement === input) {
        menu.hidden = false;
        toggle?.setAttribute("aria-expanded", "true");
    }
}

function refreshTopicSuggestions() {
    const topicContainer = document.querySelector('[data-search-select="topic"]');
    renderSearchSelectOptions(topicContainer, false);
}

function setupSearchSelects() {
    document.querySelectorAll(".search-select").forEach((container) => {
        const input = container.querySelector("input");
        const toggle = container.querySelector(".search-select-toggle");

        input?.addEventListener("focus", () => renderSearchSelectOptions(container, true));
        input?.addEventListener("input", () => {
            renderSearchSelectOptions(container, true);
            if (container.dataset.searchSelect === "subject") {
                refreshTopicSuggestions();
            }
        });

        toggle?.addEventListener("click", () => {
            const menu = container.querySelector(".search-select-menu");
            const isOpen = menu && !menu.hidden;

            document.querySelectorAll(".search-select").forEach((other) => {
                if (other !== container) closeSearchSelect(other);
            });

            if (isOpen) {
                closeSearchSelect(container);
            } else {
                renderSearchSelectOptions(container, true);
                input?.focus();
            }
        });
    });

    document.addEventListener("click", (event) => {
        document.querySelectorAll(".search-select").forEach((container) => {
            if (!container.contains(event.target)) {
                closeSearchSelect(container);
            }
        });
    });
}

function applyPublicTaxonomy(data) {
    const subjects = [...CURATED_SUBJECTS, ...(data.subjects || [])];
    publicTaxonomy = {
        subjects: normalizeOptions(subjects),
        topics: normalizeOptions(data.collections || []),
        subjectTopics: data.subjectTopics || {}
    };

    document.querySelectorAll(".search-select").forEach((container) => {
        renderSearchSelectOptions(container, false);
    });
}

async function loadPublicTaxonomy() {
    try {
        const url = new URL(apiUrl("/api/public/notes"));
        url.searchParams.set("page", "1");
        url.searchParams.set("pageSize", "1");
        const response = await fetch(url);
        const data = await response.json();
        if (response.ok) applyPublicTaxonomy(data);
    } catch (error) {
        console.error("Unable to load note taxonomy suggestions:", error);
        publicTaxonomy.subjects = [...CURATED_SUBJECTS];
    }
}

const notesState = {
    notes: [],
    uploadNoteId: null,
    editingNoteId: null,
    activeView: "my-notes",
    uploadInProgress: false,
    replaceFileId: null,
    publicPage: 1,
    publicTotalPages: 1,
    publicPageSize: 18,
    profile: null,
    uploadFeedback: {},
    isAdmin: false,
    dismissedEmptyCreate: false
};

function apiUrl(path) {
    return `${getApiBaseUrl()}${path}`;
}

async function adminFetch(path, options = {}) {
    const token = sessionStorage.getItem("id_token");
    if (!token) throw new Error("Please sign in first.");

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);

    return fetch(apiUrl(path), { ...options, headers });
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

function fileSecurityLabel(file) {
    const status = (file?.malwareScanStatus || "").toUpperCase();
    if (!status) return "Legacy source";
    if (status === "NO_THREATS_FOUND") return "Security scan passed";
    if (status === "PENDING") return "Security scan in progress";
    if (status === "THREATS_FOUND") return "Blocked: threat detected";
    return "Blocked: scan could not be verified";
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
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ]);
    const contentType = file.type || "application/octet-stream";
    const maxFileBytes = 20 * 1024 * 1024;

    if (!allowedTypes.has(contentType)) {
        return "Unsupported file type. Use PDF, JPG, PNG, WEBP, PPTX, or XLSX.";
    }
    if (file.size > maxFileBytes) {
        return "File is too large. Maximum size is 20 MB.";
    }
    return null;
}

function renderEmbeddedSource(file, index = 0) {
    const contentType = (file.contentType || "").toLowerCase();
    const filename = (file.filename || "").toLowerCase();
    const rawViewUrl = file.viewUrl || "";
    const rawDownloadUrl = file.downloadUrl || rawViewUrl;
    const url = escapeHtml(rawViewUrl);
    const downloadUrl = escapeHtml(rawDownloadUrl);
    const name = escapeHtml(file.filename || "Source file");
    const sourceId = `source-${escapeHtml(file.fileId || String(index + 1))}`;

    if (contentType === "application/pdf" || filename.endsWith(".pdf")) {
        return `
            <section id="${sourceId}" class="source-viewer-card">
                <div class="source-viewer-header">
                    <div>
                        <h3>${name}</h3>
                        <p>PDF source</p>
                    </div>
                    <a class="button button-secondary" href="${url}" target="_blank" rel="noopener">
                        Open in Browser ↗
                    </a>
                </div>
                <iframe class="source-pdf-frame" src="${url}#view=FitH" title="${name}"></iframe>
            </section>
        `;
    }

    if (contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(filename)) {
        return `
            <section id="${sourceId}" class="source-viewer-card">
                <div class="source-viewer-header">
                    <div>
                        <h3>${name}</h3>
                        <p>Image source</p>
                    </div>
                    <a class="button button-secondary" href="${url}" target="_blank" rel="noopener">
                        Open in Browser ↗
                    </a>
                </div>
                <div class="source-image-wrap">
                    <img class="source-image" src="${url}" alt="${name}">
                </div>
            </section>
        `;
    }

    const isExcel =
        contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        filename.endsWith(".xlsx");

    if (isExcel) {
        return `
            <section id="${sourceId}" class="source-viewer-card">
                <div class="source-viewer-header">
                    <div>
                        <h3>${name}</h3>
                        <p>Excel source · read-only Notes App preview</p>
                    </div>
                    <a class="button button-text" href="${downloadUrl}">
                        Download Original
                    </a>
                </div>
                <div class="native-sheet-preview" data-xlsx-preview data-file-id="${escapeHtml(file.fileId || "")}">
                    <div class="sheet-preview-loading">Loading workbook preview...</div>
                </div>
            </section>
        `;
    }

    const isPowerPoint =
        contentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
        filename.endsWith(".pptx");

    if (isPowerPoint) {
        return `
            <section id="${sourceId}" class="source-viewer-card">
                <div class="source-viewer-header">
                    <div>
                        <h3>${name}</h3>
                        <p>PowerPoint source · read-only Notes App preview</p>
                    </div>
                    <a class="button button-text" href="${downloadUrl}">
                        Download Original
                    </a>
                </div>
                <div class="native-ppt-preview" data-pptx-preview data-file-id="${escapeHtml(file.fileId || "")}">
                    <div class="ppt-preview-loading">Loading presentation preview...</div>
                </div>
            </section>
        `;
    }

    const isLegacyPowerPoint =
        contentType === "application/vnd.ms-powerpoint" ||
        filename.endsWith(".ppt");

    const isLegacyExcel =
        contentType === "application/vnd.ms-excel" ||
        filename.endsWith(".xls");

    return `
        <section id="${sourceId}" class="source-viewer-card">
            <div class="source-viewer-header">
                <div>
                    <h3>${name}</h3>
                    <p>${isLegacyPowerPoint ? "Legacy PowerPoint source" : isLegacyExcel ? "Legacy Excel source" : "Source file"} · browser preview not available yet.</p>
                </div>
                <a class="button button-text" href="${downloadUrl}">
                    Download Original
                </a>
            </div>
        </section>
    `;
}

function renderSheetTable(sheet) {
    const rows = sheet.rows || [];
    const columnCount = Math.max(
        Number(sheet.columnCount || 0),
        ...rows.map((row) => row.length),
        1
    );

    const headerCells = Array.from({length: columnCount}, (_, index) => {
        let n = index + 1;
        let label = "";
        while (n > 0) {
            n -= 1;
            label = String.fromCharCode(65 + (n % 26)) + label;
            n = Math.floor(n / 26);
        }
        return `<th scope="col">${label}</th>`;
    }).join("");

    const bodyRows = rows.length
        ? rows.map((row, rowIndex) => `
            <tr>
                <th scope="row">${rowIndex + 1}</th>
                ${Array.from({length: columnCount}, (_, colIndex) => `
                    <td>${escapeHtml(row[colIndex] ?? "")}</td>
                `).join("")}
            </tr>
        `).join("")
        : `<tr><th scope="row">1</th><td colspan="${columnCount}">This worksheet is empty.</td></tr>`;

    return `
        <div class="sheet-table-scroll">
            <table class="sheet-preview-table">
                <thead>
                    <tr>
                        <th class="sheet-corner"></th>
                        ${headerCells}
                    </tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>
        ${sheet.truncated ? '<p class="sheet-preview-limit">Preview limited to the first 100 rows and 30 columns.</p>' : ""}
    `;
}

async function loadNativeExcelPreviews(noteId) {
    const previews = document.querySelectorAll("[data-xlsx-preview]");

    for (const container of previews) {
        const fileId = container.dataset.fileId;
        if (!fileId) continue;

        try {
            const response = await fetch(
                apiUrl(`/api/public/notes/${encodeURIComponent(noteId)}/files/${encodeURIComponent(fileId)}/preview`)
            );
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Unable to preview workbook.");

            const preview = data.preview || {};
            const sheets = preview.sheets || [];

            if (!sheets.length) {
                container.innerHTML = '<p class="sheet-preview-error">No worksheets were available to preview.</p>';
                continue;
            }

            container.innerHTML = `
                <div class="sheet-tabs" role="tablist" aria-label="Workbook sheets">
                    ${sheets.map((sheet, index) => `
                        <button
                            class="sheet-tab ${index === 0 ? "active" : ""}"
                            type="button"
                            data-sheet-index="${index}"
                            role="tab"
                            aria-selected="${index === 0 ? "true" : "false"}"
                        >
                            ${escapeHtml(sheet.name)}
                        </button>
                    `).join("")}
                </div>
                <div class="sheet-preview-content"></div>
            `;

            const content = container.querySelector(".sheet-preview-content");
            const showSheet = (index) => {
                content.innerHTML = renderSheetTable(sheets[index]);
                container.querySelectorAll(".sheet-tab").forEach((button) => {
                    const active = Number(button.dataset.sheetIndex) === index;
                    button.classList.toggle("active", active);
                    button.setAttribute("aria-selected", String(active));
                });
            };

            container.querySelectorAll(".sheet-tab").forEach((button) => {
                button.addEventListener("click", () => showSheet(Number(button.dataset.sheetIndex)));
            });

            showSheet(0);
        } catch (error) {
            container.innerHTML = `
                <p class="sheet-preview-error">
                    ${escapeHtml(error.message || "Unable to preview this workbook.")}
                </p>
            `;
        }
    }
}


function renderPresentationSlides(preview) {
    const slides = preview.slides || [];
    if (!slides.length) {
        return '<p class="ppt-preview-error">No slide text was available to preview.</p>';
    }

    return `
        <div class="ppt-preview-summary">
            <strong>${slides.length} slide${slides.length === 1 ? "" : "s"} previewed</strong>
            ${preview.truncated ? '<span>Preview limited to the first 60 slides.</span>' : ""}
        </div>
        <div class="ppt-slide-list">
            ${slides.map((slide) => {
                const body = (slide.text || [])
                    .map((line) => `<li>${escapeHtml(line)}</li>`)
                    .join("");

                return `
                    <article class="ppt-slide-card">
                        <div class="ppt-slide-number">Slide ${Number(slide.number || 0)}</div>
                        <div class="ppt-slide-content">
                            <h4>${escapeHtml(slide.title || `Slide ${slide.number}`)}</h4>
                            ${body ? `<ul>${body}</ul>` : '<p>No additional text on this slide.</p>'}
                        </div>
                    </article>
                `;
            }).join("")}
        </div>
    `;
}

async function loadNativePowerPointPreviews(noteId) {
    const previews = document.querySelectorAll("[data-pptx-preview]");

    for (const container of previews) {
        const fileId = container.dataset.fileId;
        if (!fileId) continue;

        try {
            const response = await fetch(
                apiUrl(`/api/public/notes/${encodeURIComponent(noteId)}/files/${encodeURIComponent(fileId)}/preview`)
            );
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Unable to preview presentation.");

            container.innerHTML = renderPresentationSlides(data.preview || {});
        } catch (error) {
            container.innerHTML = `
                <p class="ppt-preview-error">
                    ${escapeHtml(error.message || "Unable to preview this presentation.")}
                </p>
            `;
        }
    }
}

function renderNotes() {
    const grid = document.getElementById("notes-grid");
    const status = document.getElementById("notes-status");
    grid.innerHTML = "";

    if (notesState.notes.length === 0) {
        status.hidden = true;

        if (!notesState.dismissedEmptyCreate) {
            document.getElementById("note-form-title").textContent = "Create your first note";
            document.getElementById("note-form-submit").textContent = "Create Note";
            setCreateStatus("");
            showCreatePanel(true);
            return;
        }

        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.innerHTML = `
            <h3>Your library is ready</h3>
            <p>Create your first note whenever you are ready to start publishing or organizing study material.</p>
            <button class="button button-primary" type="button">+ Create Your First Note</button>
        `;
        empty.querySelector("button").addEventListener("click", () => {
            notesState.dismissedEmptyCreate = false;
            showCreatePanel(true);
        });
        grid.appendChild(empty);
        return;
    }

    status.hidden = true;

    notesState.notes.forEach((note) => {
        const card = document.createElement("article");
        card.className = "note-card note-card-owner";
        card.dataset.noteId = note.noteId;

        const meta = noteMeta(note);
        const metaHtml = meta.length
            ? meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("<span>·</span>")
            : "<span>Uncategorized</span>";

        const files = note.files || [];
        const fileCount = files.length;
        const published = note.visibility === "public";
        const pendingSecurityScan = files.some((file) => file.malwareScanStatus === "PENDING");
        const failedSecurityScan = files.some((file) => {
            const status = file.malwareScanStatus;
            return status && status !== "PENDING" && status !== "NO_THREATS_FOUND";
        });
        const publishBlocked = !published && (pendingSecurityScan || failedSecurityScan);
        const createdDate = note.publishedAt || note.createdAt;

        const sourceListHtml = files.length
            ? `
                <div class="owner-source-list owner-source-list-compact">
                    ${files.map((file) => `
                        <div class="owner-source-row">
                            <div class="owner-source-info">
                                <span title="${escapeHtml(file.filename || "Source file")}">
                                    ${escapeHtml(file.filename || "Source file")}
                                </span>
                                <small>${escapeHtml(formatBytes(file.sizeBytes))} · ${escapeHtml(fileSecurityLabel(file))}</small>
                            </div>
                            <div class="source-actions">
                                <button class="button button-mini" type="button" data-move-source="up" data-file-id="${escapeHtml(file.fileId || "")}" title="Move up">↑</button>
                                <button class="button button-mini" type="button" data-move-source="down" data-file-id="${escapeHtml(file.fileId || "")}" title="Move down">↓</button>
                                <button class="button button-mini" type="button" data-rename-source data-file-id="${escapeHtml(file.fileId || "")}">Rename</button>
                                <button class="button button-mini" type="button" data-replace-source data-file-id="${escapeHtml(file.fileId || "")}">Replace</button>
                                <button class="button button-danger-text" type="button" data-remove-source data-file-id="${escapeHtml(file.fileId || "")}" ${published ? 'disabled title="Unpublish this note before removing source files."' : ""}>Remove</button>
                            </div>
                        </div>
                    `).join("")}
                </div>
            `
            : '<p class="manage-empty">No source files attached yet.</p>';

        card.innerHTML = `
            <div class="owner-card-header">
                <span class="badge">${escapeHtml(note.visibility || "private")}</span>
                <span class="note-date">${escapeHtml(formatDate(createdDate))}</span>
            </div>

            <div class="owner-card-body">
                <h3>${escapeHtml(note.title || "Untitled Note")}</h3>
                <div class="note-meta">${metaHtml}</div>
                <p class="owner-note-description">${escapeHtml(note.description || "No description yet.")}</p>
            </div>

            <div class="owner-card-summary">
                <span>${fileCount} source file${fileCount === 1 ? "" : "s"}</span>
                <span class="upload-status ${escapeHtml(notesState.uploadFeedback[note.noteId]?.type || "")}" data-upload-status>${escapeHtml(notesState.uploadFeedback[note.noteId]?.message || "")}</span>
            </div>

            <div class="owner-card-actions">
                <button class="button button-primary owner-primary-action" type="button" data-edit-note>Edit Note</button>
                <button
                    class="button button-secondary"
                    type="button"
                    data-publish-note
                    ${publishBlocked ? 'disabled title="Wait for all source security scans to pass before publishing."' : ""}
                >
                    ${published ? "Unpublish" : "Publish"}
                </button>
                <button class="button button-text manage-toggle" type="button" data-manage-note aria-expanded="false">
                    Manage ▾
                </button>
            </div>

            <div class="owner-manage-panel" data-manage-panel hidden>
                <div class="owner-manage-section">
                    <div class="owner-manage-heading">
                        <div>
                            <strong>Source files</strong>
                            <span>${fileCount}/10</span>
                        </div>
                        <button class="button button-secondary" type="button" data-upload-note ${notesState.uploadInProgress ? "disabled" : ""}>
                            ${notesState.uploadInProgress ? "Upload in progress…" : "+ Add Source"}
                        </button>
                    </div>
                    ${sourceListHtml}
                </div>

                <div class="owner-danger-row">
                    <span>Delete this note and all of its source files.</span>
                    <button class="button button-danger" type="button" data-delete-note>Delete Note</button>
                </div>
            </div>
        `;

        card.querySelector("[data-edit-note]").addEventListener("click", () => {
            startEditNote(note);
        });

        card.querySelector("[data-manage-note]").addEventListener("click", (event) => {
            const button = event.currentTarget;
            const panel = card.querySelector("[data-manage-panel]");
            const opening = panel.hidden;
            panel.hidden = !opening;
            button.setAttribute("aria-expanded", String(opening));
            button.textContent = opening ? "Manage ▴" : "Manage ▾";
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
                if (fileId) deleteSourceFile(note, fileId);
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
        notesState.dismissedEmptyCreate = false;
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

        updateStatus(
            replaceFileId
                ? "Replaced. Security scan in progress…"
                : "Uploaded. Security scan in progress…",
            "success"
        );
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
    if (note.visibility === "public") {
        alert("Unpublish this note before removing a source file.");
        return;
    }

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
        const response = await adminFetch("/api/admin/analytics?probe=1");
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
        const response = await adminFetch("/api/admin/analytics");
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
        renderAnalyticsList("analytics-collections", data.topCollections || [], "No topics yet.");

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

function refreshExploreTopicFilter() {
    const subjectSelect = document.getElementById("public-subject");
    const topicSelect = document.getElementById("public-collection");
    if (!subjectSelect || !topicSelect) return;

    const selectedSubject = subjectSelect.value;
    const currentTopic = topicSelect.value;

    let topics = publicTaxonomy.topics || [];
    if (selectedSubject) {
        const subjectKey = Object.keys(publicTaxonomy.subjectTopics || {}).find(
            (key) => key.toLowerCase() === selectedSubject.toLowerCase()
        );
        topics = subjectKey ? publicTaxonomy.subjectTopics[subjectKey] : [];
    }

    const normalizedTopics = normalizeOptions(topics);
    topicSelect.innerHTML = ['<option value="">All topics</option>']
        .concat(
            normalizedTopics.map(
                (item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`
            )
        )
        .join("");

    topicSelect.value = normalizedTopics.includes(currentTopic) ? currentTopic : "";
}

function renderActivePublicFilters(query, subject, collection, sort) {
    const container = document.getElementById("public-active-filters");
    const items = [];

    if (query) items.push(`Search: ${query}`);
    if (subject) items.push(`Subject: ${subject}`);
    if (collection) items.push(`Topic: ${collection}`);
    if (sort && sort !== "newest") {
        const labels = {
            oldest: "Oldest",
            title: "Title A–Z",
            views: "Most viewed"
        };
        items.push(`Sort: ${labels[sort] || sort}`);
    }

    container.innerHTML = items.length
        ? items.map((item) => `<span class="active-filter-chip">${escapeHtml(item)}</span>`).join("")
        : '<span class="active-filter-empty">No filters applied</span>';
}

async function loadPublicNotes() {
    const grid = document.getElementById("public-grid");
    const detail = document.getElementById("public-note-detail");
    const query = document.getElementById("public-search").value.trim();
    const subject = document.getElementById("public-subject").value;
    const collection = document.getElementById("public-collection").value;
    const sort = document.getElementById("public-sort").value;
    const pageSize = Number(document.getElementById("public-page-size").value || notesState.publicPageSize || 18);
    notesState.publicPageSize = pageSize;

    detail.hidden = true;
    document.querySelector(".explore-controls")?.removeAttribute("hidden");
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
        url.searchParams.set("pageSize", String(pageSize));

        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load public notes.");

        const notes = data.notes || [];
        applyPublicTaxonomy(data);
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

        refreshExploreTopicFilter();

        notesState.publicPage = data.page || 1;
        notesState.publicTotalPages = data.totalPages || 1;
        const pagination = document.getElementById("public-pagination");
        const pageLabel = document.getElementById("public-page-label");
        const total = Number(data.total || 0);
        const startItem = total ? ((notesState.publicPage - 1) * pageSize) + 1 : 0;
        const endItem = total ? Math.min(notesState.publicPage * pageSize, total) : 0;

        pagination.hidden = (data.totalPages || 1) <= 1;
        pageLabel.textContent = `Page ${notesState.publicPage} of ${notesState.publicTotalPages}`;
        document.getElementById("public-result-summary").textContent =
            total === 1 ? "1 public note" : `${total.toLocaleString()} public notes`;
        document.getElementById("public-page-summary").textContent =
            total ? `Showing ${startItem.toLocaleString()}–${endItem.toLocaleString()}` : "No matching notes";
        renderActivePublicFilters(query, subject, collection, sort);

        document.getElementById("public-first-page").disabled = notesState.publicPage <= 1;
        document.getElementById("public-prev-page").disabled = notesState.publicPage <= 1;
        document.getElementById("public-next-page").disabled = notesState.publicPage >= notesState.publicTotalPages;
        document.getElementById("public-last-page").disabled = notesState.publicPage >= notesState.publicTotalPages;

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
            card.className = "public-note-card";
            card.tabIndex = 0;
            card.setAttribute("role", "button");
            card.setAttribute("aria-label", `Open ${note.title || "public note"}`);

            const subjectLabel = note.subject || "General";
            const collectionLabel = note.collection || "";
            const fileCount = Number(note.fileCount || 0);
            const viewCount = Number(note.viewCount || 0);

            card.innerHTML = `
                <div class="public-note-card-top">
                    <span class="subject-chip">${escapeHtml(subjectLabel)}</span>
                    <span class="note-date">${escapeHtml(formatDate(note.publishedAt))}</span>
                </div>

                <div class="public-note-card-body">
                    <h3>${escapeHtml(note.title || "Untitled note")}</h3>
                    ${collectionLabel ? `<p class="public-note-collection">${escapeHtml(collectionLabel)}</p>` : ""}
                    <p class="public-note-description">${escapeHtml(note.description || "No description provided.")}</p>
                </div>

                <div class="public-note-card-footer">
                    <span>By ${escapeHtml(note.publicAuthor || "Community member")}</span>
                    <div class="public-note-stats">
                        <span>${fileCount} file${fileCount === 1 ? "" : "s"}</span>
                        <span>${viewCount.toLocaleString()} view${viewCount === 1 ? "" : "s"}</span>
                    </div>
                </div>
            `;

            const openCard = () => openPublicNote(note.noteId);
            card.addEventListener("click", openCard);
            card.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openCard();
                }
            });

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
        const publishedDate = formatDate(note.publishedAt);

        if (updateUrl) {
            const url = new URL(window.location.href);
            url.searchParams.set("note", noteId);
            window.history.replaceState({}, "", url);
        }

        const sourceIndex = files.length > 1
            ? `
                <nav class="public-source-index" aria-label="Source files">
                    ${files.map((file, index) => {
                        const sourceId = `source-${escapeHtml(file.fileId || String(index + 1))}`;
                        return `
                            <a href="#${sourceId}" class="public-source-index-item">
                                <span>${index + 1}</span>
                                <strong>${escapeHtml(file.filename || `Source ${index + 1}`)}</strong>
                            </a>
                        `;
                    }).join("")}
                </nav>
            `
            : "";

        content.innerHTML = `
            <section class="public-note-hero">
                <div class="public-note-hero-main">
                    <div class="public-note-taxonomy">
                        ${note.subject ? `<span class="subject-chip">${escapeHtml(note.subject)}</span>` : ""}
                        ${note.collection ? `<span class="public-topic-label">${escapeHtml(note.collection)}</span>` : ""}
                    </div>
                    <h2>${escapeHtml(note.title)}</h2>
                    <p class="public-note-full-description">${escapeHtml(note.description || "No description provided.")}</p>
                </div>

                <div class="public-note-hero-side">
                    <div class="public-note-byline">
                        <strong>${escapeHtml(note.publicAuthor || "Community member")}</strong>
                        <span>${Number(note.viewCount || 0)} view${Number(note.viewCount || 0) === 1 ? "" : "s"}</span>
                        ${publishedDate ? `<span>Published ${escapeHtml(publishedDate)}</span>` : ""}
                    </div>
                    <button id="share-public-note" class="button button-secondary" type="button">Copy Share Link</button>
                </div>
            </section>

            <section class="public-sources-section">
                <div class="public-sources-heading">
                    <div>
                        <p class="eyebrow">Source material</p>
                        <h3>${files.length} source file${files.length === 1 ? "" : "s"}</h3>
                    </div>
                    ${files.length > 1 ? '<span class="status-text">Jump to a source below</span>' : ""}
                </div>

                ${sourceIndex}

                <div class="source-viewer-list">
                    ${files.length
                        ? files.map((file, index) => renderEmbeddedSource(file, index)).join("")
                        : '<p class="note-description">No source files are available for this note.</p>'}
                </div>
            </section>
        `;

        grid.hidden = true;
        document.querySelector(".explore-controls")?.setAttribute("hidden", "");
        document.getElementById("public-status").hidden = true;
        detail.hidden = false;
        document.getElementById("share-public-note")?.addEventListener("click", (event) => sharePublicNote(noteId, event));
        await Promise.all([
            loadNativeExcelPreviews(noteId),
            loadNativePowerPointPreviews(noteId)
        ]);
    } catch (error) {
        detail.hidden = true;
        content.innerHTML = "";
        document.querySelector(".explore-controls")?.removeAttribute("hidden");
        grid.hidden = false;
        setPublicStatus(error.message || "Unable to open note.", true);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    renderSignedInState();
    await loadPublicTaxonomy();

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
        notesState.dismissedEmptyCreate = false;
        notesState.editingNoteId = null;
        document.getElementById("create-note-form").reset();
        document.getElementById("note-form-title").textContent = "Create a note";
        document.getElementById("note-form-submit").textContent = "Create Note";
        setCreateStatus("");
        showCreatePanel(true);
    });
    document.getElementById("cancel-note-btn").addEventListener("click", () => {
        if (notesState.notes.length === 0) {
            notesState.dismissedEmptyCreate = true;
        }
        showCreatePanel(false);
        if (notesState.notes.length === 0) {
            renderNotes();
        }
    });
    document.getElementById("profile-form").addEventListener("submit", saveProfile);
    document.getElementById("settings-profile-form").addEventListener("submit", saveSettingsProfile);
    document.getElementById("create-note-form").addEventListener("submit", createNote);
    document.getElementById("note-upload-input").addEventListener("change", handleUploadSelection);
    setupSearchSelects();
    document.getElementById("public-search-btn").addEventListener("click", () => {
        notesState.publicPage = 1;
        loadPublicNotes();
    });
    document.getElementById("public-search-clear").addEventListener("click", () => {
        document.getElementById("public-search").value = "";
        document.getElementById("public-subject").value = "";
        document.getElementById("public-collection").value = "";
        document.getElementById("public-sort").value = "newest";
        document.getElementById("public-page-size").value = "18";
        notesState.publicPageSize = 18;
        notesState.publicPage = 1;
        loadPublicNotes();
    });
    document.getElementById("public-subject").addEventListener("change", () => {
        notesState.publicPage = 1;
        refreshExploreTopicFilter();
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
    document.getElementById("public-page-size").addEventListener("change", () => {
        notesState.publicPage = 1;
        notesState.publicPageSize = Number(document.getElementById("public-page-size").value || 18);
        loadPublicNotes();
    });
    document.getElementById("public-first-page").addEventListener("click", () => {
        if (notesState.publicPage > 1) {
            notesState.publicPage = 1;
            loadPublicNotes();
        }
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
    document.getElementById("public-last-page").addEventListener("click", () => {
        if (notesState.publicPage < notesState.publicTotalPages) {
            notesState.publicPage = notesState.publicTotalPages;
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
