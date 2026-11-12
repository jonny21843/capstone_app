async function handleCallback() {
    const status = document.getElementById("status");
    const params = new URLSearchParams(window.location.search);

    const code = params.get("code");
    const returnedState = params.get("state");
    const oauthError = params.get("error");
    const oauthErrorDescription = params.get("error_description");

    if (oauthError) {
        status.textContent =
            oauthErrorDescription || `Authentication failed: ${oauthError}`;
        return;
    }

    if (!code) {
        status.textContent = "No authorization code received.";
        return;
    }

    const expectedState = sessionStorage.getItem("oauth_state");

    if (!expectedState || returnedState !== expectedState) {
        status.textContent = "Authentication state verification failed.";
        return;
    }

    const verifier = sessionStorage.getItem("pkce_code_verifier");

    if (!verifier) {
        status.textContent = "PKCE verifier is missing. Please sign in again.";
        return;
    }

    try {
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: APP_CONFIG.cognitoClientId,
            code,
            redirect_uri: APP_CONFIG.cognitoRedirectUri,
            code_verifier: verifier
        });

        const response = await fetch(
            `${APP_CONFIG.cognitoDomain}/oauth2/token`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText);
        }

        const tokens = await response.json();

        sessionStorage.setItem("access_token", tokens.access_token);
        sessionStorage.setItem("id_token", tokens.id_token);

        if (tokens.refresh_token) {
            sessionStorage.setItem("refresh_token", tokens.refresh_token);
        }

        sessionStorage.setItem(
            "token_expires_at",
            String(Date.now() + tokens.expires_in * 1000)
        );

        sessionStorage.removeItem("pkce_code_verifier");
        sessionStorage.removeItem("oauth_state");

        status.textContent = "Signed in successfully. Redirecting...";
        window.location.replace("/");
    } catch (error) {
        console.error("Token exchange failed:", error);
        status.textContent = "Unable to complete sign in. Please try again.";
    }
}

handleCallback();
