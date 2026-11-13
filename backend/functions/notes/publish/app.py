import json
from decimal import Decimal
import os
from datetime import datetime, timezone

import boto3


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])
cognito = boto3.client("cognito-idp")
s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-2"))
user_pool_id = os.environ["COGNITO_USER_POOL_ID"]
bucket_name = os.environ["NOTES_BUCKET"]


def json_default(value):
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=json_default),
    }


def claims(event):
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )


def current_user_id(event):
    return claims(event).get("sub")


def current_username(event):
    current = claims(event)
    return current.get("username") or current.get("cognito:username")


def refresh_malware_scan_statuses(note):
    files = [dict(item) for item in (note.get("files") or [])]
    changed = False

    for item in files:
        current = (item.get("malwareScanStatus") or "").upper()
        if current == "NO_THREATS_FOUND":
            continue

        key = item.get("key")
        if not key:
            continue

        try:
            result = s3.get_object_tagging(Bucket=bucket_name, Key=key)
        except Exception:
            continue

        tags = {tag.get("Key"): tag.get("Value") for tag in result.get("TagSet", [])}
        actual = (tags.get("GuardDutyMalwareScanStatus") or "").upper()
        if actual and actual != current:
            item["malwareScanStatus"] = actual
            changed = True

    if changed:
        now = datetime.now(timezone.utc).isoformat()
        result = table.update_item(
            Key={"userId": note["userId"], "noteId": note["noteId"]},
            UpdateExpression="SET #files = :files, updatedAt = :updated",
            ExpressionAttributeNames={"#files": "files"},
            ExpressionAttributeValues={
                ":files": files,
                ":updated": now,
            },
            ReturnValues="ALL_NEW",
        )
        return result.get("Attributes", note)

    refreshed = dict(note)
    refreshed["files"] = files
    return refreshed


def public_author_for_user(username):
    user = cognito.admin_get_user(
        UserPoolId=user_pool_id,
        Username=username,
    )
    attributes = {
        item["Name"]: item.get("Value", "")
        for item in user.get("UserAttributes", [])
    }

    first_name = (attributes.get("given_name") or "").strip()
    last_name = (attributes.get("family_name") or "").strip()

    if not first_name or not last_name:
        return None

    return f"{first_name} {last_name[0].upper()}."


def lambda_handler(event, context):
    user_id = current_user_id(event)
    username = current_username(event)

    if not user_id or not username:
        return response(401, {"error": "Authenticated user identity is missing"})

    note_id = (event.get("pathParameters") or {}).get("noteId")
    if not note_id:
        return response(400, {"error": "noteId is required"})

    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"error": "Request body must be valid JSON"})

    published = payload.get("published")
    if not isinstance(published, bool):
        return response(400, {"error": "published must be true or false"})

    note = table.get_item(Key={"userId": user_id, "noteId": note_id}).get("Item")
    if not note:
        return response(404, {"error": "Note not found"})

    now = datetime.now(timezone.utc).isoformat()

    if published:
        note = refresh_malware_scan_statuses(note)
        if not (note.get("description") or "").strip():
            return response(400, {"error": "Add a description before publishing"})
        files = note.get("files") or []
        if not files:
            return response(400, {"error": "Upload at least one source file before publishing"})

        blocked_files = [
            item for item in files
            if item.get("malwareScanStatus") not in (None, "NO_THREATS_FOUND")
        ]
        if blocked_files:
            pending = any(item.get("malwareScanStatus") == "PENDING" for item in blocked_files)
            message = (
                "Source file security scan is still in progress. Try publishing again shortly."
                if pending
                else "One or more source files did not pass the security scan and cannot be published."
            )
            return response(409, {"error": message})

        author_display_name = public_author_for_user(username)
        if not author_display_name:
            return response(400, {"error": "Complete your first and last name before publishing"})

        result = table.update_item(
            Key={"userId": user_id, "noteId": note_id},
            UpdateExpression=(
                "SET visibility = :public, publishedAt = :published_at, "
                "publicAuthor = :public_author, updatedAt = :updated"
            ),
            ExpressionAttributeValues={
                ":public": "public",
                ":published_at": now,
                ":public_author": author_display_name,
                ":updated": now,
            },
            ReturnValues="ALL_NEW",
        )
    else:
        result = table.update_item(
            Key={"userId": user_id, "noteId": note_id},
            UpdateExpression="SET visibility = :private, updatedAt = :updated REMOVE publishedAt",
            ExpressionAttributeValues={
                ":private": "private",
                ":updated": now,
            },
            ReturnValues="ALL_NEW",
        )

    return response(200, {"note": result.get("Attributes", {})})
