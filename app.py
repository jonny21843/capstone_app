from flask import Flask, request, jsonify
import boto3
import os

app = Flask(__name__)

# Your DEV uploads bucket
S3_BUCKET = os.environ.get("UPLOADS_BUCKET", "dev-feagans-capstone")

s3_client = boto3.client("s3")


def safe_segment(value: str) -> str:
    """Sanitize path segments for S3 keys."""
    return (value or "").replace("/", "_").replace("\\", "_").strip()


@app.route("/health", methods=["GET"])
def health():
    return "ok", 200


# -------------------------
# Upload presign (PUT)
# -------------------------
@app.route("/api/presign-upload", methods=["POST"])
def presign_upload():
    data = request.get_json(force=True)

    field = safe_segment(data.get("field"))
    category = safe_segment(data.get("category"))
    filename = (data.get("filename") or "").strip()
    content_type = data.get("contentType") or "application/octet-stream"

    if not field or not category or not filename:
        return jsonify({"error": "field, category, and filename are required"}), 400

    key = f"uploadedfiles/{field}/{category}/{filename}"

    try:
        presigned_url = s3_client.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": S3_BUCKET,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=300,
        )
        return jsonify(
            {
                "uploadUrl": presigned_url,
                "url": presigned_url,   # compat
                "finalKey": key,
                "bucket": S3_BUCKET,
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# -------------------------
# Download presign (GET)
# -------------------------
@app.route("/api/presign-download", methods=["POST"])
def presign_download():
    data = request.get_json(force=True)

    key = data.get("key")

    if not key:
        field = safe_segment(data.get("field"))
        category = safe_segment(data.get("category"))
        filename = (data.get("filename") or "").strip()

        if not field or not category or not filename:
            return jsonify({"error": "key or (field, category, filename) required"}), 400

        key = f"uploadedfiles/{field}/{category}/{filename}"

    try:
        presigned_url = s3_client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": S3_BUCKET, "Key": key},
            ExpiresIn=300,
        )
        return jsonify(
            {
                "downloadUrl": presigned_url,
                "url": presigned_url,   # compat
                "key": key,
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# -------------------------
# List fields
# -------------------------
@app.route("/api/list-fields", methods=["GET"])
def list_fields():
    prefix = "uploadedfiles/"
    fields = set()

    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        for page in paginator.paginate(
            Bucket=S3_BUCKET, Prefix=prefix, Delimiter="/"
        ):
            for cp in page.get("CommonPrefixes", []):
                p = cp.get("Prefix", "")
                parts = p.split("/")
                if len(parts) >= 2 and parts[1]:
                    fields.add(parts[1])

        return jsonify({"fields": sorted(fields)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# -------------------------
# List categories
# -------------------------
@app.route("/api/list-categories", methods=["GET"])
def list_categories():
    field = safe_segment(request.args.get("field"))

    if not field:
        return jsonify({"error": "field is required"}), 400

    prefix = f"uploadedfiles/{field}/"
    categories = set()

    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        for page in paginator.paginate(
            Bucket=S3_BUCKET, Prefix=prefix, Delimiter="/"
        ):
            for cp in page.get("CommonPrefixes", []):
                p = cp.get("Prefix", "")
                parts = p.split("/")
                if len(parts) >= 3 and parts[2]:
                    categories.add(parts[2])

        return jsonify({"categories": sorted(categories)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# -------------------------
# List files
# -------------------------
@app.route("/api/list-files", methods=["GET"])
def list_files():
    field = safe_segment(request.args.get("field"))
    category = safe_segment(request.args.get("category"))

    if not field or not category:
        return jsonify({"error": "field and category are required"}), 400

    prefix = f"uploadedfiles/{field}/{category}/"
    files = []

    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj.get("Key", "")
                if key.endswith("/"):
                    continue

                filename = key.replace(prefix, "", 1)
                if not filename:
                    continue

                files.append(
                    {
                        "name": filename,
                        "size": obj.get("Size", 0),
                        "lastModified": obj.get("LastModified").isoformat()
                        if obj.get("LastModified")
                        else None,
                    }
                )

        files.sort(key=lambda f: f["name"].lower())
        return jsonify({"files": files})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
