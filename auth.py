import os
from functools import wraps

import jwt
from flask import g, jsonify, request
from jwt import PyJWKClient


AWS_REGION = os.environ.get("AWS_REGION", "us-east-2")
COGNITO_USER_POOL_ID = os.environ.get(
    "COGNITO_USER_POOL_ID",
    "us-east-2_sZ3qWdfwv",
)
COGNITO_APP_CLIENT_ID = os.environ.get(
    "COGNITO_APP_CLIENT_ID",
    "3t79knetd0pdav5jsso0osfb1e",
)

COGNITO_ISSUER = (
    f"https://cognito-idp.{AWS_REGION}.amazonaws.com/"
    f"{COGNITO_USER_POOL_ID}"
)
JWKS_URL = f"{COGNITO_ISSUER}/.well-known/jwks.json"

jwk_client = PyJWKClient(JWKS_URL)


def verify_access_token(token: str) -> dict:
    signing_key = jwk_client.get_signing_key_from_jwt(token)

    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        issuer=COGNITO_ISSUER,
        options={"verify_aud": False},
    )

    if claims.get("token_use") != "access":
        raise jwt.InvalidTokenError("Expected a Cognito access token")

    if claims.get("client_id") != COGNITO_APP_CLIENT_ID:
        raise jwt.InvalidTokenError("Incorrect Cognito app client")

    return claims


def require_auth(view_function):
    @wraps(view_function)
    def wrapped(*args, **kwargs):
        authorization = request.headers.get("Authorization", "")

        if not authorization.startswith("Bearer "):
            return jsonify({"error": "Authentication required"}), 401

        token = authorization.removeprefix("Bearer ").strip()

        try:
            claims = verify_access_token(token)
        except (jwt.PyJWTError, ValueError):
            return jsonify({"error": "Invalid or expired token"}), 401

        g.user_id = claims["sub"]
        g.user_claims = claims

        return view_function(*args, **kwargs)

    return wrapped
