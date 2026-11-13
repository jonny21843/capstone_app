import json
import os
import re
import uuid

import boto3
from botocore.config import Config


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])
bucket_name = os.environ["NOTES_BUCKET"]
aws_region = os.environ.get("AWS_REGION", "us-east-2")
max_file_bytes = int(os.environ.get("MAX_FILE_BYTES", str(20 * 1024 * 1024)))
max_files_per_note = int(os.environ.get("MAX_FILES_PER_NOTE", "10"))

s3 = boto3.client(
    "s3",
    region_name=aws_region,
    endpoint_url=f"https://s3.{aws_region}.amazonaws.com",
    config=Config(signature_version="s3v4"),
)

SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._ -]+")
ALLOWED_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".pptx", ".xlsx"}


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


def safe_filename(value):
    cleaned = SAFE_FILENAME.sub("_", value or "").strip(" .")
    return cleaned[:180] or "upload"


def file_extension(filename):
    lowered = filename.lower()
    for extension in ALLOWED_EXTENSIONS:
        if lowered.endswith(extension):
            return extension
    return ""


def lambda_handler(event, context):
    user_id = current_user_id(event)
    if not user_id:
        return response(401, {"error": "Authenticated user ID is missing"})

    note_id = (event.get("pathParameters") or {}).get("noteId")
    if not note_id:
        return response(400, {"error": "noteId is required"})

    note = table.get_item(Key={"userId": user_id, "noteId": note_id}).get("Item")
    if not note:
        return response(404, {"error": "Note not found"})

    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"error": "Request body must be valid JSON"})

    raw_filename = (payload.get("filename") or "").strip()
    replace_file_id = (payload.get("replaceFileId") or "").strip()
    filename = safe_filename(raw_filename)

    files = note.get("files") or []
    replacing = bool(replace_file_id and any(item.get("fileId") == replace_file_id for item in files))
    if len(files) >= max_files_per_note and not replacing:
        return response(
            400,
            {"error": f"A note can have at most {max_files_per_note} source files"},
        )

    if replace_file_id and not replacing:
        return response(404, {"error": "Source file to replace was not found"})
    content_type = (payload.get("contentType") or "").strip().lower()

    try:
        file_size = int(payload.get("fileSize") or 0)
    except (TypeError, ValueError):
        file_size = 0

    if not raw_filename or file_extension(raw_filename) not in ALLOWED_EXTENSIONS:
        return response(
            400,
            {"error": "Only PDF, JPG, PNG, WEBP, PPTX, and XLSX files are allowed"},
        )

    if content_type not in ALLOWED_TYPES:
        return response(
            400,
            {"error": "Unsupported file type. Use PDF, JPG, PNG, WEBP, PPTX, or XLSX"},
        )

    if file_size <= 0:
        return response(400, {"error": "File size is required"})

    if file_size > max_file_bytes:
        return response(
            400,
            {"error": f"File is too large. Maximum size is {max_file_bytes // (1024 * 1024)} MB"},
        )

    object_id = str(uuid.uuid4())
    key = f"users/{user_id}/notes/{note_id}/original/{object_id}-{filename}"

    upload = s3.generate_presigned_post(
        Bucket=bucket_name,
        Key=key,
        Fields={
            "Content-Type": content_type,
        },
        Conditions=[
            {"Content-Type": content_type},
            ["content-length-range", 1, max_file_bytes],
        ],
        ExpiresIn=300,
    )

    return response(
        200,
        {
            "uploadUrl": upload["url"],
            "uploadFields": upload["fields"],
            "key": key,
            "expiresIn": 300,
            "maxFileBytes": max_file_bytes,
            "replaceFileId": replace_file_id or None,
        },
    )
