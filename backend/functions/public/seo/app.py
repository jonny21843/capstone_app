import html
import json
import os
import re
from datetime import datetime
from urllib.parse import quote

import boto3
from boto3.dynamodb.conditions import Attr, Key


table = boto3.resource("dynamodb").Table(os.environ["NOTES_TABLE"])
site_url = os.environ.get("SITE_URL", "https://joinstudygrounds.com").rstrip("/")


def response(status_code, body, content_type="text/html; charset=utf-8", headers=None):
    merged = {
        "Content-Type": content_type,
        "Cache-Control": "public, max-age=300, s-maxage=300",
    }
    if headers:
        merged.update(headers)
    return {
        "statusCode": status_code,
        "headers": merged,
        "body": body,
    }


def slugify(value):
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug[:80] or "study-note"


def safe_public_files(note):
    return [
        item
        for item in (note.get("files") or [])
        if item.get("malwareScanStatus") in (None, "NO_THREATS_FOUND")
    ]


def get_public_note(note_id):
    result = table.query(
        IndexName="NoteIdIndex",
        KeyConditionExpression=Key("noteId").eq(note_id),
        Limit=1,
    )
    items = result.get("Items") or []
    note = items[0] if items else None
    if not note or note.get("visibility") != "public":
        return None
    if not safe_public_files(note):
        return None
    return note


def canonical_path(note):
    return f"/notes/{quote(note.get('noteId') or '')}/{slugify(note.get('title') or '')}"


def description_for(note):
    description = (note.get("description") or "").strip()
    if description:
        return description[:300]
    subject = (note.get("subject") or "study").strip()
    return f"Study notes about {subject} shared on StudyGrounds."


def note_html(note):
    title = note.get("title") or "Study note"
    description = description_for(note)
    subject = (note.get("subject") or "").strip()
    topic = (note.get("collection") or "").strip()
    author = note.get("publicAuthor") or "Community member"
    published = note.get("publishedAt") or ""
    canonical = site_url + canonical_path(note)
    interactive = f"{site_url}/?note={quote(note.get('noteId') or '')}"
    safe_files = safe_public_files(note)

    structured = {
        "@context": "https://schema.org",
        "@type": "LearningResource",
        "name": title,
        "description": description,
        "url": canonical,
        "author": {"@type": "Person", "name": author},
        "isAccessibleForFree": True,
        "learningResourceType": "Study notes",
    }
    if subject:
        structured["about"] = subject
    if published:
        structured["datePublished"] = published

    structured_json = json.dumps(structured, ensure_ascii=False).replace("</", "<\\/")
    file_items = "".join(
        f"<li>{html.escape(item.get('filename') or 'Source file')}</li>"
        for item in safe_files
    )
    taxonomy = " · ".join(value for value in [subject, topic] if value)

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)} | StudyGrounds</title>
  <meta name="description" content="{html.escape(description, quote=True)}">
  <link rel="canonical" href="{html.escape(canonical, quote=True)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="StudyGrounds">
  <meta property="og:title" content="{html.escape(title, quote=True)}">
  <meta property="og:description" content="{html.escape(description, quote=True)}">
  <meta property="og:url" content="{html.escape(canonical, quote=True)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="{html.escape(title, quote=True)}">
  <meta name="twitter:description" content="{html.escape(description, quote=True)}">
  <link rel="stylesheet" href="/styles.css">
  <script type="application/ld+json">{structured_json}</script>
</head>
<body class="seo-note-body">
  <main class="seo-note-shell">
    <a class="seo-note-brand" href="/">StudyGrounds</a>
    <article class="seo-note-card">
      <p class="eyebrow">Public study notes</p>
      <h1>{html.escape(title)}</h1>
      {f'<p class="seo-note-taxonomy">{html.escape(taxonomy)}</p>' if taxonomy else ''}
      <p class="seo-note-description">{html.escape(description)}</p>
      <div class="seo-note-meta">
        <span>By {html.escape(author)}</span>
        {f'<span>Published {html.escape(published[:10])}</span>' if published else ''}
      </div>
      <section class="seo-note-sources">
        <h2>Source material</h2>
        <ul>{file_items}</ul>
      </section>
      <a class="button button-primary seo-note-open" href="{html.escape(interactive, quote=True)}">Open this note in StudyGrounds</a>
    </article>
    <p class="seo-note-footer"><a href="/study-notes.html">Discover more public study notes</a></p>
  </main>
</body>
</html>"""


def sitemap_xml():
    notes = []
    scan_args = {"FilterExpression": Attr("visibility").eq("public")}

    while True:
        result = table.scan(**scan_args)
        notes.extend(result.get("Items") or [])
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_args["ExclusiveStartKey"] = last_key

    notes = [note for note in notes if safe_public_files(note)]
    notes.sort(key=lambda item: item.get("publishedAt", ""), reverse=True)

    entries = [
        f"""  <url>
    <loc>{html.escape(site_url + '/', quote=True)}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>""",
        f"""  <url>
    <loc>{html.escape(site_url + '/study-notes.html', quote=True)}</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>""",
    ]

    for note in notes:
        loc = site_url + canonical_path(note)
        changed = note.get("updatedAt") or note.get("publishedAt") or ""
        lastmod = changed[:10] if changed else ""
        entries.append(
            "  <url>\n"
            f"    <loc>{html.escape(loc, quote=True)}</loc>\n"
            + (f"    <lastmod>{html.escape(lastmod)}</lastmod>\n" if lastmod else "")
            + "    <changefreq>weekly</changefreq>\n"
            + "    <priority>0.7</priority>\n"
            + "  </url>"
        )

    body = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(entries)
        + "\n</urlset>\n"
    )
    return response(200, body, "application/xml; charset=utf-8")


def lambda_handler(event, context):
    raw_path = event.get("rawPath") or ""

    if raw_path == "/sitemap.xml":
        return sitemap_xml()

    params = event.get("pathParameters") or {}
    note_id = params.get("noteId")
    requested_slug = params.get("slug") or ""
    if not note_id:
        return response(404, "Not found")

    note = get_public_note(note_id)
    if not note:
        return response(
            404,
            "<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"></head><body><h1>Public note not found</h1><p><a href=\"/study-notes.html\">Browse public notes</a></p></body></html>",
            headers={"X-Robots-Tag": "noindex"},
        )

    canonical_slug = slugify(note.get("title") or "")
    if requested_slug != canonical_slug:
        location = site_url + canonical_path(note)
        return response(
            301,
            "",
            headers={
                "Location": location,
                "Cache-Control": "public, max-age=3600",
            },
        )

    return response(200, note_html(note))
