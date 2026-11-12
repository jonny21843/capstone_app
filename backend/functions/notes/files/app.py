import json
from decimal import Decimal
import os
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])
bucket_name = os.environ["NOTES_BUCKET"]
max_file_bytes = int(os.environ.get("MAX_FILE_BYTES", str(20 * 1024 * 1024)))
max_files_per_note = int(os.environ.get("MAX_FILES_PER_NOTE", "10"))
s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-2"))

ALLOWED_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


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

    key = (payload.get("key") or "").strip()
    filename = (payload.get("filename") or "").strip()
    content_type = (payload.get("contentType") or "").strip().lower()

    expected_prefix = f"users/{user_id}/notes/{note_id}/original/"
    if not key.startswith(expected_prefix):
        return response(400, {"error": "Invalid file key for this note"})

    if not filename:
        return response(400, {"error": "filename is required"})

    note = table.get_item(Key={"userId": user_id, "noteId": note_id}).get("Item")
    if not note:
        s3.delete_object(Bucket=bucket_name, Key=key)
        return response(404, {"error": "Note not found"})

    if len(note.get("files") or []) >= max_files_per_note:
        s3.delete_object(Bucket=bucket_name, Key=key)
        return response(
            400,
            {"error": f"A note can have at most {max_files_per_note} source files"},
        )

    if content_type not in ALLOWED_TYPES:
        s3.delete_object(Bucket=bucket_name, Key=key)
        return response(400, {"error": "Unsupported uploaded file type"})

    try:
        metadata = s3.head_object(Bucket=bucket_name, Key=key)
    except ClientError:
        s3.delete_object(Bucket=bucket_name, Key=key)
        return response(400, {"error": "Uploaded file could not be verified"})

    actual_size = int(metadata.get("ContentLength") or 0)
    actual_type = (metadata.get("ContentType") or "").lower()

    if actual_size <= 0 or actual_size > max_file_bytes:
        s3.delete_object(Bucket=bucket_name, Key=key)
        return response(
            400,
            {"error": f"Uploaded file exceeds the {max_file_bytes // (1024 * 1024)} MB limit"},
        )

    if actual_type not in ALLOWED_TYPES or actual_type != content_type:
        s3.delete_object(Bucket=bucket_name, Key=key)
        return response(400, {"error": "Uploaded file type verification failed"})

    now = datetime.now(timezone.utc).isoformat()
    file_record = {
        "fileId": str(uuid.uuid4()),
        "key": key,
        "filename": filename[:240],
        "contentType": actual_type,
        "sizeBytes": actual_size,
        "uploadedAt": now,
    }

    try:
        result = table.update_item(
            Key={"userId": user_id, "noteId": note_id},
            UpdateExpression=(
                "SET #files = list_append(if_not_exists(#files, :empty), :new_file), "
                "processingStatus = :uploaded, updatedAt = :updated"
            ),
            ConditionExpression=(
                "attribute_exists(userId) AND attribute_exists(noteId) AND "
                "(attribute_not_exists(#files) OR size(#files) < :max_files)"
            ),
            ExpressionAttributeNames={"#files": "files"},
            ExpressionAttributeValues={
                ":empty": [],
                ":new_file": [file_record],
                ":uploaded": "uploaded",
                ":updated": now,
                ":max_files": max_files_per_note,
            },
            ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            s3.delete_object(Bucket=bucket_name, Key=key)
            return response(
                409,
                {"error": f"Unable to register file. The note may already have {max_files_per_note} source files"},
            )
        raise

    return response(200, {"note": result.get("Attributes", {}), "file": file_record})
