import json
import os

import boto3
from boto3.dynamodb.conditions import Attr


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
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
    }


def lambda_handler(event, context):
    params = event.get("queryStringParameters") or {}
    query = (params.get("q") or "").strip().lower()
    subject = (params.get("subject") or "").strip().lower()
    sort = (params.get("sort") or "newest").strip().lower()

    result = table.scan(
        FilterExpression=Attr("visibility").eq("public"),
        Limit=200,
    )
    all_public = result.get("Items", [])

    subjects = sorted(
        {
            (note.get("subject") or "").strip()
            for note in all_public
            if (note.get("subject") or "").strip()
        },
        key=str.lower,
    )

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

    if sort == "oldest":
        notes.sort(key=lambda note: note.get("publishedAt", ""))
    elif sort == "title":
        notes.sort(key=lambda note: (note.get("title") or "").lower())
    else:
        notes.sort(key=lambda note: note.get("publishedAt", ""), reverse=True)

    return response(
        200,
        {
            "notes": [public_projection(note) for note in notes],
            "subjects": subjects,
        },
    )
