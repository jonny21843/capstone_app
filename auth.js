function base64UrlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";

    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function generateRandomString(length = 64) {
    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const randomValues = new Uint8Array(length);

    crypto.getRandomValues(randomValues);

    return Array.from(randomValues)
        .map((value) => characters[value % characters.length])
        .join("");
}

async function createPkceChallenge(verifier) {
    const encoded = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", encoded);

    return base64UrlEncode(digest);
}

async function signIn() {
    const verifier = generateRandomString(64);
    const challenge = await createPkceChallenge(verifier);
    const state = generateRandomString(32);

    sessionStorage.setItem("pkce_code_verifier", verifier);
    sessionStorage.setItem("oauth_state", state);

    const params = new URLSearchParams({
        response_type: "code",
        client_id: APP_CONFIG.cognitoClientId,
        redirect_uri: APP_CONFIG.cognitoRedirectUri,
        scope: "openid email profile",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256"
    });

    window.location.assign(
        `${APP_CONFIG.cognitoDomain}/oauth2/authorize?${params.toString()}`
    );
}

function clearTokens() {
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("id_token");
    sessionStorage.removeItem("refresh_token");
    sessionStorage.removeItem("token_expires_at");
}

function signOut() {
    clearTokens();

    const params = new URLSearchParams({
        client_id: APP_CONFIG.cognitoClientId,
        logout_uri: APP_CONFIG.cognitoLogoutUri
    });

    window.location.assign(
        `${APP_CONFIG.cognitoDomain}/logout?${params.toString()}`
    );
}

function getAccessToken() {
    return sessionStorage.getItem("access_token");
}

function isAuthenticated() {
    const token = getAccessToken();
    const expiresAt = Number(sessionStorage.getItem("token_expires_at"));

    return Boolean(token && expiresAt && Date.now() < expiresAt);
}

async function loadCurrentUser() {
    const token = getAccessToken();

    if (!token) {
        return null;
    }

    const response = await fetch("/api/me", {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    if (!response.ok) {
        clearTokens();
        return null;
    }

    return response.json();
}

async function updateAuthUi() {
    const status = document.getElementById("auth-status");
    const signInButton = document.getElementById("sign-in-btn");
    const signOutButton = document.getElementById("sign-out-btn");

    if (!status || !signInButton || !signOutButton) {
        return;
    }

    if (!isAuthenticated()) {
        status.textContent = "Not signed in";
        signInButton.hidden = false;
        signOutButton.hidden = true;
        return;
    }

    status.textContent = "Checking session...";
    signInButton.hidden = true;
    signOutButton.hidden = false;

    try {
        const user = await loadCurrentUser();

        if (!user) {
            status.textContent = "Not signed in";
            signInButton.hidden = false;
            signOutButton.hidden = true;
            return;
        }

        status.textContent = user.username
            ? `Signed in as ${user.username}`
            : "Signed in";
    } catch (error) {
        console.error("Unable to verify current user:", error);
        status.textContent = "Signed in";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document
        .getElementById("sign-in-btn")
        ?.addEventListener("click", signIn);

    document
        .getElementById("sign-out-btn")
        ?.addEventListener("click", signOut);

    updateAuthUi();
});
