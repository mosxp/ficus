import json
import mimetypes
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from database import (
    SparkActionError,
    create_contact,
    list_scrapbook_pads,
    create_scrapbook_pads,
    delete_scrapbook_pad,
    list_scrapbook_stickers,
    create_scrapbook_stickers,
    get_scrapbook_sticker_image,
    delete_scrapbook_sticker,
    rename_scrapbook_sticker_collection,
    delete_scrapbook_sticker_collection,
    list_scrapbook_gifs,
    create_scrapbook_gif,
    delete_scrapbook_gif,
    get_scrapbook_setting,
    set_scrapbook_setting,
    list_scrapbook_palettes,
    create_scrapbook_palette,
    update_scrapbook_palette,
    delete_scrapbook_palette,
    DB_PATH,
    delete_contact,
    get_connection,
    init_db,
    list_checklist_templates,
    save_checklist_template,
    delete_checklist_template,
    list_contacts,
    update_contact,
)

FRONTEND_DIR = Path(__file__).resolve().parent
# Only these root files are web-served; the root also holds sparks.db and server code.
FRONTEND_SCRIPTS = {"quick_line.js", "scrapboard.js", "canvas-editor.js", "ficus_cloud.js", "space.js"}
UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
# Image + document uploads for note photos (@photo), attachments and Space blocks.
IMAGE_UPLOADS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif"}
DOCUMENT_UPLOADS = {
    ".pdf", ".txt", ".md", ".rtf", ".csv", ".json",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".pages", ".numbers", ".key", ".odt", ".ods", ".odp", ".epub", ".zip",
}
AUDIO_UPLOADS = {".m4a", ".mp3", ".wav", ".aac", ".ogg", ".oga", ".opus", ".flac", ".caf", ".weba"}
VIDEO_UPLOADS = {".mp4", ".mov", ".m4v", ".webm"}
ALLOWED_UPLOADS = IMAGE_UPLOADS | DOCUMENT_UPLOADS | AUDIO_UPLOADS | VIDEO_UPLOADS
MB = 1024 * 1024
UPLOAD_LIMITS = {**{s: 100 * MB for s in AUDIO_UPLOADS}, **{s: 500 * MB for s in VIDEO_UPLOADS}}
DEFAULT_UPLOAD_LIMIT = 25 * MB
for _mime, _ext in (
    ("audio/mp4", ".m4a"), ("audio/mpeg", ".mp3"), ("audio/wav", ".wav"), ("audio/aac", ".aac"),
    ("audio/ogg", ".ogg"), ("audio/ogg", ".oga"), ("audio/ogg", ".opus"), ("audio/flac", ".flac"),
    ("audio/x-caf", ".caf"), ("audio/webm", ".weba"), ("video/mp4", ".mp4"), ("video/quicktime", ".mov"),
    ("video/x-m4v", ".m4v"), ("video/webm", ".webm"), ("image/heic", ".heic"), ("image/heif", ".heif"),
    ("application/pdf", ".pdf"),
):
    mimetypes.add_type(_mime, _ext)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Sparks", lifespan=lifespan)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)) -> dict:
    """Store an uploaded file under /uploads for note photos, attachments, and media chips."""
    original = Path(file.filename or "file")
    suffix = original.suffix.lower()
    if suffix not in ALLOWED_UPLOADS:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    limit = UPLOAD_LIMITS.get(suffix, DEFAULT_UPLOAD_LIMIT)
    stored = f"{uuid4().hex}{suffix}"
    target = UPLOAD_DIR / stored
    size = 0
    try:
        with target.open("wb") as out:
            while chunk := await file.read(MB):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(status_code=400, detail=f"File is larger than {limit // MB}MB")
                out.write(chunk)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    if not size:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Empty file")
    return {"url": f"/uploads/{stored}", "bytes": size, "filename": original.name}


@app.get("/api/places/search")
def search_places(q: str = "", limit: int = 5) -> list[dict]:
    """Proxy OpenStreetMap Nominatim search (free, no API key) to avoid browser CORS limits."""
    query = (q or "").strip()
    if len(query) < 3:
        return []
    capped = max(1, min(int(limit or 5), 8))
    params = urllib.parse.urlencode(
        {
            "format": "json",
            "q": query,
            "addressdetails": 1,
            "limit": capped,
        }
    )
    request = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{params}",
        headers={
            "User-Agent": "SparksLocal/1.0 (place autocomplete)",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=4.0) as response:
            payload = json.loads(response.read().decode())
    except (OSError, ValueError, TypeError):
        return []
    if not isinstance(payload, list):
        return []
    results: list[dict] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        display = str(item.get("display_name") or "").strip()
        if not display:
            continue
        short = str(item.get("name") or "").strip() or display.split(",")[0].strip()
        results.append(
            {
                "name": short,
                "display_name": display,
                "lat": str(item.get("lat") or ""),
                "lon": str(item.get("lon") or ""),
            }
        )
    return results


