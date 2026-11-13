import json
from decimal import Decimal
import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])
bucket_name = os.environ["NOTES_BUCKET"]
s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-2"))


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


def reconcile_pending_scans(note):
    files = [dict(item) for item in (note.get("files") or [])]
    changed = False

    for item in files:
        if (item.get("malwareScanStatus") or "").upper() != "PENDING":
            continue

        key = item.get("key")
        if not key:
            continue

        try:
            result = s3.get_object_tagging(Bucket=bucket_name, Key=key)
        except Exception:
            continue

        tags = {tag.get("Key"): tag.get("Value") for tag in result.get("TagSet", [])}
        actual = (tags.get("GuardDutyMalwareScanStatus") or "").upper()
        if actual and actual != "PENDING":
            item["malwareScanStatus"] = actual
            item["malwareScanUpdatedAt"] = datetime.now(timezone.utc).isoformat()
            changed = True

    if not changed:
        return note

    now = datetime.now(timezone.utc).isoformat()
    publish_pending = bool(note.get("publishPending"))
    failed = any(
        item.get("malwareScanStatus") not in (None, "PENDING", "NO_THREATS_FOUND")
        for item in files
    )
    pending = any(item.get("malwareScanStatus") == "PENDING" for item in files)

    if publish_pending and failed:
        result = table.update_item(
            Key={"userId": note["userId"], "noteId": note["noteId"]},
            UpdateExpression=(
                "SET #files = :files, publishScanError = :error, updatedAt = :updated "
                "REMOVE publishPending"
            ),
            ExpressionAttributeNames={"#files": "files"},
            ExpressionAttributeValues={
                ":files": files,
                ":error": "One or more source files did not pass the security scan.",
                ":updated": now,
            },
            ReturnValues="ALL_NEW",
        )
        return result.get("Attributes", note)

    if publish_pending and files and not pending:
        result = table.update_item(
            Key={"userId": note["userId"], "noteId": note["noteId"]},
            UpdateExpression=(
                "SET #files = :files, visibility = :public, publishedAt = :published_at, "
                "updatedAt = :updated REMOVE publishPending, publishScanError"
            ),
            ExpressionAttributeNames={"#files": "files"},
            ExpressionAttributeValues={
                ":files": files,
                ":public": "public",
                ":published_at": now,
                ":updated": now,
            },
            ReturnValues="ALL_NEW",
        )
        return result.get("Attributes", note)

    result = table.update_item(
        Key={"userId": note["userId"], "noteId": note["noteId"]},
        UpdateExpression="SET #files = :files, updatedAt = :updated",
        ExpressionAttributeNames={"#files": "files"},
        ExpressionAttributeValues={
            ":files": files,
            ":updated": now,
        },
        ReturnValues="ALL_NEW",
    )
    return result.get("Attributes", note)


def lambda_handler(event, context):
    user_id = current_user_id(event)
    if not user_id:
        return response(401, {"error": "Authenticated user ID is missing"})

    result = table.query(KeyConditionExpression=Key("userId").eq(user_id))
    notes = [reconcile_pending_scans(note) for note in result.get("Items", [])]
    notes.sort(key=lambda note: note.get("createdAt", ""), reverse=True)

    return response(200, {"notes": notes})
