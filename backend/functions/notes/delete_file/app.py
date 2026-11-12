import json
import os
from datetime import datetime, timezone

import boto3


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])
s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-2"))
bucket_name = os.environ["NOTES_BUCKET"]


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

    params = event.get("pathParameters") or {}
    note_id = params.get("noteId")
    file_id = params.get("fileId")

    if not note_id or not file_id:
        return response(400, {"error": "noteId and fileId are required"})

    note = table.get_item(Key={"userId": user_id, "noteId": note_id}).get("Item")
    if not note:
        return response(404, {"error": "Note not found"})

    files = note.get("files") or []
    target = next((item for item in files if item.get("fileId") == file_id), None)
    if not target:
        return response(404, {"error": "Source file not found"})

    key = target.get("key")
    if key:
        s3.delete_object(Bucket=bucket_name, Key=key)

    remaining = [item for item in files if item.get("fileId") != file_id]
    now = datetime.now(timezone.utc).isoformat()

    update_expression = "SET #files = :files, updatedAt = :updated"
    values = {":files": remaining, ":updated": now}

    if not remaining:
        update_expression += ", processingStatus = :created"
        values[":created"] = "created"

    result = table.update_item(
        Key={"userId": user_id, "noteId": note_id},
        UpdateExpression=update_expression,
        ExpressionAttributeNames={"#files": "files"},
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )

    return response(200, {"note": result.get("Attributes", {})})
