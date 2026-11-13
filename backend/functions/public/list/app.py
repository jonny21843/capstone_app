import json
from decimal import Decimal
import os

import boto3
from boto3.dynamodb.conditions import Attr


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


def searchable_text(note):
    return " ".join(
        [
            note.get("title", ""),
            note.get("subject", ""),
            note.get("collection", ""),
            note.get("description", ""),
        ]
    ).lower()


def public_projection(note):
    return {
        "noteId": note.get("noteId"),
        "title": note.get("title", ""),
        "subject": note.get("subject", ""),
        "collection": note.get("collection", ""),
        "description": note.get("description", ""),
        "publicAuthor": note.get("publicAuthor", "Community member"),
        "publishedAt": note.get("publishedAt"),
        "fileCount": len(note.get("files") or []),
        "viewCount": int(note.get("viewCount") or 0),
    }


def lambda_handler(event, context):
    params = event.get("queryStringParameters") or {}
    query = (params.get("q") or "").strip().lower()
    subject = (params.get("subject") or "").strip().lower()
    collection = (params.get("collection") or "").strip().lower()
    sort = (params.get("sort") or "newest").strip().lower()

    try:
        page = max(1, int(params.get("page") or 1))
        page_size = min(48, max(1, int(params.get("pageSize") or 18)))
    except ValueError:
        return response(400, {"error": "page and pageSize must be numbers"})

    all_public = []
    scan_args = {
        "FilterExpression": Attr("visibility").eq("public"),
    }

    while True:
        result = table.scan(**scan_args)
        all_public.extend(result.get("Items", []))

        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            break

        scan_args["ExclusiveStartKey"] = last_key

    subjects = sorted(
        {
            (note.get("subject") or "").strip()
            for note in all_public
            if (note.get("subject") or "").strip()
        },
        key=str.lower,
    )
    collections = sorted(
        {
            (note.get("collection") or "").strip()
            for note in all_public
            if (note.get("collection") or "").strip()
        },
        key=str.lower,
    )

    subject_topics = {}
    for note in all_public:
        subject_value = (note.get("subject") or "").strip()
        topic_value = (note.get("collection") or "").strip()
        if not subject_value or not topic_value:
            continue
        subject_topics.setdefault(subject_value, set()).add(topic_value)

    subject_topics = {
        subject_value: sorted(values, key=str.lower)
        for subject_value, values in subject_topics.items()
    }

    notes = all_public

    if query:
        keywords = [part for part in query.split() if part]
        notes = [
            note
            for note in notes
            if all(keyword in searchable_text(note) for keyword in keywords)
        ]

    if subject:
        notes = [
            note
            for note in notes
            if (note.get("subject") or "").strip().lower() == subject
        ]

    if collection:
        notes = [
            note
            for note in notes
            if (note.get("collection") or "").strip().lower() == collection
        ]

    if sort == "oldest":
        notes.sort(key=lambda note: note.get("publishedAt", ""))
    elif sort == "title":
        notes.sort(key=lambda note: (note.get("title") or "").lower())
    elif sort == "views":
        notes.sort(key=lambda note: int(note.get("viewCount") or 0), reverse=True)
    else:
        notes.sort(key=lambda note: note.get("publishedAt", ""), reverse=True)

    total = len(notes)
    total_pages = max(1, (total + page_size - 1) // page_size) if total else 1
    page = min(page, total_pages)
    start = (page - 1) * page_size
    page_notes = notes[start : start + page_size]

    return response(
        200,
        {
            "notes": [public_projection(note) for note in page_notes],
            "subjects": subjects,
            "collections": collections,
            "subjectTopics": subject_topics,
            "page": page,
            "pageSize": page_size,
            "total": total,
            "totalPages": total_pages,
        },
    )