@app.get("/api/config/cloud-storage")
def cloud_storage_config() -> dict:
    """Public cloud picker keys for Drive/Dropbox (optional env vars)."""
    google_api_key = (
        os.getenv("GOOGLE_PICKER_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or ""
    ).strip()
    google_client_id = (
        os.getenv("GOOGLE_OAUTH_CLIENT_ID")
        or os.getenv("GOOGLE_CLIENT_ID")
        or ""
    ).strip()
    google_app_id = (os.getenv("GOOGLE_APP_ID") or "").strip()
    dropbox_app_key = (
        os.getenv("DROPBOX_APP_KEY")
        or os.getenv("DROPBOX_CLIENT_ID")
        or ""
    ).strip()
    google_enabled = bool(google_api_key and google_client_id)
    return {
        "google_picker": {
            "enabled": google_enabled,
            "api_key": google_api_key if google_enabled else "",
            "client_id": google_client_id if google_enabled else "",
            "app_id": google_app_id if google_enabled else "",
        },
        "dropbox": {
            "enabled": bool(dropbox_app_key),
            "app_key": dropbox_app_key,
        },
    }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/api/health")
def health() -> dict:
    # ficus_cloud.js probes this to tell the local server apart from static hosting.
    return {"ok": True}


@app.get("/{script}.js")
def frontend_script(script: str) -> FileResponse:
    filename = f"{script}.js"
    if filename not in FRONTEND_SCRIPTS:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(FRONTEND_DIR / filename, media_type="text/javascript", headers={"Cache-Control": "no-cache"})


class ContactCreate(BaseModel):
    name: str = Field(min_length=1)
    role: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None
    is_favorite: bool = False


class ContactUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None
    is_favorite: bool | None = None


@app.get("/api/contacts")
def get_contacts(search: str | None = None) -> list[dict]:
    conn = get_connection()
    try:
        return list_contacts(conn, search)
    finally:
        conn.close()


@app.post("/api/contacts")
def post_contact(data: ContactCreate) -> dict:
    return _run_spark_change(0, lambda conn: create_contact(conn, data.model_dump()))


@app.patch("/api/contacts/{contact_id}")
def patch_contact(contact_id: int, data: ContactUpdate) -> dict:
    return _run_spark_change(
        contact_id,
        lambda conn: update_contact(conn, contact_id, data.model_dump(exclude_unset=True)),
    )


@app.delete("/api/contacts/{contact_id}")
def remove_contact(contact_id: int) -> dict:
    return _run_spark_change(contact_id, lambda conn: delete_contact(conn, contact_id))


def _run_spark_change(spark_id: int, fn) -> dict:
    conn = get_connection()
    try:
        result = fn(conn)
        conn.commit()
        return result
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


# --- Scrapbook libraries (sticky pads, stickers, palettes) ---


class ScrapbookPadItem(BaseModel):
    name: str | None = None
    src: str
    width: int | None = None
    height: int | None = None


class ScrapbookPadBatch(BaseModel):
    pads: list[ScrapbookPadItem]


class ScrapbookStickerBatch(BaseModel):
    collection: str | None = None
    stickers: list[ScrapbookPadItem]


class ScrapbookStickerCollectionRename(BaseModel):
    name: str
    new_name: str = Field(min_length=1)


class ScrapbookStickerCollectionRef(BaseModel):
    name: str


class ScrapbookPaletteIn(BaseModel):
    name: str | None = None
    colors: list[str] = Field(min_length=1, max_length=16)
    source: str | None = None


class GifServiceConfig(BaseModel):
    provider: str = Field(pattern="^(giphy|tenor)$")
    key: str = Field(min_length=8, max_length=200)


class HandwritingRequest(BaseModel):
    # Each stroke is [[x...], [y...], [t...]] in writing-area pixels.
    strokes: list[list[list[float]]]
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    language: str = "en"


HANDWRITING_ENDPOINT = "https://inputtools.google.com/request?ime=handwriting&app=jotup&cs=1&oe=UTF-8"


@app.get("/api/scrapbook/pads")
def api_list_scrapbook_pads():
    conn = get_connection()
    try:
        return list_scrapbook_pads(conn)
    finally:
        conn.close()


@app.post("/api/scrapbook/pads")
def api_create_scrapbook_pads(payload: ScrapbookPadBatch):
    conn = get_connection()
    try:
        pads = create_scrapbook_pads(conn, [item.model_dump() for item in payload.pads])
        conn.commit()
        return pads
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/scrapbook/pads/{pad_id}")
def api_delete_scrapbook_pad(pad_id: int):
    conn = get_connection()
    try:
        result = delete_scrapbook_pad(conn, pad_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/scrapbook/stickers")
def api_list_scrapbook_stickers(meta: bool = False):
    conn = get_connection()
    try:
        stickers = list_scrapbook_stickers(conn)
    finally:
        conn.close()
    if meta:
        return [{key: value for key, value in sticker.items() if key != "src"} for sticker in stickers]
    return stickers


@app.get("/api/scrapbook/stickers/{sticker_id}/image")
def api_scrapbook_sticker_image(sticker_id: int):
    conn = get_connection()
    try:
        data, media_type = get_scrapbook_sticker_image(conn, sticker_id)
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()
    return Response(content=data, media_type=media_type, headers={"Cache-Control": "public, max-age=31536000, immutable"})


def _run_sticker_write(action):
    conn = get_connection()
    try:
        result = action(conn)
        conn.commit()
        return result
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/scrapbook/stickers")
def api_create_scrapbook_stickers(payload: ScrapbookStickerBatch):
    items = [item.model_dump() for item in payload.stickers]
    return _run_sticker_write(lambda conn: create_scrapbook_stickers(conn, payload.collection, items))


@app.delete("/api/scrapbook/stickers/{sticker_id}")
def api_delete_scrapbook_sticker(sticker_id: int):
    return _run_sticker_write(lambda conn: delete_scrapbook_sticker(conn, sticker_id))


@app.post("/api/scrapbook/stickers/collections/rename")
def api_rename_scrapbook_sticker_collection(payload: ScrapbookStickerCollectionRename):
    return _run_sticker_write(lambda conn: rename_scrapbook_sticker_collection(conn, payload.name, payload.new_name))


@app.post("/api/scrapbook/stickers/collections/delete")
def api_delete_scrapbook_sticker_collection(payload: ScrapbookStickerCollectionRef):
    return _run_sticker_write(lambda conn: delete_scrapbook_sticker_collection(conn, payload.name))


@app.get("/api/scrapbook/palettes")
def api_list_scrapbook_palettes():
    conn = get_connection()
    try:
        return list_scrapbook_palettes(conn)
    finally:
        conn.close()


@app.post("/api/scrapbook/palettes")
def api_create_scrapbook_palette(payload: ScrapbookPaletteIn):
    return _run_sticker_write(lambda conn: create_scrapbook_palette(conn, payload.name, payload.colors, payload.source))


@app.put("/api/scrapbook/palettes/{palette_id}")
def api_update_scrapbook_palette(palette_id: int, payload: ScrapbookPaletteIn):
    return _run_sticker_write(lambda conn: update_scrapbook_palette(conn, palette_id, payload.name, payload.colors))


@app.delete("/api/scrapbook/palettes/{palette_id}")
def api_delete_scrapbook_palette(palette_id: int):
    return _run_sticker_write(lambda conn: delete_scrapbook_palette(conn, palette_id))


# ---------- Scrapbook GIFs: cloud search (GIPHY or Tenor), media proxy, personal library ----------

GIF_LIBRARY_DIR = DB_PATH.parent / "scrapbook_assets" / "gifs"
GIF_PROXY_HOSTS = re.compile(r"^(media\d*\.giphy\.com|i\.giphy\.com|media\d*\.tenor\.com|c\.tenor\.com)$")
GIF_PROXY_MAX_BYTES = 15_000_000
GIF_USER_AGENT = "Mozilla/5.0 (JotUp scrapbook)"


def _gif_service() -> tuple[str, str, str]:
    """(provider, key, source) — environment variables win over a key saved from the app."""
    if os.getenv("GIPHY_API_KEY"):
        return "giphy", os.getenv("GIPHY_API_KEY", "").strip(), "env"
    if os.getenv("TENOR_API_KEY"):
        return "tenor", os.getenv("TENOR_API_KEY", "").strip(), "env"
    conn = get_connection()
    try:
        provider = get_scrapbook_setting(conn, "gif_provider")
        key = get_scrapbook_setting(conn, "gif_api_key")
    finally:
        conn.close()
    return (provider, key, "app") if provider and key else ("", "", "")


def _gif_http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": GIF_USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _gif_rendition(url: str | None, width, height) -> dict | None:
    if not url:
        return None
    return {"url": url, "width": int(width or 0), "height": int(height or 0)}


def _gif_search(provider: str, key: str, query: str, kind: str, pos: str, limit: int) -> dict:
    stickers = kind == "stickers"
    if provider == "giphy":
        offset = int(pos) if pos.isdigit() else 0
        params = {"api_key": key, "limit": limit, "offset": offset, "rating": "pg-13"}
        if query:
            params["q"] = query
        endpoint = f"https://api.giphy.com/v1/{'stickers' if stickers else 'gifs'}/{'search' if query else 'trending'}"
        data = _gif_http_json(endpoint + "?" + urllib.parse.urlencode(params))
        results = []
        for item in data.get("data") or []:
            images = item.get("images") or {}
            small = images.get("fixed_width_downsampled") or images.get("fixed_width_small") or images.get("fixed_width") or {}
            full = images.get("fixed_width") or images.get("downsized") or images.get("original") or {}
            preview = _gif_rendition(small.get("url"), small.get("width"), small.get("height"))
            gif = _gif_rendition(full.get("url"), full.get("width"), full.get("height"))
            if preview and gif:
                results.append({"id": str(item.get("id")), "title": item.get("title") or "", "preview": preview, "gif": gif})
        page = data.get("pagination") or {}
        total = int(page.get("total_count") or 0)
        consumed = offset + int(page.get("count") or len(results))
        return {"results": results, "next": str(consumed) if results and consumed < min(total, 4999) else None}

    params = {"key": key, "client_key": "jotup", "limit": limit, "contentfilter": "medium",
              "media_filter": "tinygif_transparent,gif_transparent" if stickers else "tinygif,mediumgif,gif"}
    if query:
        params["q"] = query
    if stickers:
        params["searchfilter"] = "sticker"
    if pos:
        params["pos"] = pos
    endpoint = f"https://tenor.googleapis.com/v2/{'search' if query else 'featured'}"
    data = _gif_http_json(endpoint + "?" + urllib.parse.urlencode(params))
    results = []
    for item in data.get("results") or []:
        media = item.get("media_formats") or {}
        small = media.get("tinygif_transparent" if stickers else "tinygif") or {}
        full = media.get("gif_transparent") if stickers else (media.get("mediumgif") or media.get("gif"))
        full = full or {}
        sdims = small.get("dims") or [0, 0]
        fdims = full.get("dims") or [0, 0]
        preview = _gif_rendition(small.get("url"), sdims[0], sdims[1])
        gif = _gif_rendition(full.get("url"), fdims[0], fdims[1])
        if preview and gif:
            results.append({"id": str(item.get("id")), "title": item.get("content_description") or "", "preview": preview, "gif": gif})
    return {"results": results, "next": data.get("next") or None}


@app.get("/api/scrapbook/gifs/config")
def api_gif_config():
    provider, _key, source = _gif_service()
    return {"configured": bool(provider), "provider": provider or None, "source": source or None}


@app.put("/api/scrapbook/gifs/config")
def api_set_gif_config(payload: GifServiceConfig):
    key = payload.key.strip()
    try:
        _gif_search(payload.provider, key, "", "gifs", "", 1)
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 401, 403):
            name = "GIPHY" if payload.provider == "giphy" else "Tenor"
            raise HTTPException(status_code=400, detail=f"{name} rejected that key") from exc
        raise HTTPException(status_code=502, detail="GIF service unavailable") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="GIF service unavailable") from exc
    conn = get_connection()
    try:
        set_scrapbook_setting(conn, "gif_provider", payload.provider)
        set_scrapbook_setting(conn, "gif_api_key", key)
        conn.commit()
    finally:
        conn.close()
    return {"configured": True, "provider": payload.provider, "source": "app"}


