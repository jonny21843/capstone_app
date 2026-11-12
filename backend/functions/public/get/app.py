import json
from decimal import Decimal
import os

import boto3
from boto3.dynamodb.conditions import Key
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


def lambda_handler(event, context):
    note_id = (event.get("pathParameters") or {}).get("noteId")
    if not note_id:
        return response(400, {"error": "noteId is required"})

    result = table.query(
        IndexName="NoteIdIndex",
        KeyConditionExpression=Key("noteId").eq(note_id),
        Limit=1,
    )
    notes = result.get("Items", [])
    note = notes[0] if notes else None

    if not note or note.get("visibility") != "public":
        return response(404, {"error": "Public note not found"})

    view_result = table.update_item(
        Key={"userId": note["userId"], "noteId": note_id},
        UpdateExpression="ADD viewCount :one",
        ExpressionAttributeValues={":one": 1},
        ReturnValues="UPDATED_NEW",
    )
    view_count = int(view_result.get("Attributes", {}).get("viewCount", 0))

    files = []
    for file_record in note.get("files") or []:
        view_url = s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": bucket_name,
                "Key": file_record["key"],
                "ResponseContentDisposition": "inline",
            },
            ExpiresIn=600,
        )
        files.append(
            {
                "fileId": file_record.get("fileId"),
                "filename": file_record.get("filename"),
                "contentType": file_record.get("contentType"),
                "sizeBytes": file_record.get("sizeBytes"),
                "uploadedAt": file_record.get("uploadedAt"),
                "viewUrl": view_url,
                "expiresIn": 600,
            }
        )

    return response(
        200,
        {
            "note": {
                "noteId": note.get("noteId"),
                "title": note.get("title", ""),
                "subject": note.get("subject", ""),
                "collection": note.get("collection", ""),
                "description": note.get("description", ""),
                "publicAuthor": note.get("publicAuthor", "Community member"),
                "publishedAt": note.get("publishedAt"),
                "viewCount": view_count,
                "files": files,
            }
        },
    )
