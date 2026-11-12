import json
from decimal import Decimal
import os
from collections import Counter

import boto3


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])
cognito = boto3.client("cognito-idp")
user_pool_id = os.environ["COGNITO_USER_POOL_ID"]
admin_emails = {
    item.strip().lower()
    for item in os.environ.get("ADMIN_EMAILS", "").split(",")
    if item.strip()
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


def claims(event):
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )


def username_from_event(event):
    current = claims(event)
    return current.get("username") or current.get("cognito:username")


def current_user_email(event):
    username = username_from_event(event)
    if not username:
        return None

    user = cognito.admin_get_user(
        UserPoolId=user_pool_id,
        Username=username,
    )
    attributes = {
        item["Name"]: item.get("Value", "")
        for item in user.get("UserAttributes", [])
    }
    return (attributes.get("email") or "").strip().lower() or None


def is_admin(event):
    email = current_user_email(event)
    return bool(email and email in admin_emails)


def scan_all_notes():
    notes = []
    scan_args = {}
    while True:
        result = table.scan(**scan_args)
        notes.extend(result.get("Items", []))
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_args["ExclusiveStartKey"] = last_key
    return notes


def count_users():
    total = 0
    pagination_token = None
    try:
        while True:
            args = {
                "UserPoolId": user_pool_id,
                "Limit": 60,
            }
            if pagination_token:
                args["PaginationToken"] = pagination_token
            result = cognito.list_users(**args)
            total += len(result.get("Users", []))
            pagination_token = result.get("PaginationToken")
            if not pagination_token:
                break
        return total, None
    except Exception as error:
        return None, f"{type(error).__name__}: {error}"


def top_values(counter, limit=8):
    return [
        {"label": label, "count": count}
        for label, count in counter.most_common(limit)
    ]


def lambda_handler(event, context):
    try:
        if not is_admin(event):
            return response(403, {"error": "Admin access required"})
    except Exception as error:
        return response(
            500,
            {
                "error": "Unable to verify admin access",
                "detail": f"{type(error).__name__}: {error}",
            },
        )

    params = event.get("queryStringParameters") or {}
    if (str(params.get("probe") or "").lower() in {"1", "true", "yes"}:
        return response(200, {"isAdmin": True})

    try:
        notes = scan_all_notes()
    except Exception as error:
        return response(
            500,
            {
                "error": "Unable to read notes for analytics",
                "detail": f"{type(error).__name__}: {error}",
            },
        )

    public_notes = [note for note in notes if note.get("visibility") == "public"]
    private_notes = [note for note in notes if note.get("visibility") != "public"]

    total_files = 0
    total_storage_bytes = 0
    total_views = 0
    subjects = Counter()
    collections = Counter()

    for note in notes:
        files = note.get("files") or []
        if not isinstance(files, list):
            files = []

        total_files += len(files)

        for file in files:
            if not isinstance(file, dict):
                continue
            try:
                total_storage_bytes += int(file.get("sizeBytes") or 0)
            except (TypeError, ValueError, ArithmeticError):
                pass

        try:
            total_views += int(note.get("viewCount") or 0)
        except (TypeError, ValueError, ArithmeticError):
            pass

        subject = str(note.get("subject") or "").strip()
        collection = str(note.get("collection") or "").strip()
        if subject:
            subjects[subject] += 1
        if collection:
            collections[collection] += 1

    recent_public = sorted(
        public_notes,
        key=lambda note: note.get("publishedAt") or "",
        reverse=True,
    )[:10]

    user_count, user_count_error = count_users()

    return response(
        200,
        {
            "isAdmin": True,
            "metrics": {
                "users": user_count,
                "notes": len(notes),
                "publicNotes": len(public_notes),
                "privateNotes": len(private_notes),
                "sourceFiles": total_files,
                "storageBytes": total_storage_bytes,
                "views": total_views,
                "averageFilesPerNote": round(total_files / len(notes), 2) if notes else 0,
            },
            "warnings": (
                [{"code": "USER_COUNT_UNAVAILABLE", "message": user_count_error}]
                if user_count_error
                else []
            ),
            "topSubjects": top_values(subjects),
            "topCollections": top_values(collections),
            "recentPublished": [
                {
                    "noteId": note.get("noteId"),
                    "title": note.get("title", ""),
                    "subject": note.get("subject", ""),
                    "collection": note.get("collection", ""),
                    "publicAuthor": note.get("publicAuthor", "Community member"),
                    "publishedAt": note.get("publishedAt"),
                    "viewCount": int(note.get("viewCount") or 0),
                    "fileCount": len(note.get("files") or []),
                }
                for note in recent_public
            ],
        },
    )
