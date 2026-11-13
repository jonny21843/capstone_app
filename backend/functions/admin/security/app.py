import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError


dynamodb = boto3.resource("dynamodb")
notes_table = dynamodb.Table(os.environ["NOTES_TABLE"])
security_table = dynamodb.Table(os.environ["SECURITY_TABLE"])
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


def current_admin_email(event):
    email = (claims(event).get("email") or "").strip().lower()
    if email:
        return email

    username = (
        claims(event).get("username")
        or claims(event).get("cognito:username")
        or ""
    ).strip().lower()
    return username if "@" in username else None


def is_admin(event):
    email = current_admin_email(event)
    return bool(email and email in admin_emails)


def scan_profiles():
    profiles = []
    args = {
        "FilterExpression": Attr("sk").eq("PROFILE"),
    }
    while True:
        result = security_table.scan(**args)
        profiles.extend(result.get("Items") or [])
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            break
        args["ExclusiveStartKey"] = last_key
    return profiles


def query_user_security(user_id):
    result = security_table.query(
        KeyConditionExpression=Key("pk").eq(f"USER#{user_id}"),
        ConsistentRead=True,
    )
    items = result.get("Items") or []
    profile = next((item for item in items if item.get("sk") == "PROFILE"), None)
    incidents = [item for item in items if str(item.get("sk") or "").startswith("INCIDENT#")]
    audits = [item for item in items if str(item.get("sk") or "").startswith("AUDIT#")]
    incidents.sort(key=lambda item: item.get("detectedAt") or "", reverse=True)
    audits.sort(key=lambda item: item.get("createdAt") or "", reverse=True)
    return profile, incidents, audits


def cognito_user_for_sub(user_id):
    result = cognito.list_users(
        UserPoolId=user_pool_id,
        Filter=f'sub = "{user_id}"',
        Limit=1,
    )
    users = result.get("Users") or []
    return users[0] if users else None


def user_summary(cognito_user):
    if not cognito_user:
        return {
            "email": None,
            "enabled": None,
            "username": None,
        }

    attributes = {
        item.get("Name"): item.get("Value", "")
        for item in cognito_user.get("Attributes", [])
    }
    return {
        "email": (attributes.get("email") or "").strip() or None,
        "enabled": bool(cognito_user.get("Enabled")),
        "username": cognito_user.get("Username"),
    }


def note_file_metadata(user_id, note_id, object_key):
    note = notes_table.get_item(
        Key={"userId": user_id, "noteId": note_id}
    ).get("Item") or {}

    file_record = next(
        (
            item
            for item in (note.get("files") or [])
            if item.get("key") == object_key
        ),
        {},
    )
    return {
        "noteTitle": note.get("title") or None,
        "filename": file_record.get("filename") or None,
        "fileId": file_record.get("fileId") or None,
    }


def serialize_incident(user_id, incident):
    metadata = note_file_metadata(
        user_id,
        incident.get("noteId"),
        incident.get("objectKey"),
    )
    return {
        "incidentId": incident.get("incidentId"),
        "noteId": incident.get("noteId"),
        "noteTitle": metadata["noteTitle"] or incident.get("noteTitle") or None,
        "fileId": metadata["fileId"],
        "filename": metadata["filename"] or incident.get("filename") or None,
        "detectedAt": incident.get("detectedAt"),
        "scanResultStatus": incident.get("scanResultStatus"),
        "forgiven": bool(incident.get("forgiven")),
        "forgivenAt": incident.get("forgivenAt"),
        "forgivenBy": incident.get("forgivenBy"),
    }


def profile_summary(profile, cognito_user):
    user_id = str(profile.get("pk") or "").removeprefix("USER#")
    user = user_summary(cognito_user)
    return {
        "userId": user_id,
        "email": user["email"],
        "cognitoEnabled": user["enabled"],
        "accountSecurityStatus": profile.get("accountSecurityStatus") or "ACTIVE",
        "malwareStrikeCount30d": int(profile.get("malwareStrikeCount30d") or 0),
        "lastMalwareAt": profile.get("lastMalwareAt"),
        "uploadBlocked": bool(profile.get("uploadBlocked")),
        "uploadBlockedUntil": profile.get("uploadBlockedUntil"),
        "publishingBlocked": bool(profile.get("publishingBlocked")),
        "reviewRequired": bool(profile.get("reviewRequired")),
        "lastIncidentId": profile.get("lastIncidentId"),
    }


def write_audit(user_id, admin_email, action, details=None):
    now = datetime.now(timezone.utc).isoformat()
    security_table.put_item(
        Item={
            "pk": f"USER#{user_id}",
            "sk": f"AUDIT#{now}#{uuid.uuid4()}",
            "createdAt": now,
            "adminEmail": admin_email,
            "action": action,
            "details": details or {},
        }
    )


def update_profile(user_id, set_values=None, remove_names=None):
    set_values = set_values or {}
    remove_names = remove_names or []

    names = {}
    values = {}
    set_parts = []
    remove_parts = []

    for index, (name, value) in enumerate(set_values.items()):
        name_key = f"#n{index}"
        value_key = f":v{index}"
        names[name_key] = name
        values[value_key] = value
        set_parts.append(f"{name_key} = {value_key}")

    offset = len(set_values)
    for index, name in enumerate(remove_names):
        name_key = f"#n{offset + index}"
        names[name_key] = name
        remove_parts.append(name_key)

    parts = []
    if set_parts:
        parts.append("SET " + ", ".join(set_parts))
    if remove_parts:
        parts.append("REMOVE " + ", ".join(remove_parts))

    if not parts:
        return

    security_table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression=" ".join(parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values if values else None,
    )


