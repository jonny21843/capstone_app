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


def delete_prefix(prefix):
    continuation_token = None

    while True:
        list_args = {
            "Bucket": bucket_name,
            "Prefix": prefix,
            "MaxKeys": 1000,
        }

        if continuation_token:
            list_args["ContinuationToken"] = continuation_token

        result = s3.list_objects_v2(**list_args)
        objects = [{"Key": item["Key"]} for item in result.get("Contents", [])]

        if objects:
            s3.delete_objects(
                Bucket=bucket_name,
                Delete={"Objects": objects, "Quiet": True},
            )

        if not result.get("IsTruncated"):
            break

        continuation_token = result.get("NextContinuationToken")


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

    prefix = f"users/{user_id}/notes/{note_id}/"
    delete_prefix(prefix)

    table.delete_item(Key={"userId": user_id, "noteId": note_id})

    return response(
        200,
        {
            "deleted": True,
            "noteId": note_id,
            "deletedPrefix": prefix,
        },
    )
