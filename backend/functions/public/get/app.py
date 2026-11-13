import json
from decimal import Decimal
from io import BytesIO
import os
import tempfile
from datetime import date, datetime, time
from zipfile import ZipFile, BadZipFile
import re
import xml.etree.ElementTree as ET

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from openpyxl import load_workbook
from pages import Document as PagesDocument


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])
bucket_name = os.environ["NOTES_BUCKET"]
aws_region = os.environ.get("AWS_REGION", "us-east-2")

s3 = boto3.client(
    "s3",
    region_name=aws_region,
    endpoint_url=f"https://s3.{aws_region}.amazonaws.com",
    config=Config(signature_version="s3v4"),
)

MAX_PREVIEW_SHEETS = 5
MAX_PREVIEW_ROWS = 100
MAX_PREVIEW_COLUMNS = 30
MAX_XLSX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_XLSX_ZIP_ENTRIES = 5000
MAX_PPTX_SLIDES = 60
MAX_PPTX_TEXT_PER_SLIDE = 12000
MAX_DOCX_BLOCKS = 400
MAX_DOCX_TEXT = 100000
MAX_DOCX_TABLE_ROWS = 100
MAX_DOCX_TABLE_COLUMNS = 20
MAX_PAGES_PARAGRAPHS = 400
MAX_PAGES_TEXT = 100000
MAX_PAGES_TABLES = 20
MAX_PAGES_TABLE_ROWS = 100
MAX_PAGES_TABLE_COLUMNS = 20


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


def get_public_note(note_id):
    result = table.query(
        IndexName="NoteIdIndex",
        KeyConditionExpression=Key("noteId").eq(note_id),
        Limit=1,
    )
    notes = result.get("Items", [])
    note = notes[0] if notes else None
    if not note or note.get("visibility") != "public":
        return None

    safe_files = [
        item for item in (note.get("files") or [])
        if item.get("malwareScanStatus") in (None, "NO_THREATS_FOUND")
    ]
    if not safe_files:
        return None

    safe_note = dict(note)
    safe_note["files"] = safe_files
    return safe_note


def safe_cell_value(value):
    if value is None:
        return ""
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)):
        text = str(value) if isinstance(value, str) else value
        if isinstance(text, str) and len(text) > 500:
            return text[:497] + "..."
        return text
    return str(value)[:500]


def validate_xlsx_archive(data):
    try:
        with ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_XLSX_ZIP_ENTRIES:
                raise ValueError("Workbook contains too many internal files")
            total_size = sum(item.file_size for item in entries)
            if total_size > MAX_XLSX_UNCOMPRESSED_BYTES:
                raise ValueError("Workbook expands beyond the preview safety limit")
    except BadZipFile as error:
        raise ValueError("Workbook is not a valid XLSX file") from error