def restore_access(user_id):
    update_profile(
        user_id,
        set_values={
            "uploadBlocked": False,
            "publishingBlocked": False,
            "reviewRequired": False,
            "accountSecurityStatus": "ACTIVE",
        },
        remove_names=["uploadBlockedUntil"],
    )


def forgive_strikes(user_id, admin_email):
    profile, incidents, _ = query_user_security(user_id)
    now = datetime.now(timezone.utc).isoformat()

    for incident in incidents:
        if incident.get("forgiven"):
            continue
        security_table.update_item(
            Key={
                "pk": f"USER#{user_id}",
                "sk": incident["sk"],
            },
            UpdateExpression=(
                "SET forgiven = :forgiven, forgivenAt = :forgiven_at, "
                "forgivenBy = :forgiven_by"
            ),
            ExpressionAttributeValues={
                ":forgiven": True,
                ":forgiven_at": now,
                ":forgiven_by": admin_email,
            },
        )

    if profile:
        update_profile(
            user_id,
            set_values={
                "malwareStrikeCount30d": 0,
                "uploadBlocked": False,
                "publishingBlocked": False,
                "reviewRequired": False,
                "accountSecurityStatus": "ACTIVE",
            },
            remove_names=["uploadBlockedUntil"],
        )


def set_cognito_enabled(user_id, enabled):
    user = cognito_user_for_sub(user_id)
    username = (user or {}).get("Username")
    if not username:
        raise ValueError("Cognito user was not found")

    if enabled:
        cognito.admin_enable_user(
            UserPoolId=user_pool_id,
            Username=username,
        )
    else:
        cognito.admin_disable_user(
            UserPoolId=user_pool_id,
            Username=username,
        )


def list_security():
    profiles = scan_profiles()
    users = []

    for profile in profiles:
        user_id = str(profile.get("pk") or "").removeprefix("USER#")
        try:
            cognito_user = cognito_user_for_sub(user_id)
        except Exception:
            cognito_user = None
        users.append(profile_summary(profile, cognito_user))

    severity = {
        "DISABLED": 0,
        "RESTRICTED": 1,
        "REVIEW_REQUIRED": 2,
        "ACTIVE": 3,
    }
    users.sort(
        key=lambda item: (
            severity.get(item.get("accountSecurityStatus"), 9),
            item.get("lastMalwareAt") or "",
        )
    )

    return {
        "metrics": {
            "reviewRequired": sum(1 for item in users if item["reviewRequired"]),
            "restricted": sum(
                1 for item in users
                if item["accountSecurityStatus"] == "RESTRICTED"
            ),
            "disabled": sum(
                1 for item in users
                if item["accountSecurityStatus"] == "DISABLED"
                or item["cognitoEnabled"] is False
            ),
            "trackedAccounts": len(users),
            "strikes30d": sum(item["malwareStrikeCount30d"] for item in users),
        },
        "users": users,
    }


def user_details(user_id):
    profile, incidents, audits = query_user_security(user_id)
    if not profile and not incidents and not audits:
        return None

    cognito_user = cognito_user_for_sub(user_id)
    summary = profile_summary(
        profile or {"pk": f"USER#{user_id}", "sk": "PROFILE"},
        cognito_user,
    )
    return {
        "user": summary,
        "incidents": [
            serialize_incident(user_id, incident)
            for incident in incidents[:100]
        ],
        "audit": [
            {
                "createdAt": item.get("createdAt"),
                "adminEmail": item.get("adminEmail"),
                "action": item.get("action"),
                "details": item.get("details") or {},
            }
            for item in audits[:100]
        ],
    }


def handle_action(event, user_id):
    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"error": "Request body must be valid JSON"})

    action = (payload.get("action") or "").strip().lower()
    admin_email = current_admin_email(event)
    admin_user_id = (claims(event).get("sub") or "").strip()

    if action == "disable_account" and admin_user_id == user_id:
        return response(400, {"error": "You cannot disable your own admin account from the security portal."})

    try:
        if action == "restore_access":
            restore_access(user_id)
        elif action == "forgive_strikes":
            forgive_strikes(user_id, admin_email)
        elif action == "reenable_account":
            set_cognito_enabled(user_id, True)
            restore_access(user_id)
        elif action == "disable_account":
            set_cognito_enabled(user_id, False)
            update_profile(
                user_id,
                set_values={
                    "uploadBlocked": True,
                    "publishingBlocked": True,
                    "reviewRequired": True,
                    "accountSecurityStatus": "DISABLED",
                },
            )
        else:
            return response(400, {"error": "Unsupported security action"})
    except ValueError as error:
        return response(404, {"error": str(error)})
    except ClientError as error:
        return response(
            500,
            {
                "error": "Unable to apply security action",
                "detail": error.response.get("Error", {}).get("Message", str(error)),
            },
        )

    write_audit(
        user_id,
        admin_email,
        action,
        {"source": "admin-security-portal"},
    )

    return response(200, user_details(user_id))


def lambda_handler(event, context):
    if not is_admin(event):
        return response(403, {"error": "Admin access required"})

    method = (
        event.get("requestContext", {})
        .get("http", {})
        .get("method", "GET")
        .upper()
    )
    user_id = (event.get("pathParameters") or {}).get("userId")

    if method == "GET" and not user_id:
        return response(200, list_security())

    if method == "GET" and user_id:
        details = user_details(user_id)
        if not details:
            return response(404, {"error": "Security record not found"})
        return response(200, details)

    if method == "PATCH" and user_id:
        return handle_action(event, user_id)

    return response(405, {"error": "Method not allowed"})