@app.delete("/api/scrapbook/gifs/config")
def api_clear_gif_config():
    conn = get_connection()
    try:
        set_scrapbook_setting(conn, "gif_provider", None)
        set_scrapbook_setting(conn, "gif_api_key", None)
        conn.commit()
    finally:
        conn.close()
    return api_gif_config()


@app.get("/api/scrapbook/gifs/search")
def api_gif_search(q: str = "", kind: str = "gifs", pos: str = "", limit: int = 24):
    provider, key, _source = _gif_service()
    if not provider:
        raise HTTPException(status_code=503, detail="not_configured")
    try:
        return _gif_search(provider, key, q.strip()[:100], "stickers" if kind == "stickers" else "gifs", pos.strip()[:200], max(1, min(limit, 50)))
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=401 if exc.code in (401, 403) else 502, detail="GIF service error") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="GIF service unavailable") from exc


@app.get("/api/scrapbook/gifs/proxy")
def api_gif_proxy(url: str):
    """Same-origin copy of a GIPHY/Tenor GIF so the canvas can decode its frames."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not GIF_PROXY_HOSTS.match(parsed.hostname or ""):
        raise HTTPException(status_code=400, detail="Host not allowed")
    req = urllib.request.Request(url, headers={"User-Agent": GIF_USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read(GIF_PROXY_MAX_BYTES + 1)
            media_type = resp.headers.get_content_type() or "image/gif"
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Couldn't fetch GIF") from exc
    if len(data) > GIF_PROXY_MAX_BYTES:
        raise HTTPException(status_code=413, detail="GIF is too large")
    return Response(content=data, media_type=media_type, headers={"Cache-Control": "public, max-age=604800"})


@app.get("/api/scrapbook/gif-library")
def api_list_gif_library():
    conn = get_connection()
    try:
        return list_scrapbook_gifs(conn)
    finally:
        conn.close()


@app.post("/api/scrapbook/gif-library")
async def api_upload_gif(file: UploadFile = File(...), name: str = Form("")):
    data = await file.read(15_000_001)
    conn = get_connection()
    try:
        item = create_scrapbook_gif(conn, name or Path(file.filename or "").stem, data)
        GIF_LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
        (GIF_LIBRARY_DIR / f"{item['id']}.gif").write_bytes(data)
        conn.commit()
        return item
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/scrapbook/gif-library/{gif_id}/file")
def api_gif_library_file(gif_id: int):
    path = GIF_LIBRARY_DIR / f"{gif_id}.gif"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="GIF not found")
    return FileResponse(path, media_type="image/gif", headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.delete("/api/scrapbook/gif-library/{gif_id}")
def api_delete_gif(gif_id: int):
    return _run_sticker_write(lambda conn: delete_scrapbook_gif(conn, gif_id))


@app.post("/api/scrapbook/handwriting")
def api_recognize_handwriting(payload: HandwritingRequest):
    """Proxies ink to Google Input Tools handwriting recognition so the browser avoids CORS."""
    strokes = [s for s in payload.strokes if len(s) >= 2 and s[0] and len(s[0]) == len(s[1])][:400]
    if not strokes:
        raise HTTPException(status_code=400, detail="No ink to recognise")
    ink = []
    for s in strokes:
        xs = [round(v) for v in s[0]]
        ys = [round(v) for v in s[1]]
        ts = [round(v) for v in s[2]] if len(s) > 2 and len(s[2]) == len(xs) else []
        ink.append([xs, ys, ts] if ts else [xs, ys])
    body = {
        "options": "enable_pre_space",
        "requests": [{
            "writing_guide": {"writing_area_width": round(payload.width), "writing_area_height": round(payload.height)},
            "ink": ink,
            "language": re.sub(r"[^A-Za-z_-]", "", payload.language or "en") or "en",
        }],
    }
    req = urllib.request.Request(
        HANDWRITING_ENDPOINT,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # network / upstream failure
        raise HTTPException(status_code=502, detail="Handwriting service unavailable") from exc
    candidates: list[str] = []
    if isinstance(data, list) and data and data[0] == "SUCCESS":
        try:
            candidates = [str(c) for c in data[1][0][1]][:5]
        except (IndexError, TypeError):
            candidates = []
    return {"text": candidates[0] if candidates else "", "candidates": candidates}


class ChecklistTemplateWrite(BaseModel):
    name: str = ""
    items: list = Field(default_factory=list)


@app.get("/api/checklist-templates")
def api_list_checklist_templates():
    conn = get_connection()
    try:
        return list_checklist_templates(conn)
    finally:
        conn.close()


@app.post("/api/checklist-templates")
def api_create_checklist_template(body: ChecklistTemplateWrite):
    conn = get_connection()
    try:
        saved = save_checklist_template(conn, body.name, body.items)
        conn.commit()
        return saved
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/checklist-templates/{template_id}")
def api_update_checklist_template(template_id: int, body: ChecklistTemplateWrite):
    conn = get_connection()
    try:
        saved = save_checklist_template(conn, body.name, body.items, template_id)
        conn.commit()
        return saved
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/checklist-templates/{template_id}")
def api_delete_checklist_template(template_id: int):
    conn = get_connection()
    try:
        result = delete_checklist_template(conn, template_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
