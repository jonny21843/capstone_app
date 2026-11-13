import json
from decimal import Decimal
import os
import uuid
from datetime import datetime, timezone
from io import BytesIO
from zipfile import BadZipFile, ZipFile

import boto3
from botocore.exceptions import ClientError


dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["NOTES_TABLE"])
security_table = dynamodb.Table(os.environ["SECURITY_TABLE"])
bucket_name = os.environ["NOTES_BUCKET"]
max_file_bytes = int(os.environ.get("MAX_FILE_BYTES", str(20 * 1024 * 1024)))
max_files_per_note = int(os.environ.get("MAX_FILES_PER_NOTE", "10"))
s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-2"))

ALLOWED_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.apple.pages",
    "application/x-iwork-pages-sffpages",
    "application/octet-stream",
}

EXTENSIONS_BY_TYPE = {
    "application/pdf": {".pdf"},
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
    "image/webp": {".webp"},
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": {".pptx"},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {".xlsx"},
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {".docx"},
    "application/vnd.apple.pages": {".pages"},
    "application/x-iwork-pages-sffpages": {".pages"},
    "application/octet-stream": {".pages"},
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



def filename_extension(filename):
    lowered = (filename or "").lower()
    for extensions in EXTENSIONS_BY_TYPE.values():
        for extension in extensions:
            if lowered.endswith(extension):
                return extension
    return ""


def filename_matches_type(filename, content_type):
    extension = filename_extension(filename)
    return bool(extension and extension in EXTENSIONS_BY_TYPE.get(content_type, set()))


def validate_file_signature(key, content_type):
    obj = s3.get_object(Bucket=bucket_name, Key=key)
    data = obj["Body"].read()

    if content_type == "application/pdf":
        return data.startswith(b"%PDF-")

    if content_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")

    if content_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")

    if content_type == "image/webp":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"

    if content_type in {
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.apple.pages",
        "application/x-iwork-pages-sffpages",
        "application/octet-stream",
    }:
        try:
            with ZipFile(BytesIO(data)) as archive:
                names = set(archive.namelist())
        except BadZipFile:
            return False

        if content_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            return "[Content_Types].xml" in names and "ppt/presentation.xml" in names

        if content_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            return "[Content_Types].xml" in names and "xl/workbook.xml" in names

        if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            return "[Content_Types].xml" in names and "word/document.xml" in names

        # Modern Apple Pages files are ZIP containers with iWork IWA content.
        return any(
            name == "Index/Document.iwa" or name.startswith("Index/") and name.endswith(".iwa")
            for name in names
        )

    return False


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


def upload_block_reason(user_id):
    profile = security_table.get_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"}
    ).get("Item") or {}

    if profile.get("uploadBlocked"):
        return "Uploads are disabled for this account pending a security review."

    blocked_until = profile.get("uploadBlockedUntil")
    if blocked_until:
        try:
            until = datetime.fromisoformat(str(blocked_until).replace("Z", "+00:00"))
            if until > datetime.now(timezone.utc):
                return "Uploads are temporarily paused after a security scan detected malware."
        except (TypeError, ValueError):
            return "Uploads are temporarily paused pending a security review."

    return None


def register_file(user_id, note_id, payload):
    block_reason = upload_block_reason(user_id)
    key = (payload.get("key") or "").strip()
    expected_prefix = f"users/{user_id}/notes/{note_id}/original/"

    if block_reason:
        if key.startswith(expected_prefix):
            try:
                s3.delete_object(Bucket=bucket_name, Key=key)
            except ClientError:
                pass
        return response(423, {"error": block_reason, "code": "UPLOAD_SECURITY_BLOCK"})

    filename = (payload.get("filename") or "").strip()
    content_type = (payload.get("contentType") or "").strip().lower()
    replace_file_id = (payload.get("replaceFileId") or "").strip()
    if not key.startswith(expected_prefix):
        return response(400, {"error": "Invalid file key for this note"})

    if not filename:
        return response(400, {"error": "filename is required"})

    if content_type not in ALLOWED_TYPES:
        s3.delete_object(Bucket=bucket_name, Key=key)
        return response(400, {"error": "Unsupported uploaded file type"})

    if not filename_matches_type(filename, content_type):
        s3.delete_object(Bucket=bucket_name, Key=key)
        return response(400, {"error": "Filename extension does not match the uploaded file type"})

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

    if actual_type == "application/octet-stream" and filename_extension(filename) != ".pages":
        s3.delete_object(Bucket=bucket_name, Key=key)
        return response(400, {"error": "Generic binary uploads are only allowed for Apple Pages files"})

    try:
        signature_valid = validate_file_signature(key, actual_type)
    except ClientError:
        signature_valid = False

    if not signature_valid:
        s3.delete_object(Bucket=bucket_name, Key=key)
        return response(400, {"error": "Uploaded file contents do not match the declared file type"})

    scan_status = "PENDING"
    try:
        tag_result = s3.get_object_tagging(Bucket=bucket_name, Key=key)
        tags = {item.get("Key"): item.get("Value") for item in tag_result.get("TagSet", [])}
        scan_status = (tags.get("GuardDutyMalwareScanStatus") or "PENDING").upper()
    except ClientError:
        scan_status = "PENDING"

    now = datetime.now(timezone.utc).isoformat()
    file_record = {
        "fileId": replace_file_id or str(uuid.uuid4()),
        "key": key,
        "filename": filename[:240],
        "contentType": actual_type,
        "sizeBytes": actual_size,
        "uploadedAt": now,
        "malwareScanStatus": scan_status,
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
        if not filename_matches_type(filename, updated_files[index].get("contentType", "")):
            return response(400, {"error": "Keep the original file type when renaming this source"})
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
