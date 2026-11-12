import json
import os
import re
import uuid

import boto3
from botocore.config import Config


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])
bucket_name = os.environ["NOTES_BUCKET"]
aws_region = os.environ.get("AWS_REGION", "us-east-2")

s3 = boto3.client(
    "s3",
    region_name=aws_region,
    endpoint_url=f"https://s3.{aws_region}.amazonaws.com",
    config=Config(signature_version="s3v4"),
)

SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._ -]+")


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

    filename = safe_filename(payload.get("filename"))
    content_type = (payload.get("contentType") or "application/octet-stream").strip()

    object_id = str(uuid.uuid4())
    key = f"users/{user_id}/notes/{note_id}/original/{object_id}-{filename}"

    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": bucket_name,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=300,
    )

    return response(
        200,
        {
            "uploadUrl": upload_url,
            "key": key,
            "expiresIn": 300,
        },
    )
