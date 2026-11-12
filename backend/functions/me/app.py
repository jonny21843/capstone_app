import json


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json"
        },
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    authorizer = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
    )
    claims = authorizer.get("claims", {})

    if claims.get("token_use") != "access":
        return response(403, {"error": "Access token required"})

    user_id = claims.get("sub")

    if not user_id:
        return response(401, {"error": "Authenticated user ID is missing"})

    return response(
        200,
        {
            "userId": user_id,
            "username": claims.get("username"),
        },
    )