def preview_xlsx(note, file_id):
    file_record = next(
        (
            item
            for item in (note.get("files") or [])
            if item.get("fileId") == file_id
        ),
        None,
    )
    if not file_record:
        return response(404, {"error": "Source file not found"})

    filename = (file_record.get("filename") or "").lower()
    content_type = (file_record.get("contentType") or "").lower()
    is_xlsx = (
        filename.endswith(".xlsx")
        or content_type
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    if not is_xlsx:
        return response(400, {"error": "Native preview is currently available for XLSX files only"})

    obj = s3.get_object(Bucket=bucket_name, Key=file_record["key"])
    data = obj["Body"].read()
    validate_xlsx_archive(data)

    workbook = load_workbook(
        BytesIO(data),
        read_only=True,
        data_only=True,
        keep_links=False,
    )

    sheets = []
    visible_sheet_names = [
        sheet.title
        for sheet in workbook.worksheets
        if sheet.sheet_state == "visible"
    ]
    sheet_names = visible_sheet_names[:MAX_PREVIEW_SHEETS]

    for sheet_name in sheet_names:
        sheet = workbook[sheet_name]
        rows = []
        max_seen_column = 0

        for row_index, row in enumerate(
            sheet.iter_rows(
                min_row=1,
                max_row=MAX_PREVIEW_ROWS,
                max_col=MAX_PREVIEW_COLUMNS,
                values_only=True,
            ),
            start=1,
        ):
            values = [safe_cell_value(value) for value in row]
            while values and values[-1] == "":
                values.pop()

            if values:
                max_seen_column = max(max_seen_column, len(values))
            rows.append(values)

        while rows and not rows[-1]:
            rows.pop()

        sheets.append(
            {
                "name": sheet_name,
                "rows": rows,
                "columnCount": max_seen_column,
                "truncated": (
                    sheet.max_row > MAX_PREVIEW_ROWS
                    or sheet.max_column > MAX_PREVIEW_COLUMNS
                ),
            }
        )

    return response(
        200,
        {
            "preview": {
                "filename": file_record.get("filename"),
                "sheets": sheets,
                "sheetCount": len(visible_sheet_names),
                "previewedSheetCount": len(sheet_names),
                "hiddenSheetsExcluded": len(workbook.sheetnames) - len(visible_sheet_names),
                "limits": {
                    "rowsPerSheet": MAX_PREVIEW_ROWS,
                    "columnsPerSheet": MAX_PREVIEW_COLUMNS,
                    "sheets": MAX_PREVIEW_SHEETS,
                },
            }
        },
    )



def preview_pptx(note, file_id):
    file_record = next(
        (
            item
            for item in (note.get("files") or [])
            if item.get("fileId") == file_id
        ),
        None,
    )
    if not file_record:
        return response(404, {"error": "Source file not found"})

    filename = (file_record.get("filename") or "").lower()
    content_type = (file_record.get("contentType") or "").lower()
    is_pptx = (
        filename.endswith(".pptx")
        or content_type
        == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
    if not is_pptx:
        return response(400, {"error": "Native preview is currently available for PPTX files only"})

    obj = s3.get_object(Bucket=bucket_name, Key=file_record["key"])
    data = obj["Body"].read()

    try:
        with ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_XLSX_ZIP_ENTRIES:
                raise ValueError("Presentation contains too many internal files")

            total_size = sum(item.file_size for item in entries)
            if total_size > MAX_XLSX_UNCOMPRESSED_BYTES:
                raise ValueError("Presentation expands beyond the preview safety limit")

            slide_names = [
                name
                for name in archive.namelist()
                if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
            ]
            slide_names.sort(
                key=lambda name: int(re.search(r"slide(\d+)\.xml$", name).group(1))
            )

            slides = []
            for slide_number, slide_name in enumerate(slide_names[:MAX_PPTX_SLIDES], start=1):
                root = ET.fromstring(archive.read(slide_name))
                texts = []
                for element in root.iter():
                    if element.tag.endswith("}t") and element.text:
                        text = element.text.strip()
                        if text:
                            texts.append(text)

                joined = "\n".join(texts)
                if len(joined) > MAX_PPTX_TEXT_PER_SLIDE:
                    joined = joined[: MAX_PPTX_TEXT_PER_SLIDE - 3] + "..."

                title = texts[0] if texts else f"Slide {slide_number}"
                body = texts[1:] if len(texts) > 1 else []

                slides.append(
                    {
                        "number": slide_number,
                        "title": title[:300],
                        "text": body,
                        "allText": joined,
                    }
                )

    except BadZipFile as error:
        raise ValueError("Presentation is not a valid PPTX file") from error

    return response(
        200,
        {
            "preview": {
                "type": "pptx",
                "filename": file_record.get("filename"),
                "slides": slides,
                "slideCount": len(slide_names),
                "previewedSlideCount": len(slides),
                "truncated": len(slide_names) > MAX_PPTX_SLIDES,
                "limits": {"slides": MAX_PPTX_SLIDES},
            }
        },
    )


def file_for_preview(note, file_id):
    return next(
        (item for item in (note.get("files") or []) if item.get("fileId") == file_id),
        None,
    )


def preview_docx(note, file_id):
    file_record = file_for_preview(note, file_id)
    if not file_record:
        return response(404, {"error": "Source file not found"})

    filename = (file_record.get("filename") or "").lower()
    content_type = (file_record.get("contentType") or "").lower()
    if not (
        filename.endswith(".docx")
        or content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ):
        return response(400, {"error": "Native preview is currently available for DOCX files only"})

    data = s3.get_object(Bucket=bucket_name, Key=file_record["key"])["Body"].read()

    try:
        with ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_XLSX_ZIP_ENTRIES:
                raise ValueError("Document contains too many internal files")
            if sum(item.file_size for item in entries) > MAX_XLSX_UNCOMPRESSED_BYTES:
                raise ValueError("Document expands beyond the preview safety limit")
            if "word/document.xml" not in archive.namelist():
                raise ValueError("Document is not a valid DOCX file")
            root = ET.fromstring(archive.read("word/document.xml"))
    except BadZipFile as error:
        raise ValueError("Document is not a valid DOCX file") from error

    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    blocks = []
    text_count = 0
    truncated = False

    body = root.find("w:body", namespace)
    if body is None:
        body = root

    for child in list(body):
        if len(blocks) >= MAX_DOCX_BLOCKS or text_count >= MAX_DOCX_TEXT:
            truncated = True
            break

        if child.tag.endswith("}p"):
            texts = [
                node.text or ""
                for node in child.findall(".//w:t", namespace)
            ]
            text = "".join(texts).strip()
            if not text:
                continue

            style_node = child.find("w:pPr/w:pStyle", namespace)
            style = ""
            if style_node is not None:
                style = style_node.attrib.get(f"{{{namespace['w']}}}val", "")

            kind = "paragraph"
            heading_level = None
            match = re.fullmatch(r"Heading(\d+)", style, re.IGNORECASE)
            if match:
                heading_level = min(max(int(match.group(1)), 1), 6)
                kind = "heading"
            elif style.lower() in {"title", "subtitle"}:
                kind = style.lower()

            text_count += len(text)
            blocks.append(
                {
                    "type": kind,
                    "text": text[:4000],
                    "headingLevel": heading_level,
                }
            )

        elif child.tag.endswith("}tbl"):
            rows = []
            for row in child.findall("w:tr", namespace)[:MAX_DOCX_TABLE_ROWS]:
                cells = []
                for cell in row.findall("w:tc", namespace)[:MAX_DOCX_TABLE_COLUMNS]:
                    cell_text = " ".join(
                        (node.text or "").strip()
                        for node in cell.findall(".//w:t", namespace)
                        if (node.text or "").strip()
                    )
                    cells.append(cell_text[:1000])
                rows.append(cells)

            blocks.append(
                {
                    "type": "table",
                    "rows": rows,
                    "truncated": (
                        len(child.findall("w:tr", namespace)) > MAX_DOCX_TABLE_ROWS
                        or any(
                            len(row.findall("w:tc", namespace)) > MAX_DOCX_TABLE_COLUMNS
                            for row in child.findall("w:tr", namespace)
                        )
                    ),
                }
            )

    return response(
        200,
        {
            "preview": {
                "type": "docx",
                "filename": file_record.get("filename"),
                "blocks": blocks,
                "truncated": truncated,
            }
        },
    )


def preview_pages(note, file_id):
    file_record = file_for_preview(note, file_id)
    if not file_record:
        return response(404, {"error": "Source file not found"})

    filename = (file_record.get("filename") or "").lower()
    if not filename.endswith(".pages"):
        return response(400, {"error": "Native preview is currently available for Pages files only"})

    data = s3.get_object(Bucket=bucket_name, Key=file_record["key"])["Body"].read()

    with tempfile.NamedTemporaryFile(suffix=".pages", delete=True) as temp_file:
        temp_file.write(data)
        temp_file.flush()
        try:
            document = PagesDocument(temp_file.name)
        except Exception as error:
            raise ValueError("Pages preview is unavailable for this document version") from error

        blocks = []
        total_text = 0
        truncated = False

        for paragraph in list(document.paragraphs)[:MAX_PAGES_PARAGRAPHS]:
            text = (paragraph.text or "").strip()
            if not text:
                continue

            if total_text + len(text) > MAX_PAGES_TEXT:
                truncated = True
                break

            style_name = ""
            try:
                style = getattr(paragraph, "style", None)
                style_name = getattr(style, "name", "") or str(style or "")
            except Exception:
                style_name = ""

            kind = "paragraph"
            heading_level = None
            lowered = style_name.lower()
            match = re.search(r"heading\s*(\d+)?", lowered)
            if match:
                kind = "heading"
                heading_level = int(match.group(1) or 1)
            elif "title" in lowered:
                kind = "title"

            blocks.append(
                {
                    "type": kind,
                    "text": text[:4000],
                    "headingLevel": heading_level,
                }
            )
            total_text += len(text)

        for table_index, table in enumerate(list(document.tables)[:MAX_PAGES_TABLES], start=1):
            rows = []
            table_rows = list(table.rows)
            for row in table_rows[:MAX_PAGES_TABLE_ROWS]:
                cells = [
                    (getattr(cell, "text", "") or "")[:1000]
                    for cell in list(row.cells)[:MAX_PAGES_TABLE_COLUMNS]
                ]
                rows.append(cells)

            blocks.append(
                {
                    "type": "table",
                    "label": f"Table {table_index}",
                    "rows": rows,
                    "truncated": (
                        len(table_rows) > MAX_PAGES_TABLE_ROWS
                        or any(len(list(row.cells)) > MAX_PAGES_TABLE_COLUMNS for row in table_rows)
                    ),
                }
            )

    return response(
        200,
        {
            "preview": {
                "type": "pages",
                "filename": file_record.get("filename"),
                "blocks": blocks,
                "truncated": truncated or len(getattr(document, "paragraphs", [])) > MAX_PAGES_PARAGRAPHS,
                "bestEffort": True,
            }
        },
    )


def lambda_handler(event, context):
    params = event.get("pathParameters") or {}
    note_id = params.get("noteId")
    if not note_id:
        return response(400, {"error": "noteId is required"})

    note = get_public_note(note_id)
    if not note:
        return response(404, {"error": "Public note not found"})

    file_id = params.get("fileId")
    if file_id:
        file_record = next(
            (
                item
                for item in (note.get("files") or [])
                if item.get("fileId") == file_id
            ),
            None,
        )
        filename = ((file_record or {}).get("filename") or "").lower()
        content_type = ((file_record or {}).get("contentType") or "").lower()

        try:
            if (
                filename.endswith(".pptx")
                or content_type
                == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            ):
                return preview_pptx(note, file_id)

            if (
                filename.endswith(".docx")
                or content_type
                == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ):
                return preview_docx(note, file_id)

            if filename.endswith(".pages"):
                return preview_pages(note, file_id)

            return preview_xlsx(note, file_id)
        except ValueError as error:
            return response(400, {"error": str(error)})
        except Exception as error:
            return response(
                500,
                {"error": "Unable to build source preview"},
            )

    try:
        view_result = table.update_item(
            Key={"userId": note["userId"], "noteId": note_id},
            UpdateExpression="ADD viewCount :one",
            ConditionExpression="attribute_exists(userId) AND attribute_exists(noteId) AND visibility = :public",
            ExpressionAttributeValues={
                ":one": 1,
                ":public": "public",
            },
            ReturnValues="UPDATED_NEW",
        )
    except Exception as error:
        if getattr(error, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return response(404, {"error": "Public note not found"})
        raise

    view_count = int(view_result.get("Attributes", {}).get("viewCount", 0))

    files = []
    for file_record in note.get("files") or []:
        filename = (file_record.get("filename") or "source-file").replace('"', "'")
        view_url = s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": bucket_name,
                "Key": file_record["key"],
                "ResponseContentDisposition": "inline",
            },
            ExpiresIn=600,
        )
        download_url = s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": bucket_name,
                "Key": file_record["key"],
                "ResponseContentDisposition": f'attachment; filename="{filename}"',
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
                "downloadUrl": download_url,
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
