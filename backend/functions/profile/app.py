import json
import os

import boto3


cognito = boto3.client("cognito-idp")
user_pool_id = os.environ["COGNITO_USER_POOL_ID"]


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def claims(event):
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )


def username_from_event(event):
    return claims(event).get("username")


def attribute_map(user):
    return {
        item["Name"]: item.get("Value", "")
        for item in user.get("UserAttributes", [])
    }


def public_author(first_name, last_name):
    first = (first_name or "").strip()
    last = (last_name or "").strip()

    if first and last:
        return f"{first} {last[0].upper()}."

    return None


def get_profile(username):
    user = cognito.admin_get_user(
        UserPoolId=user_pool_id,
        Username=username,
    )
    attributes = attribute_map(user)
    first_name = attributes.get("given_name", "")
    last_name = attributes.get("family_name", "")

    return {
        "firstName": first_name,
        "lastName": last_name,
        "complete": bool(first_name.strip() and last_name.strip()),
        "publicAuthor": public_author(first_name, last_name),
    }


def lambda_handler(event, context):
    username = username_from_event(event)
    if not username:
        return response(401, {"error": "Authenticated username is missing"})

    method = (
        event.get("requestContext", {})
        .get("http", {})
        .get("method", "GET")
        .upper()
    )

    if method == "GET":
        return response(200, {"profile": get_profile(username)})

    if method != "PATCH":
        return response(405, {"error": "Method not allowed"})

    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"error": "Request body must be valid JSON"})

    first_name = (payload.get("firstName") or "").strip()
    last_name = (payload.get("lastName") or "").strip()

    if not first_name or not last_name:
        return response(400, {"error": "First name and last name are required"})

    if len(first_name) > 60 or len(last_name) > 60:
        return response(400, {"error": "Names must be 60 characters or fewer"})

    cognito.admin_update_user_attributes(
        UserPoolId=user_pool_id,
        Username=username,
        UserAttributes=[
            {"Name": "given_name", "Value": first_name},
            {"Name": "family_name", "Value": last_name},
        ],
    )

    return response(
        200,
        {
            "profile": {
                "firstName": first_name,
                "lastName": last_name,
                "complete": True,
                "publicAuthor": public_author(first_name, last_name),
            }
        },
    )
