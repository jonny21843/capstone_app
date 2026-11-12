import json
from decimal import Decimal
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])


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

    title = (payload.get("title") or "").strip()
    subject = (payload.get("subject") or "").strip()
    collection = (payload.get("collection") or "").strip()
    description = (payload.get("description") or "").strip()

    if not title:
        return response(400, {"error": "title is required"})

    if len(title) > 160:
        return response(400, {"error": "title must be 160 characters or fewer"})

    if len(subject) > 100:
        return response(400, {"error": "subject must be 100 characters or fewer"})

    if len(collection) > 120:
        return response(400, {"error": "collection must be 120 characters or fewer"})

    if len(description) > 1200:
        return response(400, {"error": "description must be 1200 characters or fewer"})

    now = datetime.now(timezone.utc).isoformat()

    try:
        result = table.update_item(
            Key={"userId": user_id, "noteId": note_id},
            UpdateExpression=(
                "SET title = :title, subject = :subject, #collection = :collection, "
                "description = :description, updatedAt = :updated"
            ),
            ConditionExpression="attribute_exists(userId) AND attribute_exists(noteId)",
            ExpressionAttributeNames={"#collection": "collection"},
            ExpressionAttributeValues={
                ":title": title,
                ":subject": subject,
                ":collection": collection,
                ":description": description,
                ":updated": now,
            },
            ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return response(404, {"error": "Note not found"})
        raise

    return response(200, {"note": result.get("Attributes", {})})
