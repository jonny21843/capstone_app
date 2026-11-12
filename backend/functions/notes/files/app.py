import json
import os
import uuid
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

    key = (payload.get("key") or "").strip()
    filename = (payload.get("filename") or "").strip()
    content_type = (payload.get("contentType") or "application/octet-stream").strip()

    expected_prefix = f"users/{user_id}/notes/{note_id}/original/"
    if not key.startswith(expected_prefix):
        return response(400, {"error": "Invalid file key for this note"})

    if not filename:
        return response(400, {"error": "filename is required"})

    now = datetime.now(timezone.utc).isoformat()
    file_record = {
        "fileId": str(uuid.uuid4()),
        "key": key,
        "filename": filename[:240],
        "contentType": content_type[:120],
        "uploadedAt": now,
    }

    try:
        result = table.update_item(
            Key={"userId": user_id, "noteId": note_id},
            UpdateExpression=(
                "SET #files = list_append(if_not_exists(#files, :empty), :new_file), "
                "processingStatus = :uploaded, updatedAt = :updated"
            ),
            ConditionExpression="attribute_exists(userId) AND attribute_exists(noteId)",
            ExpressionAttributeNames={"#files": "files"},
            ExpressionAttributeValues={
                ":empty": [],
                ":new_file": [file_record],
                ":uploaded": "uploaded",
                ":updated": now,
            },
            ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return response(404, {"error": "Note not found"})
        raise

    return response(200, {"note": result.get("Attributes", {}), "file": file_record})
