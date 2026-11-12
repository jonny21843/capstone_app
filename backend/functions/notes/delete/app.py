import json
import os

import boto3


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])
s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-2"))
bucket_name = os.environ["NOTES_BUCKET"]


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

    objects = [
        {"Key": file_record["key"]}
        for file_record in (note.get("files") or [])
        if file_record.get("key")
    ]

    if objects:
        s3.delete_objects(
            Bucket=bucket_name,
            Delete={"Objects": objects, "Quiet": True},
        )

    table.delete_item(Key={"userId": user_id, "noteId": note_id})

    return response(200, {"deleted": True, "noteId": note_id})
