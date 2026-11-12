import json
import os
import uuid
from datetime import datetime, timezone

import boto3


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

    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"error": "Request body must be valid JSON"})

    title = (payload.get("title") or "").strip()
    subject = (payload.get("subject") or "").strip()
    collection = (payload.get("collection") or "").strip()
    description = (payload.get("description") or "").strip()

    if not title:
        return response(400, {"error": "title is required"})

    if len(description) > 1200:
        return response(400, {"error": "description must be 1200 characters or fewer"})

    note_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    item = {
        "userId": user_id,
        "noteId": note_id,
        "title": title,
        "subject": subject,
        "collection": collection,
        "description": description,
        "files": [],
        "visibility": "private",
        "processingStatus": "created",
        "createdAt": now,
        "updatedAt": now,
    }

    table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(userId) AND attribute_not_exists(noteId)",
    )

    return response(201, {"note": item})
