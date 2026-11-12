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


def note_for_user(user_id, note_id):
    return table.get_item(Key={"userId": user_id, "noteId": note_id}).get("Item")


def register_file(user_id, note_id, payload):
    key = (payload.get("key") or "").strip()
    filename = (payload.get("filename") or "").strip()
    content_type = (payload.get("contentType") or "").strip().lower()
    replace_file_id = (payload.get("replaceFileId") or "").strip()

    expected_prefix = f"users/{user_id}/notes/{note_id}/original/"
    if not key.startswith(expected_prefix):
        return response(400, {"error": "Invalid file key for this note"})

    if not filename:
        return response(400, {"error": "filename is required"})

    note = note_for_user(user_id, note_id)
    if not note:
        s3.delete_object(Bucket=bucket_name, Key=key)
        return response(404, {"error": "Note not found"})

    files = note.get("files") or []
    replace_index = None
    replace_target = None
    if replace_file_id:
        for index, item in enumerate(files):
            if item.get("fileId") == replace_file_id:
                replace_index = index
                replace_target = item
                break
        if replace_index is None:
            s3.delete_object(Bucket=bucket_name, Key=key)
            return response(404, {"error": "Source file to replace was not found"})
    elif len(files) >= max_files_per_note:
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
        "fileId": replace_file_id or str(uuid.uuid4()),
        "key": key,
        "filename": filename[:240],
        "contentType": actual_type,
        "sizeBytes": actual_size,
        "uploadedAt": now,
    }

    try:
        if replace_index is not None:
            result = table.update_item(
                Key={"userId": user_id, "noteId": note_id},
                UpdateExpression=(
                    f"SET #files[{replace_index}] = :new_file, "
                    "processingStatus = :uploaded, updatedAt = :updated"
                ),
                ConditionExpression=(
                    f"attribute_exists(userId) AND attribute_exists(noteId) AND "
                    f"#files[{replace_index}].#file_id = :replace_id"
                ),
                ExpressionAttributeNames={
                    "#files": "files",
                    "#file_id": "fileId",
                },
                ExpressionAttributeValues={
                    ":new_file": file_record,
                    ":uploaded": "uploaded",
                    ":updated": now,
                    ":replace_id": replace_file_id,
                },
                ReturnValues="ALL_NEW",
            )
        else:
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
        s3.delete_object(Bucket=bucket_name, Key=key)
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return response(
                409,
                {"error": "This note changed while saving the file. Please retry."},
            )
        raise

    if replace_target and replace_target.get("key") and replace_target.get("key") != key:
        s3.delete_object(Bucket=bucket_name, Key=replace_target["key"])

    return response(200, {"note": result.get("Attributes", {}), "file": file_record})


def update_file_metadata(user_id, note_id, file_id, payload):
    note = note_for_user(user_id, note_id)
    if not note:
        return response(404, {"error": "Note not found"})

    files = note.get("files") or []
    index = next((i for i, item in enumerate(files) if item.get("fileId") == file_id), None)
    if index is None:
        return response(404, {"error": "Source file not found"})

    action = (payload.get("action") or "rename").strip().lower()
    updated_files = [dict(item) for item in files]

    if action == "rename":
        filename = (payload.get("filename") or "").strip()
        if not filename:
            return response(400, {"error": "filename is required"})
        if len(filename) > 240:
            return response(400, {"error": "filename must be 240 characters or fewer"})
        updated_files[index]["filename"] = filename
    elif action == "move":
        direction = (payload.get("direction") or "").strip().lower()
        if direction not in {"up", "down"}:
            return response(400, {"error": "direction must be up or down"})
        target_index = index - 1 if direction == "up" else index + 1
        if target_index < 0 or target_index >= len(updated_files):
            return response(200, {"note": note})
        updated_files[index], updated_files[target_index] = (
            updated_files[target_index],
            updated_files[index],
        )
    else:
        return response(400, {"error": "Unsupported file action"})

    now = datetime.now(timezone.utc).isoformat()
    try:
        result = table.update_item(
            Key={"userId": user_id, "noteId": note_id},
            UpdateExpression="SET #files = :files, updatedAt = :updated",
            ConditionExpression=(
                "attribute_exists(userId) AND attribute_exists(noteId) AND updatedAt = :expected"
            ),
            ExpressionAttributeNames={"#files": "files"},
            ExpressionAttributeValues={
                ":files": updated_files,
                ":updated": now,
                ":expected": note.get("updatedAt"),
            },
            ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return response(
                409,
                {"error": "This note changed while updating its files. Please retry."},
            )
        raise

    return response(200, {"note": result.get("Attributes", {})})


def lambda_handler(event, context):
    user_id = current_user_id(event)
    if not user_id:
        return response(401, {"error": "Authenticated user ID is missing"})

    params = event.get("pathParameters") or {}
    note_id = params.get("noteId")
    if not note_id:
        return response(400, {"error": "noteId is required"})

    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"error": "Request body must be valid JSON"})

    method = (
        event.get("requestContext", {})
        .get("http", {})
        .get("method", "POST")
        .upper()
    )

    if method == "POST":
        return register_file(user_id, note_id, payload)

    if method == "PATCH":
        file_id = params.get("fileId")
        if not file_id:
            return response(400, {"error": "fileId is required"})
        return update_file_metadata(user_id, note_id, file_id, payload)

    return response(405, {"error": "Method not allowed"})
