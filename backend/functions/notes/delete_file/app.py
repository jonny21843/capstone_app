import json
from decimal import Decimal
import os
from datetime import datetime, timezone

import boto3


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])
s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-2"))
bucket_name = os.environ["NOTES_BUCKET"]


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


def lambda_handler(event, context):
    user_id = current_user_id(event)
    if not user_id:
        return response(401, {"error": "Authenticated user ID is missing"})

    params = event.get("pathParameters") or {}
    note_id = params.get("noteId")
    file_id = params.get("fileId")

    if not note_id or not file_id:
        return response(400, {"error": "noteId and fileId are required"})

    note = table.get_item(Key={"userId": user_id, "noteId": note_id}).get("Item")
    if not note:
        return response(404, {"error": "Note not found"})

    files = note.get("files") or []
    target_index = next(
        (index for index, item in enumerate(files) if item.get("fileId") == file_id),
        None,
    )

    if target_index is None:
        return response(404, {"error": "Source file not found"})

    target = files[target_index]
    now = datetime.now(timezone.utc).isoformat()

    update_expression = f"SET updatedAt = :updated REMOVE #files[{target_index}]"
    values = {
        ":updated": now,
        ":file_id": file_id,
    }

    if len(files) == 1:
        update_expression = (
            f"SET updatedAt = :updated, processingStatus = :created "
            f"REMOVE #files[{target_index}]"
        )
        values[":created"] = "created"

    try:
        result = table.update_item(
            Key={"userId": user_id, "noteId": note_id},
            UpdateExpression=update_expression,
            ConditionExpression=(
                f"attribute_exists(userId) AND attribute_exists(noteId) AND "
                f"#files[{target_index}].#file_id = :file_id"
            ),
            ExpressionAttributeNames={
                "#files": "files",
                "#file_id": "fileId",
            },
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )
    except Exception as error:
        if getattr(error, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return response(
                409,
                {"error": "This note changed while removing the file. Please retry."},
            )
        raise

    key = target.get("key")
    if key:
        s3.delete_object(Bucket=bucket_name, Key=key)

    return response(200, {"note": result.get("Attributes", {})})
