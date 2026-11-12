import json
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def current_user_id(event):
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
        .get("sub")
    )


def lambda_handler(event, context):
    user_id = current_user_id(event)
    if not user_id:
        return response(401, {"error": "Authenticated user ID is missing"})

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
        if not (note.get("description") or "").strip():
            return response(400, {"error": "Add a description before publishing"})
        if not note.get("files"):
            return response(400, {"error": "Upload at least one source file before publishing"})

        result = table.update_item(
            Key={"userId": user_id, "noteId": note_id},
            UpdateExpression=(
                "SET visibility = :public, publishedAt = :published_at, "
                "updatedAt = :updated"
            ),
            ExpressionAttributeValues={
                ":public": "public",
                ":published_at": now,
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
