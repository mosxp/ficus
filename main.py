import json
import mimetypes
import os
import re
import time
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
    ITEM_TYPES,
    SparkActionError,
    apply_spark_action,
    convert_spark,
    clean_due_date,
    clean_due_time,
    normalize_recurrence_days,
    normalize_drop_reason,
    normalize_task_extra,
    normalize_task_status,
    normalize_entry_type,
    normalize_accent_color,
    EVENT_DEFAULT_ACCENT,
    clear_theme_of_day_for_date,
    birth_migration_history,
    local_hhmm,
    sort_stream_items_chronologically,
    create_reward,
    claim_reward,
    calendar_month,
    create_habit,
    check_in_habit,
    habit_matrix_payload,
    create_project,
    create_reference,
    create_reference_folder,
    create_notepad,
    create_contact,
    create_vault_notebook,
    create_vault_chapter,
    create_vault_line,
    reorder_vault_chapters,
    reorder_vault_lines,
    list_binder_projects,
    get_binder_project,
    create_binder_project,
    update_binder_project,
    delete_binder_project,
    create_binder_section,
    update_binder_section,
    reorder_binder_sections,
    delete_binder_section,
    create_binder_line,
    update_binder_line,
    toggle_binder_line,
    delete_binder_line,
    list_vision_boards,
    get_vision_board,
    create_vision_board,
    update_vision_board,
    save_vision_board_canvas,
    delete_vision_board,
    fulfill_vision_board,
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
    create_vision_goal,
    update_vision_goal,
    toggle_vision_goal,
    delete_vision_goal,
    attach_vision_element,
    detach_vision_element,
    create_vision_block,
    update_vision_block,
    delete_vision_block,
    create_vision_item,
    complete_vision_item,
    convert_notepad_to_tasks,
    dashboard_today,
    delete_habit,
    delete_project,
    delete_reference_folder,
    delete_reward,
    delete_notepad,
    delete_contact,
    delete_vault_notebook,
    delete_vault_chapter,
    delete_vault_line,
    delete_vision_item,
    get_connection,
    get_demo_account_id,
    get_vision_item,
    graduate_notepad,
    init_db,
    link_spark_to_vision,
    link_item_to_vision,
    unlink_item_from_vision,
    list_habits,
    list_projects,
    list_reference_folders,
    list_rewards,
    list_active_notepads,
    list_notepads,
    list_vault_notebooks,
    get_vault_notebook,
    update_vault_notebook,
    list_vault_stacks,
    create_vault_stack,
    update_vault_stack,
    delete_vault_stack,
    list_vault_shelves,
    create_vault_shelf,
    update_vault_shelf,
    delete_vault_shelf,
    reorder_vault_shelves,
    arrange_vault_shelf_stacks,
    list_checklist_templates,
    save_checklist_template,
    delete_checklist_template,
    get_theme_of_day,
    list_contacts,
    list_topic_tags,
    update_tag_record,
    update_tag_color,
    delete_tag_record,
    ensure_tag_record,
    ensure_tags_for_names,
    list_vision_items,
    legacy_hall,
    list_legacy_milestones,
    log_habit,
    move_reference,
    normalize_topic_tag,
    pending_rewards,
    add_project_phase,
    annotate_phase_tree_progress,
    attach_notes_to_projects,
    attach_tasks_to_phases,
    build_phase_tree,
    create_note,
    delete_note,
    delete_project_phase,
    get_note,
    list_project_notes,
    phases_from_extra,
    update_note,
    pin_reference,
    rename_reference_folder,
    replace_project_phases,
    set_habit_status,
    set_project_deadline,
    set_project_status,
    set_vision_status,
    set_vision_reward,
    set_project_reward,
    set_habit_reward,
    send_reference_to_project,
    serialize_spark,
    update_spark_position,
    next_spark_desk_position,
    find_active_schedule_log,
    refresh_active_schedule_log,
    dedupe_active_schedule_logs,
    transform_spark,
    toggle_vision_pin,
    update_project,
    update_project_phase,
    reorder_phase_canvas_items,
    reorder_project_canvas_items,
    reorder_phase_subphases,
    update_habit,
    update_reference,
    update_notepad,
    update_contact,
    update_vault_chapter,
    update_vault_line,
    schedule_task,
    update_task,
    delete_task,
    update_vision_item,
    utc_now,
    vision_history,
)

FRONTEND_DIR = Path(__file__).resolve().parent
# Only these root files are web-served; the root also holds sparks.db and server code.
FRONTEND_SCRIPTS = {"quick_line.js", "scrapboard.js", "canvas-editor.js", "ficus_cloud.js"}
UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
# Image + document uploads for note photos (@photo), attachments, habits, vault.
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


class SparkCreate(BaseModel):
    title: str = Field(min_length=1)
    raw_content: str | None = None
    source_url: str | None = None
    topic_tag: str | None = None
    source_type: str | None = None
    notes: str | None = None
    extra_data: dict | None = None
    migration_history: list | None = None
    intent_hint: str | None = None
    quick_mark: str | None = None
    is_highlighted: bool | None = None
    photo_url: str | None = None
    link_url: str | None = None
    tags: list[str] | None = None
    entities: list | None = None
    blocks: list | None = None
    pos_x: int | None = None
    pos_y: int | None = None
    color_theme: str | None = None
    group_name: str | None = None


class SparkUpdate(BaseModel):
    title: str = Field(min_length=1)
    raw_content: str | None = None
    source_url: str | None = None
    topic_tag: str | None = None
    notes: str | None = None
    extra_data: dict | None = None
    intent_hint: str | None = None
    quick_mark: str | None = None
    is_highlighted: bool | None = None
    photo_url: str | None = None
    link_url: str | None = None
    tags: list[str] | None = None
    entities: list | None = None
    blocks: list | None = None
    migration_history: list | None = None
    pos_x: int | None = None
    pos_y: int | None = None
    color_theme: str | None = None
    group_name: str | None = None


class SparkPositionUpdate(BaseModel):
    pos_x: int
    pos_y: int


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


_WEATHER_CACHE: dict = {"at": 0.0, "data": None}
_WEATHER_CODES = {
    0: ("Clear", "☀️"),
    1: ("Mainly clear", "🌤️"),
    2: ("Partly cloudy", "⛅"),
    3: ("Cloudy", "☁️"),
    45: ("Fog", "🌫️"),
    48: ("Fog", "🌫️"),
    51: ("Drizzle", "🌦️"),
    61: ("Rain", "🌧️"),
    63: ("Rain", "🌧️"),
    65: ("Heavy rain", "🌧️"),
    71: ("Snow", "🌨️"),
    80: ("Showers", "🌦️"),
    95: ("Storm", "⛈️"),
}


def _weather_now() -> dict:
    cached = _WEATHER_CACHE.get("data")
    if cached and time.monotonic() - float(_WEATHER_CACHE["at"]) < 1200:
        return cached
    fallback = {"temp": "—", "condition": "Unavailable", "icon": "☁️"}
    try:
        request = urllib.request.Request(
            "https://api.open-meteo.com/v1/forecast?latitude=-33.87&longitude=151.21&current=temperature_2m,weather_code",
            headers={"User-Agent": "Sparks"},
        )
        with urllib.request.urlopen(request, timeout=2.5) as response:
            payload = json.loads(response.read().decode())
        current = payload.get("current") or {}
        code = int(current.get("weather_code") or 0)
        condition, icon = _WEATHER_CODES.get(code, ("Mixed", "🌤️"))
        weather = {
            "temp": f"{round(float(current['temperature_2m']))}°C",
            "condition": condition,
            "icon": icon,
        }
    except (OSError, ValueError, KeyError, TypeError):
        weather = fallback
    _WEATHER_CACHE["at"] = time.monotonic()
    _WEATHER_CACHE["data"] = weather
    return weather


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


@app.get("/api/vision")
def get_vision(status: str | None = None) -> list[dict]:
    conn = get_connection()
    try:
        return list_vision_items(conn, status)
    finally:
        conn.close()


@app.get("/api/vision/{item_id}")
def get_vision_detail(item_id: str) -> dict:
    conn = get_connection()
    try:
        return get_vision_item(conn, item_id)
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/vision/{item_id}/history")
def get_vision_history(item_id: str) -> list[dict]:
    conn = get_connection()
    try:
        return vision_history(conn, item_id)
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/vision")
async def add_vision(
    file: UploadFile = File(...),
    caption: str = Form(""),
    horizon_tag: str = Form("Year Vision"),
    target_date: str = Form(""),
    manifesto_notes: str = Form(""),
) -> dict:
    suffix = Path(file.filename or "image").suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        raise HTTPException(status_code=400, detail="Choose a photo")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File is larger than 8MB")
    stored = f"{uuid4().hex}{suffix}"
    (UPLOAD_DIR / stored).write_bytes(data)
    conn = get_connection()
    try:
        created = create_vision_item(
            conn,
            f"/uploads/{stored}",
            caption,
            horizon_tag,
            target_date,
            manifesto_notes,
        )
        conn.commit()
        return created
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


class VisionPhoto(BaseModel):
    url: str
    is_cover: bool = False
    caption: str = ""


class VisionWrite(BaseModel):
    caption: str | None = None
    horizon_tag: str | None = None
    target_date: str | None = None
    manifesto_notes: str | None = None
    photos: list[VisionPhoto | str] | None = None
    display_style: str | None = None
    add_photo: str | None = None


@app.patch("/api/vision/{item_id}")
def patch_vision(item_id: str, payload: VisionWrite) -> dict:
    """Update caption, horizon, target date (nullable), manifesto, photos, and display style."""
    fields = payload.model_dump(exclude_unset=True)
    return _run_spark_change(0, lambda conn: update_vision_item(conn, item_id, fields))


class VisionStatus(BaseModel):
    status: str


@app.patch("/api/vision/{item_id}/status")
def vision_status_route(item_id: str, payload: VisionStatus) -> dict:
    return _run_spark_change(0, lambda conn: set_vision_status(conn, item_id, payload.status))


class VisionRewardElement(BaseModel):
    type: str
    title: str | None = None
    url: str | None = None
    content: str | None = None


class VisionRewardWrite(BaseModel):
    title: str | None = None
    elements: list[VisionRewardElement] | None = None
    reward: dict | None = None


@app.patch("/api/vision/{item_id}/reward")
def vision_reward_route(item_id: str, payload: VisionRewardWrite) -> dict:
    data = payload.model_dump(exclude_unset=True)
    if "reward" in data and data["reward"] is not None:
        reward_payload = data["reward"]
    elif data.get("title") is None and data.get("elements") is None:
        reward_payload = None
    else:
        reward_payload = {
            "title": data.get("title") or "",
            "elements": data.get("elements") or [],
        }
    return _run_spark_change(0, lambda conn: set_vision_reward(conn, item_id, reward_payload))


@app.patch("/api/visions/{item_id}/reward")
def visions_reward_route(item_id: str, payload: VisionRewardWrite) -> dict:
    return vision_reward_route(item_id, payload)


@app.delete("/api/vision/{item_id}/reward")
def vision_reward_clear_route(item_id: str) -> dict:
    return _run_spark_change(0, lambda conn: set_vision_reward(conn, item_id, None))


class VisionComplete(BaseModel):
    reflection_note: str = ""


@app.patch("/api/vision/{item_id}/complete")
def complete_vision_route(item_id: str, payload: VisionComplete) -> dict:
    return _run_spark_change(0, lambda conn: complete_vision_item(conn, item_id, payload.reflection_note))


@app.delete("/api/vision/{item_id}")
def remove_vision(item_id: str) -> dict:
    return _run_spark_change(0, lambda conn: delete_vision_item(conn, item_id))


class VisionLink(BaseModel):
    linked_vision_id: int | None = None


@app.patch("/api/sparks/{spark_id}/link-vision")
def link_vision_route(spark_id: int, payload: VisionLink) -> dict:
    return _run_spark_change(
        spark_id,
        lambda conn: link_spark_to_vision(conn, spark_id, payload.linked_vision_id),
    )


class VisionItemLink(BaseModel):
    item_type: str
    item_id: int


@app.post("/api/vision/{item_id}/link")
def vision_link_route(item_id: str, payload: VisionItemLink) -> dict:
    if not str(item_id).isdigit():
        raise HTTPException(status_code=400, detail="Invalid vision id")
    return _run_spark_change(
        0,
        lambda conn: link_item_to_vision(conn, int(item_id), payload.item_type, payload.item_id),
    )


@app.delete("/api/vision/{item_id}/unlink")
def vision_unlink_route(item_id: str, payload: VisionItemLink) -> dict:
    if not str(item_id).isdigit():
        raise HTTPException(status_code=400, detail="Invalid vision id")
    return _run_spark_change(
        0,
        lambda conn: unlink_item_from_vision(conn, int(item_id), payload.item_type, payload.item_id),
    )


# Alias plural path used by some clients
@app.post("/api/visions/{item_id}/link")
def visions_link_route(item_id: str, payload: VisionItemLink) -> dict:
    return vision_link_route(item_id, payload)


@app.delete("/api/visions/{item_id}/unlink")
def visions_unlink_route(item_id: str, payload: VisionItemLink) -> dict:
    return vision_unlink_route(item_id, payload)


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1)
    deadline: str | None = None
    phase_title: str | None = None
    linked_vision_id: int | None = None


@app.post("/api/workbench/projects")
def create_project_route(payload: ProjectCreate) -> dict:
    conn = get_connection()
    try:
        account_id = get_demo_account_id(conn)
        created = create_project(
            conn,
            account_id,
            payload.title,
            deadline=payload.deadline,
            phase_title=payload.phase_title,
            linked_vision_id=payload.linked_vision_id,
        )
        conn.commit()
        projects = [created]
        attach_notes_to_projects(conn, projects)
        return projects[0]
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


class ProjectDeadline(BaseModel):
    deadline: str | None = None


@app.patch("/api/workbench/projects/{project_id}/deadline")
def project_deadline_route(project_id: int, payload: ProjectDeadline) -> dict:
    return _run_spark_change(project_id, lambda conn: set_project_deadline(conn, project_id, payload.deadline))


class VisionPin(BaseModel):
    url: str = Field(min_length=1)
    phase_id: str | None = None
    is_vision: bool | None = None


@app.patch("/api/sparks/{spark_id}/toggle-vision-pin")
def toggle_vision_pin_route(spark_id: int, payload: VisionPin) -> dict:
    return _run_spark_change(
        spark_id,
        lambda conn: toggle_vision_pin(conn, spark_id, payload.url, payload.phase_id, payload.is_vision),
    )


@app.get("/api/dashboard/today")
def dashboard_route() -> dict:
    conn = get_connection()
    try:
        board = dashboard_today(conn)
        board["weather"] = _weather_now()
        return board
    finally:
        conn.close()


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


@app.post("/api/sparks")
def create_spark(payload: SparkCreate) -> dict:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    now = utc_now()
    stamp = local_hhmm()
    history = payload.migration_history if isinstance(payload.migration_history, list) and payload.migration_history else birth_migration_history("spark", stamp)
    extra = dict(payload.extra_data or {})
    extra["migration_history"] = history
    if payload.notes:
        extra["notes"] = payload.notes
        extra["rich_notes"] = payload.notes
    intent = str(payload.intent_hint or payload.quick_mark or "").strip().lower()
    extra["intent_hint"] = intent if intent in ("task", "event", "log") else None
    extra["quick_mark"] = extra["intent_hint"] or "none"
    extra["is_highlighted"] = bool(payload.is_highlighted)
    photo = str(payload.photo_url or "").strip() or None
    link = str(payload.link_url or payload.source_url or "").strip() or None
    extra["photo_url"] = photo
    extra["link_url"] = link
    tags = []
    if isinstance(payload.tags, list):
        for tag in payload.tags:
            cleaned = normalize_topic_tag(tag)
            if cleaned and cleaned not in tags:
                tags.append(cleaned)
    if payload.topic_tag:
        cleaned = normalize_topic_tag(payload.topic_tag)
        if cleaned and cleaned not in tags:
            tags.insert(0, cleaned)
    extra["tags"] = tags
    entities = []
    raw_entities = payload.entities if isinstance(payload.entities, list) else (extra.get("entities") if isinstance(extra.get("entities"), list) else [])
    for row in raw_entities or []:
        if not isinstance(row, dict):
            continue
        etype = str(row.get("type") or row.get("kind") or "").strip().lower()
        name = str(row.get("name") or row.get("label") or row.get("val") or "").strip()
        if not etype or not name or etype not in ("person", "place"):
            continue
        entity = {"type": etype, "name": name}
        url = str(row.get("url") or "").strip()
        if url:
            entity["url"] = url
        contact_id = row.get("contact_id") or row.get("contactId")
        if contact_id not in (None, ""):
            entity["contact_id"] = str(contact_id)
        entities.append(entity)
    extra["entities"] = entities
    blocks = []
    raw_blocks = payload.blocks if isinstance(payload.blocks, list) else (extra.get("blocks") if isinstance(extra.get("blocks"), list) else [])
    for row in raw_blocks or []:
        if not isinstance(row, dict):
            continue
        btype = str(row.get("type") or row.get("kind") or "").strip().lower()
        if btype == "photo":
            url = str(row.get("url") or row.get("src") or row.get("photo_url") or "").strip()
            if not url:
                continue
            blocks.append({
                "id": str(row.get("id") or ""),
                "type": "photo",
                "url": url,
                "caption": str(row.get("caption") or "").strip(),
                "filename": str(row.get("filename") or row.get("name") or "").strip(),
                "size": "expanded" if str(row.get("size") or "").strip().lower() == "expanded" else "compact",
            })
        elif btype == "link":
            url = str(row.get("url") or row.get("href") or "").strip()
            if not url:
                continue
            preview = row.get("preview") if isinstance(row.get("preview"), dict) else None
            mode = str(row.get("display_mode") or row.get("layout") or "compact").strip().lower()
            if mode not in ("compact", "card"):
                mode = "compact"
            preview_image = str(row.get("preview_image") or (preview or {}).get("image") or (preview or {}).get("thumbnail") or "").strip()
            description = str(row.get("description") or (preview or {}).get("description") or "").strip()
            blocks.append({
                "id": str(row.get("id") or ""),
                "type": "link",
                "url": url,
                "title": str(row.get("title") or row.get("label") or "").strip(),
                "display_mode": mode,
                "preview_image": preview_image,
                "description": description,
                "preview": preview,
            })
    if not blocks:
        if photo:
            blocks.append({"id": "", "type": "photo", "url": photo, "caption": "", "filename": "", "size": "compact"})
        if link:
            blocks.append({"id": "", "type": "link", "url": link, "title": "", "display_mode": "compact", "preview_image": "", "description": "", "preview": None})
    extra["blocks"] = blocks
    if blocks:
        photo_block = next((b for b in blocks if b["type"] == "photo"), None)
        link_block = next((b for b in blocks if b["type"] == "link"), None)
        if photo_block:
            extra["photo_url"] = photo_block["url"]
            photo = photo_block["url"]
        if link_block:
            extra["link_url"] = link_block["url"]
            link = link_block["url"]
    topic = tags[0] if tags else normalize_topic_tag(payload.topic_tag)
    theme = str(payload.color_theme or "beige").strip().lower() or "beige"
    if theme not in ("warm_gray", "beige", "sage", "coffee", "rose", "blue"):
        theme = "beige"
    group_name = str(payload.group_name).strip() if payload.group_name not in (None, "") else None
    conn = get_connection()
    try:
        account_id = get_demo_account_id(conn)
        if tags:
            ensure_tags_for_names(conn, tags)
        if payload.pos_x is None or payload.pos_y is None:
            auto_x, auto_y = next_spark_desk_position(conn)
            pos_x = auto_x if payload.pos_x is None else int(payload.pos_x)
            pos_y = auto_y if payload.pos_y is None else int(payload.pos_y)
        else:
            pos_x = int(payload.pos_x)
            pos_y = int(payload.pos_y)
        cursor = conn.execute(
            """
            INSERT INTO sparks (
                account_id, title, raw_content, source_url, topic_tag,
                source_type, status, promoted_to_type, promoted_to_id,
                graduated_at, created_at, updated_at, item_type, extra_data, notes,
                pos_x, pos_y, color_theme, group_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                account_id,
                title,
                (payload.raw_content or "").strip() or None,
                link,
                topic,
                (payload.source_type or "").strip() or None,
                "in_cloud",
                None,
                None,
                None,
                now,
                now,
                "spark",
                json.dumps(extra),
                payload.notes,
                pos_x,
                pos_y,
                theme,
                group_name,
            ),
        )
        conn.commit()
        spark_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
        return serialize_spark(row)
    finally:
        conn.close()


@app.post("/api/sparks/{spark_id}/position")
def set_spark_position(spark_id: int, payload: SparkPositionUpdate) -> dict:
    return _run_spark_change(
        spark_id,
        lambda conn: update_spark_position(conn, spark_id, payload.pos_x, payload.pos_y),
    )


@app.get("/api/tags")
def list_tags() -> list[dict]:
    conn = get_connection()
    try:
        result = list_topic_tags(conn)
        conn.commit()
        return result
    finally:
        conn.close()


class TagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class TagColorUpdate(BaseModel):
    color: str


@app.patch("/api/tags/{tag_name}/color")
def update_tag_color_route(tag_name: str, payload: TagColorUpdate) -> dict:
    decoded = urllib.parse.unquote(tag_name or "").lstrip("#")
    return _run_spark_change(
        0,
        lambda conn: update_tag_color(conn, decoded, payload.color),
    )


@app.patch("/api/tags/{tag_name:path}")
def patch_tag(tag_name: str, payload: TagUpdate) -> dict:
    # Accept "#finance", "finance", or URL-encoded forms (rename / general update).
    decoded = urllib.parse.unquote(tag_name or "").lstrip("#")
    # Avoid shadowing the dedicated /color route if a path slips through.
    if decoded.endswith("/color") or decoded.endswith("\\color"):
        decoded = decoded[: -len("/color")].rstrip("/\\")
        if payload.color is not None:
            return _run_spark_change(
                0,
                lambda conn: update_tag_color(conn, decoded, payload.color),
            )
    return _run_spark_change(
        0,
        lambda conn: update_tag_record(conn, decoded, payload.model_dump(exclude_unset=True)),
    )


@app.put("/api/tags/{tag_name:path}")
def put_tag(tag_name: str, payload: TagUpdate) -> dict:
    decoded = urllib.parse.unquote(tag_name or "").lstrip("#")
    return _run_spark_change(
        0,
        lambda conn: update_tag_record(conn, decoded, payload.model_dump(exclude_unset=True)),
    )


@app.delete("/api/tags/{tag_name:path}")
def delete_tag(tag_name: str) -> dict:
    decoded = urllib.parse.unquote(tag_name or "").lstrip("#")
    return _run_spark_change(
        0,
        lambda conn: delete_tag_record(conn, decoded),
    )


@app.post("/api/tags")
def create_tag_route(payload: TagUpdate) -> dict:
    if not payload.name:
        raise HTTPException(status_code=400, detail="Tag name is required")
    return _run_spark_change(
        0,
        lambda conn: ensure_tag_record(conn, payload.name, payload.color or "slate"),
    )


def _list_items(item_type: str, order_sql: str) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            f"""
            SELECT * FROM sparks
            WHERE status = 'in_cloud' AND item_type = ?
            {order_sql}
            """,
            (item_type,),
        ).fetchall()
        return [serialize_spark(row) for row in rows]
    finally:
        conn.close()


def _annotate_task(conn, task: dict) -> dict:
    project_id = task.get("project_id")
    if not project_id:
        task["project_title"] = None
        task["phase_title"] = None
        return task
    project = conn.execute(
        "SELECT title, extra_data FROM sparks WHERE id = ? AND item_type = 'project'",
        (project_id,),
    ).fetchone()
    if not project:
        task["project_title"] = None
        task["phase_title"] = None
        return task
    task["project_title"] = project["title"]
    phase_title = None
    for phase in phases_from_extra(project["extra_data"]):
        if phase["id"] == task.get("phase_id"):
            phase_title = phase.get("title") or ""
            break
    task["phase_title"] = phase_title
    return task


def _annotate_project_tasks(projects: list[dict], tasks: list[dict]) -> None:
    names = {project["id"]: project["title"] for project in projects}
    phase_titles: dict[tuple[int, str], str] = {}
    buckets: dict[tuple[int, str], list[dict]] = {}
    for project in projects:
        # Preserve project-level canvas fields from serialize_spark
        color_theme = project.get("color_theme") or "slate"
        details = project.get("details") or ""
        links = list(project.get("links") or [])
        attachments = list(project.get("attachments") or [])
        canvas_items = list(project.get("canvas_items") or [])
        phases = project["extra_data"] if isinstance(project["extra_data"], list) else phases_from_extra(project.get("extra_data"))
        project["extra_data"] = phases
        linked = attach_tasks_to_phases(phases, [])
        for phase in linked:
            phase_titles[(project["id"], phase["id"])] = phase.get("title") or ""
            buckets[(project["id"], phase["id"])] = phase["tasks"]
        project["phases"] = linked
        project["phase_tree"] = []
        project["color_theme"] = color_theme
        project["details"] = details
        project["links"] = links
        project["attachments"] = attachments
        project["canvas_items"] = canvas_items
        project["tasks"] = []
    project_tasks: dict[int, list[dict]] = {project["id"]: [] for project in projects}
    for task in tasks:
        project_id = task.get("project_id")
        task["project_title"] = names.get(project_id)
        task["phase_title"] = phase_titles.get((project_id, task.get("phase_id")))
        phase_id = task.get("phase_id")
        if phase_id:
            bucket = buckets.get((project_id, phase_id))
            if bucket is not None:
                bucket.append(task)
        elif project_id in project_tasks:
            project_tasks[project_id].append(task)
        if project_id in project_tasks and phase_id:
            # Keep full project task list available separately from unphased bucket
            pass
    for project in projects:
        project["tasks"] = project_tasks.get(project["id"], [])
        tree = build_phase_tree(project["phases"])
        annotate_phase_tree_progress(tree)
        project["phase_tree"] = tree
        # Mirror progress_pct onto flat phase list
        progress_map = {}
        stack = list(tree)
        while stack:
            node = stack.pop()
            progress_map[node["id"]] = {
                "progress_pct": node.get("progress_pct", 0),
                "is_done": node.get("is_done"),
                "children": node.get("children") or [],
            }
            stack.extend(node.get("children") or [])
        for phase in project["phases"]:
            meta = progress_map.get(phase["id"]) or {}
            phase["progress_pct"] = meta.get("progress_pct", 0)
            if "is_done" in meta:
                phase["is_done"] = meta["is_done"]
            phase["children"] = meta.get("children") or []


def _attach_notes(conn, projects: list[dict]) -> None:
    attach_notes_to_projects(conn, projects)



def _typed_rows(conn, item_type: str, order_sql: str) -> list[dict]:
    rows = conn.execute(
        f"""
        SELECT * FROM sparks
        WHERE status = 'in_cloud' AND item_type = ?
        {order_sql}
        """,
        (item_type,),
    ).fetchall()
    return [serialize_spark(row) for row in rows]


@app.get("/api/sparks")
def list_inbox_sparks() -> list[dict]:
    return _list_items("spark", "ORDER BY created_at DESC")


@app.get("/api/logs")
def list_logs(date: str | None = None) -> list[dict]:
    """Daily Stream feed for a calendar day — strict HH:MM ascending, no task_id grouping."""
    day = str(date or "").strip()[:10]
    conn = get_connection()
    try:
        tasks = _typed_rows(
            conn,
            "task",
            "ORDER BY id ASC",
        )
        sparks = _typed_rows(
            conn,
            "spark",
            "ORDER BY id ASC",
        )
        if day:
            def on_day(row: dict) -> bool:
                extra = row.get("extra_data") if isinstance(row.get("extra_data"), dict) else {}
                stream_date = str(extra.get("stream_date") or "").strip()[:10]
                if stream_date:
                    return stream_date == day
                for key in ("due_date", "start_date"):
                    value = str(row.get(key) or "").strip()[:10]
                    if value == day:
                        return True
                created = str(row.get("created_at") or "").strip()[:10]
                return created == day

            tasks = [row for row in tasks if on_day(row)]
            sparks = [row for row in sparks if str(row.get("created_at") or "").strip()[:10] == day]
        # Pure chronological stream (ORDER BY time ASC, id ASC).
        return sort_stream_items_chronologically([*sparks, *tasks])
    finally:
        conn.close()


@app.get("/api/tasks")
def list_tasks(parked: bool | None = None, date: str | None = None) -> list[dict]:
    conn = get_connection()
    try:
        tasks = _typed_rows(
            conn,
            "task",
            """
            ORDER BY CASE WHEN due_date IS NULL OR due_date = '' THEN 1 ELSE 0 END,
                     due_date,
                     CASE WHEN due_time IS NULL OR due_time = '' THEN 1 ELSE 0 END,
                     due_time,
                     id ASC
            """,
        )
        if parked is True:
            tasks = [task for task in tasks if task.get("is_parked")]
        elif parked is False:
            tasks = [task for task in tasks if not task.get("is_parked")]
        if date:
            day = str(date).strip()[:10]
            filtered = []
            for task in tasks:
                extra = task.get("extra_data") if isinstance(task.get("extra_data"), dict) else {}
                stream_date = str(extra.get("stream_date") or "").strip()[:10]
                if stream_date:
                    if stream_date == day:
                        filtered.append(task)
                    continue
                due = str(task.get("due_date") or task.get("start_date") or "").strip()[:10]
                if due == day:
                    filtered.append(task)
            tasks = sort_stream_items_chronologically(filtered)
        projects = _typed_rows(conn, "project", "ORDER BY id ASC")
        _annotate_project_tasks(projects, tasks)
        return tasks
    finally:
        conn.close()


@app.get("/api/workbench/projects")
def list_projects_route(status: str | None = None) -> list[dict]:
    conn = get_connection()
    try:
        projects = list_projects(conn, status)
        tasks = _typed_rows(conn, "task", "ORDER BY due_date, due_time, title")
        _annotate_project_tasks(projects, tasks)
        attach_notes_to_projects(conn, projects)
        return projects
    finally:
        conn.close()


@app.get("/api/habits")
def list_habits_route(
    status: str | None = None,
    include_archived: bool = False,
    range: str | None = None,
) -> list[dict]:
    conn = get_connection()
    try:
        if range:
            return habit_matrix_payload(conn, range, "all" if include_archived and not status else status)
        return list_habits(conn, status, include_archived)
    finally:
        conn.close()


class HabitWrite(BaseModel):
    title: str = Field(min_length=1)
    raw_content: str | None = None
    notes: str | None = None
    frequency_type: str = "weekly"
    target_days: list[int] = Field(default_factory=list)
    time_of_day: str = "Any Time"
    scheduled_time: str | None = None
    tracking_type: str = "boolean"
    measure_unit: str | None = None
    measure_target: float | None = None
    metrics: list[dict] | None = None
    tracking_config: dict | None = None
    enable_submission: bool | None = None
    submission_types: list[str] | None = None
    vault_folder: str | None = None
    linked_vision_id: int | None = None
    reward: dict | None = None
    icon: str | None = None


class HabitLog(BaseModel):
    date: str
    completed: bool | None = None
    value: float | None = None
    values: dict | None = None
    note: str | None = None
    reflection_html: str | None = None
    measured_value: float | None = None
    measured_unit: str | None = None
    target_value: float | None = None
    link: str | None = None
    attachment_url: str | None = None
    photos: list | None = None
    links: list[dict] | None = None
    files: list[dict] | None = None
    logged_at: str | None = None


@app.post("/api/habits")
def create_habit_route(payload: HabitWrite) -> dict:
    conn = get_connection()
    try:
        account_id = get_demo_account_id(conn)
        data = payload.model_dump()
        notes = payload.notes if payload.notes is not None else payload.raw_content
        created = create_habit(conn, account_id, payload.title, notes, data)
        conn.commit()
        return created
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.patch("/api/habits/{habit_id}")
@app.put("/api/habits/{habit_id}")
def update_habit_route(habit_id: int, payload: HabitWrite) -> dict:
    data = payload.model_dump(exclude_unset=True)
    if "notes" in data and "raw_content" not in data:
        data["raw_content"] = data.get("notes")
    return _run_spark_change(
        habit_id,
        lambda conn: update_habit(conn, habit_id, data),
    )


class HabitStatus(BaseModel):
    status: str


@app.patch("/api/habits/{habit_id}/status")
def habit_status_route(habit_id: int, payload: HabitStatus) -> dict:
    return _run_spark_change(habit_id, lambda conn: set_habit_status(conn, habit_id, payload.status))


@app.post("/api/habits/{habit_id}/graduate")
def habit_graduate_route(habit_id: int) -> dict:
    return _run_spark_change(habit_id, lambda conn: set_habit_status(conn, habit_id, "graduated"))


@app.delete("/api/habits/{habit_id}")
def delete_habit_route(habit_id: int) -> dict:
    conn = get_connection()
    try:
        deleted = delete_habit(conn, habit_id)
        conn.commit()
        return deleted
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


class HabitRewardWrite(BaseModel):
    reward: dict | None = None
    title: str | None = None
    elements: list | None = None
    target_streak: int | None = None


@app.patch("/api/habits/{habit_id}/reward")
def habit_reward_route(habit_id: int, payload: HabitRewardWrite) -> dict:
    body = payload.model_dump(exclude_unset=True)
    if "reward" in body and body["reward"] is not None:
        reward_payload = body["reward"]
    elif body.get("title"):
        reward_payload = {
            "title": body.get("title"),
            "elements": body.get("elements") or [],
            "target_streak": body.get("target_streak"),
        }
    else:
        reward_payload = None
    return _run_spark_change(habit_id, lambda conn: set_habit_reward(conn, habit_id, reward_payload))


@app.delete("/api/habits/{habit_id}/reward")
def habit_reward_delete(habit_id: int) -> dict:
    return _run_spark_change(habit_id, lambda conn: set_habit_reward(conn, habit_id, None))


@app.patch("/api/habits/{habit_id}/log")
def log_habit_route(habit_id: int, payload: HabitLog) -> dict:
    extras = payload.model_dump(exclude_unset=True)
    if extras.get("reflection_html") and not extras.get("note"):
        extras["note"] = extras.get("reflection_html")
    if extras.get("measured_value") is not None and extras.get("value") is None:
        extras["value"] = extras.get("measured_value")
    return _run_spark_change(
        habit_id,
        lambda conn: log_habit(
            conn,
            habit_id,
            payload.date,
            payload.completed,
            extras.get("value", payload.value),
            payload.values,
            extras,
        ),
    )


@app.post("/api/habits/{habit_id}/check-in")
def check_in_habit_route(habit_id: int, payload: HabitLog) -> dict:
    submission = payload.model_dump(exclude_unset=True)
    return _run_spark_change(
        habit_id,
        lambda conn: check_in_habit(conn, habit_id, payload.date, submission),
    )


@app.get("/api/reference-folders")
def list_folders() -> list[dict]:
    conn = get_connection()
    try:
        return list_reference_folders(conn)
    finally:
        conn.close()


class FolderCreate(BaseModel):
    name: str = Field(min_length=1)
    parent_id: int | None = None
    icon: str | None = "📁"


class FolderUpdate(BaseModel):
    name: str = Field(min_length=1)


class ReferenceWrite(BaseModel):
    title: str = Field(min_length=1)
    raw_content: str | None = None
    source_url: str | None = None
    topic_tag: str | None = None
    tags: list[str] | None = None
    folder_id: int | None = None
    folder_name: str | None = None
    is_pinned: bool | None = None
    attachments: list | None = None
    link_preview: dict | None = None
    rich_notes: str | None = None
    content: str | None = None
    sketch_data: str | None = None
    echo_to_home: bool | None = None
    daily_echo: bool | None = None
    echo_frequency: str | None = None
    extra_data: dict | None = None


class ReferenceMove(BaseModel):
    folder_id: int | None = None


class ReferencePin(BaseModel):
    is_pinned: bool | None = None


class ReferenceSend(BaseModel):
    project_id: int
    phase_id: str | None = None


@app.post("/api/reference-folders")
def create_folder(data: FolderCreate) -> dict:
    return _run_spark_change(0, lambda conn: create_reference_folder(conn, data.name, data.parent_id, data.icon))


@app.patch("/api/reference-folders/{folder_id}")
def update_folder(folder_id: int, data: FolderUpdate) -> dict:
    return _run_spark_change(folder_id, lambda conn: rename_reference_folder(conn, folder_id, data.name))


@app.delete("/api/reference-folders/{folder_id}")
def remove_folder(folder_id: int) -> dict:
    return _run_spark_change(folder_id, lambda conn: delete_reference_folder(conn, folder_id))


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


@app.get("/api/references")
def list_references(
    folder_id: str | None = None,
    search: str | None = None,
    tag: str | None = None,
) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT r.*, f.name AS folder_name
            FROM sparks r
            LEFT JOIN reference_folders f ON r.folder_id = f.id
            WHERE r.status = 'in_cloud' AND r.item_type = 'reference'
            ORDER BY r.is_pinned DESC, r.title COLLATE NOCASE
            """
        ).fetchall()
        items = []
        for row in rows:
            item = serialize_spark(row)
            item["folder_name"] = row["folder_name"]
            items.append(item)
        scope_all = folder_id is None or folder_id in ("", "all", "null")
        if not scope_all:
            if folder_id in ("none", "unfiled"):
                items = [item for item in items if not item.get("folder_id")]
            else:
                items = [item for item in items if item.get("folder_id") == int(folder_id)]
        if search and search.strip():
            needle = search.strip().lower()
            items = [
                item for item in items
                if needle in _reference_haystack(item)
            ]
        if tag and tag.strip() and tag.strip().lower() != "all":
            wanted = tag.strip().lstrip("#").lower()
            items = [
                item for item in items
                if wanted in {
                    (item.get("topic_tag") or "").strip().lstrip("#").lower(),
                    *[
                        str(t).strip().lstrip("#").lower()
                        for t in ((item.get("extra_data") or {}).get("tags") or [])
                    ],
                }
            ]
        return items
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="folder_id must be a number") from exc
    finally:
        conn.close()


def _reference_haystack(item: dict) -> str:
    preview = (item.get("extra_data") or {}).get("link_preview") or {}
    rich = (item.get("extra_data") or {}).get("rich_notes") or ""
    tags = (item.get("extra_data") or {}).get("tags") or []
    attachments = (item.get("extra_data") or {}).get("attachments") or []
    att_text = " ".join(
        f"{(a.get('title') if isinstance(a, dict) else '')} {(a.get('url') if isinstance(a, dict) else a)}"
        for a in attachments
    )
    return " ".join([
        item.get("title") or "",
        item.get("raw_content") or "",
        re.sub(r"<[^>]+>", " ", rich),
        item.get("source_url") or "",
        item.get("topic_tag") or "",
        " ".join(str(t) for t in tags),
        item.get("folder_name") or "",
        att_text,
        str(preview.get("title") or ""),
        str(preview.get("description") or ""),
    ]).lower()


@app.post("/api/references")
def create_reference_route(payload: ReferenceWrite) -> dict:
    conn = get_connection()
    try:
        data = payload.model_dump()
        if data.get("folder_name") and not data.get("folder_id"):
            folder = create_reference_folder(conn, data["folder_name"], None, "📁")
            data["folder_id"] = folder["id"]
        created = create_reference(conn, get_demo_account_id(conn), data)
        conn.commit()
        return created
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.patch("/api/references/{spark_id}")
def update_reference_route(spark_id: int, payload: ReferenceWrite) -> dict:
    data = payload.model_dump(exclude_unset=True)

    def _apply(conn):
        if data.get("folder_name") and not data.get("folder_id"):
            folder = create_reference_folder(conn, data["folder_name"], None, "📁")
            data["folder_id"] = folder["id"]
        return update_reference(conn, spark_id, data)

    return _run_spark_change(spark_id, _apply)


@app.patch("/api/references/{spark_id}/move")
def move_reference_route(spark_id: int, payload: ReferenceMove) -> dict:
    return _run_spark_change(spark_id, lambda conn: move_reference(conn, spark_id, payload.folder_id))


@app.patch("/api/references/{spark_id}/pin")
def pin_reference_route(spark_id: int, payload: ReferencePin | None = None) -> dict:
    pinned = None if payload is None else payload.is_pinned
    return _run_spark_change(spark_id, lambda conn: pin_reference(conn, spark_id, pinned))


@app.post("/api/references/{spark_id}/send-to-project")
def send_reference_route(spark_id: int, payload: ReferenceSend) -> dict:
    return _run_spark_change(
        spark_id,
        lambda conn: send_reference_to_project(conn, spark_id, payload.project_id, payload.phase_id),
    )


@app.put("/api/sparks/{spark_id}")
def update_spark(spark_id: int, payload: SparkUpdate) -> dict:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    now = utc_now()
    conn = get_connection()
    try:
        existing = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Spark not found")
        current = serialize_spark(existing)
        extra = dict(current.get("extra_data") or {}) if isinstance(current.get("extra_data"), dict) else {}
        if payload.extra_data and isinstance(payload.extra_data, dict):
            extra.update(payload.extra_data)
        if payload.notes is not None:
            extra["notes"] = payload.notes
            extra["rich_notes"] = payload.notes
        if payload.intent_hint is not None or payload.quick_mark is not None:
            intent = str(
                payload.intent_hint if payload.intent_hint is not None else payload.quick_mark or ""
            ).strip().lower()
            extra["intent_hint"] = intent if intent in ("task", "event", "log") else None
            extra["quick_mark"] = extra["intent_hint"] or "none"
        if payload.is_highlighted is not None:
            extra["is_highlighted"] = bool(payload.is_highlighted)
        if payload.photo_url is not None:
            extra["photo_url"] = str(payload.photo_url or "").strip() or None
        link = payload.link_url if payload.link_url is not None else payload.source_url
        if link is not None:
            extra["link_url"] = str(link or "").strip() or None
        tags = None
        if payload.tags is not None:
            tags = []
            for tag in payload.tags:
                cleaned = normalize_topic_tag(tag)
                if cleaned and cleaned not in tags:
                    tags.append(cleaned)
            extra["tags"] = tags
        if payload.entities is not None:
            entities = []
            for row in payload.entities or []:
                if not isinstance(row, dict):
                    continue
                etype = str(row.get("type") or row.get("kind") or "").strip().lower()
                name = str(row.get("name") or row.get("label") or row.get("val") or "").strip()
                if not etype or not name or etype not in ("person", "place"):
                    continue
                entity = {"type": etype, "name": name}
                url = str(row.get("url") or "").strip()
                if url:
                    entity["url"] = url
                contact_id = row.get("contact_id") or row.get("contactId")
                if contact_id not in (None, ""):
                    entity["contact_id"] = str(contact_id)
                entities.append(entity)
            extra["entities"] = entities
        if payload.blocks is not None:
            blocks = []
            for row in payload.blocks or []:
                if not isinstance(row, dict):
                    continue
                btype = str(row.get("type") or row.get("kind") or "").strip().lower()
                if btype == "photo":
                    url = str(row.get("url") or row.get("src") or row.get("photo_url") or "").strip()
                    if not url:
                        continue
                    blocks.append({
                        "id": str(row.get("id") or ""),
                        "type": "photo",
                        "url": url,
                        "caption": str(row.get("caption") or "").strip(),
                        "filename": str(row.get("filename") or row.get("name") or "").strip(),
                        "size": "expanded" if str(row.get("size") or "").strip().lower() == "expanded" else "compact",
                    })
                elif btype == "link":
                    url = str(row.get("url") or row.get("href") or "").strip()
                    if not url:
                        continue
                    preview = row.get("preview") if isinstance(row.get("preview"), dict) else None
                    mode = str(row.get("display_mode") or row.get("layout") or "compact").strip().lower()
                    if mode not in ("compact", "card"):
                        mode = "compact"
                    preview_image = str(row.get("preview_image") or (preview or {}).get("image") or (preview or {}).get("thumbnail") or "").strip()
                    description = str(row.get("description") or (preview or {}).get("description") or "").strip()
                    blocks.append({
                        "id": str(row.get("id") or ""),
                        "type": "link",
                        "url": url,
                        "title": str(row.get("title") or row.get("label") or "").strip(),
                        "display_mode": mode,
                        "preview_image": preview_image,
                        "description": description,
                        "preview": preview,
                    })
            extra["blocks"] = blocks
            photo_block = next((b for b in blocks if b["type"] == "photo"), None)
            link_block = next((b for b in blocks if b["type"] == "link"), None)
            extra["photo_url"] = photo_block["url"] if photo_block else None
            if link_block:
                extra["link_url"] = link_block["url"]
        topic = normalize_topic_tag(payload.topic_tag)
        if tags is not None:
            topic = tags[0] if tags else None
            ensure_tags_for_names(conn, tags)
        source_url = extra.get("link_url") if link is not None else current.get("source_url")
        conn.execute(
            """
            UPDATE sparks
            SET title = ?, raw_content = ?, source_url = ?, topic_tag = ?, notes = ?, extra_data = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                title,
                (payload.raw_content or "").strip() or None,
                source_url,
                topic,
                payload.notes if payload.notes is not None else current.get("notes"),
                json.dumps(extra),
                now,
                spark_id,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
        return serialize_spark(row)
    finally:
        conn.close()


class SparkTransform(BaseModel):
    item_type: str
    assignee: str | None = "Me"
    extra_data: dict | None = None


class SparkAction(BaseModel):
    action: str
    day: int | None = None
    node_id: int | None = None
    title: str | None = None
    kind: str | None = None
    parent_id: int | None = None
    assignee: str | None = None


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


class SparkConvert(BaseModel):
    item_type: str | None = None
    target_type: str | None = None
    assignee: str | None = "Me"
    extra_data: dict | None = None
    due_date: str | None = None
    due_time: str | None = None
    project_id: int | None = None
    phase_id: str | None = None
    parent_phase_id: str | None = None
    vision_id: int | None = None
    chapter_id: int | None = None
    title: str | None = None
    content: str | None = None
    blocks: list | None = None
    vision_title: str | None = None
    notebook_title: str | None = None


class TaskWrite(BaseModel):
    title: str = Field(min_length=1)
    due_date: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    due_time: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    is_routine: bool | None = None
    recurrence_days: list[int] | None = None
    routine_date: str | None = None
    assignee: str | None = "Me"
    raw_content: str | None = None
    notes: str | None = None
    is_done: bool | None = None
    task_status: str | None = None
    status: str | None = None
    drop_reason: str | None = None
    drop_note: str | None = None
    cannot_reason: str | None = None
    cannot_note: str | None = None
    postpone_date: str | None = None
    postpone_time: str | None = None
    project_id: int | None = None
    phase_id: str | None = None
    linked_vision_id: int | None = None
    extra_data: dict | None = None
    location: str | None = None
    with_person: str | None = None
    checklist_mode: str | None = None
    checklist: list | None = None
    rich_notes: str | None = None
    is_parked: bool | None = None
    entry_type: str | None = None
    is_theme_of_day: bool | None = None
    accent_color: str | None = None
    emoji: str | None = None
    timing_mode: str | None = None
    migration_history: list | None = None
    is_all_day: bool | None = None
    is_multiday: bool | None = None
    blocks: list | None = None
    entities: list | None = None
    tags: list[str] | None = None
    created_at: str | None = None


class TaskPatch(TaskWrite):
    title: str | None = Field(default=None, min_length=1)


class TaskSchedule(BaseModel):
    date: str | None = None
    due_date: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    due_time: str | None = None


class PhaseCreate(BaseModel):
    title: str | None = None
    name: str | None = None
    parent_phase_id: str | None = None
    deadline: str | None = None

    def resolved_title(self) -> str:
        return str(self.title or self.name or "").strip()


class PhaseUpdate(BaseModel):
    title: str | None = None
    name: str | None = None
    details: str | None = None
    links: list[str] | None = None
    attachments: list[str] | None = None
    is_done: bool | None = None
    deadline: str | None = None
    parent_phase_id: str | None = None
    order_index: int | None = None
    color_theme: str | None = None
    canvas_items: list[dict] | None = None


class PhaseCanvasReorder(BaseModel):
    items: list[dict] = Field(default_factory=list)


class PhaseSubphaseReorder(BaseModel):
    phase_ids: list[str] = Field(default_factory=list)


class PhaseOrder(BaseModel):
    phases: list[dict]


class ProjectStatus(BaseModel):
    status: str


class ProjectUpdate(BaseModel):
    title: str | None = None
    deadline: str | None = None
    details: str | None = None
    links: list[str] | None = None
    attachments: list[str] | None = None
    color_theme: str | None = None
    canvas_items: list[dict] | None = None


class NoteCreate(BaseModel):
    project_id: int
    phase_id: str | None = None
    subphase_id: str | None = None
    title: str | None = "Untitled Note"
    content: str | None = ""


class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = None


@app.post("/api/notes")
def create_note_route(payload: NoteCreate) -> dict:
    conn = get_connection()
    try:
        note = create_note(
            conn,
            payload.project_id,
            phase_id=payload.phase_id,
            subphase_id=payload.subphase_id,
            title=payload.title,
            content=payload.content,
        )
        conn.commit()
        return note
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/workbench/projects/{project_id}/notes")
def list_project_notes_route(project_id: int, phase_id: str | None = None) -> list[dict]:
    conn = get_connection()
    try:
        projects = list_projects(conn, "all")
        if not any(item["id"] == project_id for item in projects):
            raise HTTPException(status_code=404, detail="Project not found")
        if phase_id:
            return list_project_notes(conn, project_id, phase_id=phase_id)
        return list_project_notes(conn, project_id)
    finally:
        conn.close()


@app.patch("/api/notes/{note_id}")
def patch_note_route(note_id: int, payload: NoteUpdate) -> dict:
    conn = get_connection()
    try:
        note = update_note(conn, note_id, payload.model_dump(exclude_unset=True))
        conn.commit()
        return note
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/notes/{note_id}")
def delete_note_route(note_id: int) -> dict:
    conn = get_connection()
    try:
        deleted = delete_note(conn, note_id)
        conn.commit()
        return deleted
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/workbench/projects/{project_id}")
def get_project_route(project_id: int) -> dict:
    conn = get_connection()
    try:
        projects = list_projects(conn, "all")
        match = next((item for item in projects if item["id"] == project_id), None)
        if not match:
            raise HTTPException(status_code=404, detail="Project not found")
        tasks = [
            serialize_spark(row)
            for row in conn.execute(
                "SELECT * FROM sparks WHERE status = 'in_cloud' AND item_type = 'task' AND project_id = ?",
                (project_id,),
            ).fetchall()
        ]
        _annotate_project_tasks([match], tasks)
        attach_notes_to_projects(conn, [match])
        return match
    finally:
        conn.close()


@app.patch("/api/workbench/projects/{project_id}")
def patch_project_route(project_id: int, payload: ProjectUpdate) -> dict:
    return _run_spark_change(
        project_id,
        lambda conn: update_project(conn, project_id, payload.model_dump(exclude_unset=True)),
    )


@app.patch("/api/workbench/projects/{project_id}/reward")
def project_reward_route(project_id: int, payload: VisionRewardWrite) -> dict:
    data = payload.model_dump(exclude_unset=True)
    if "reward" in data and data["reward"] is not None:
        reward_payload = data["reward"]
    elif data.get("title") is None and data.get("elements") is None:
        reward_payload = None
    else:
        reward_payload = {
            "title": data.get("title") or "",
            "elements": data.get("elements") or [],
        }
    return _run_spark_change(project_id, lambda conn: set_project_reward(conn, project_id, reward_payload))


@app.delete("/api/workbench/projects/{project_id}/reward")
def project_reward_clear_route(project_id: int) -> dict:
    return _run_spark_change(project_id, lambda conn: set_project_reward(conn, project_id, None))


@app.patch("/api/workbench/projects/{project_id}/reorder-items")
def reorder_project_items_route(project_id: int, payload: PhaseCanvasReorder) -> dict:
    return _run_spark_change(
        project_id,
        lambda conn: reorder_project_canvas_items(conn, project_id, payload.items),
    )


@app.patch("/api/workbench/projects/{project_id}/status")
def project_status_route(project_id: int, payload: ProjectStatus) -> dict:
    return _run_spark_change(project_id, lambda conn: set_project_status(conn, project_id, payload.status))


@app.delete("/api/workbench/projects/{project_id}")
def delete_project_route(project_id: int) -> dict:
    conn = get_connection()
    try:
        deleted = delete_project(conn, project_id)
        conn.commit()
        return deleted
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/workbench/projects/{project_id}/phases")
def create_phase(project_id: int, payload: PhaseCreate) -> dict:
    title = payload.resolved_title()
    if not title:
        raise HTTPException(status_code=400, detail="Phase title is required")
    return _run_spark_change(
        project_id,
        lambda conn: add_project_phase(
            conn,
            project_id,
            title,
            payload.parent_phase_id,
            payload.deadline,
        ),
    )


@app.patch("/api/workbench/projects/{project_id}/phases")
def reorder_phases(project_id: int, payload: PhaseOrder) -> dict:
    return _run_spark_change(project_id, lambda conn: replace_project_phases(conn, project_id, payload.phases))


@app.delete("/api/workbench/projects/{project_id}/phases/{phase_id}")
def remove_phase(project_id: int, phase_id: str) -> dict:
    return _run_spark_change(project_id, lambda conn: delete_project_phase(conn, project_id, phase_id))


@app.patch("/api/workbench/projects/{project_id}/phases/{phase_id}")
def patch_phase(project_id: int, phase_id: str, payload: PhaseUpdate) -> dict:
    return _run_spark_change(
        project_id,
        lambda conn: update_project_phase(conn, project_id, phase_id, payload.model_dump(exclude_unset=True)),
    )


@app.patch("/api/workbench/projects/{project_id}/phases/{phase_id}/reorder-items")
def reorder_phase_items_route(project_id: int, phase_id: str, payload: PhaseCanvasReorder) -> dict:
    return _run_spark_change(
        project_id,
        lambda conn: reorder_phase_canvas_items(conn, project_id, phase_id, payload.items),
    )


@app.patch("/api/workbench/projects/{project_id}/phases/{phase_id}/reorder-subphases")
def reorder_phase_subphases_route(project_id: int, phase_id: str, payload: PhaseSubphaseReorder) -> dict:
    return _run_spark_change(
        project_id,
        lambda conn: reorder_phase_subphases(conn, project_id, phase_id, payload.phase_ids),
    )


@app.patch("/api/sparks/{spark_id}/convert")
@app.post("/api/sparks/{spark_id}/convert")
def convert_spark_route(spark_id: int, payload: SparkConvert) -> dict:
    target = payload.target_type or payload.item_type
    if not target:
        raise HTTPException(status_code=400, detail="target_type or item_type is required")
    return _run_spark_change(
        spark_id,
        lambda conn: convert_spark(
            conn,
            spark_id,
            item_type=payload.item_type,
            assignee=payload.assignee,
            extra_data=payload.extra_data,
            due_date=payload.due_date,
            due_time=payload.due_time,
            target_type=payload.target_type or payload.item_type,
            project_id=payload.project_id,
            phase_id=payload.phase_id,
            parent_phase_id=payload.parent_phase_id,
            vision_id=payload.vision_id,
            chapter_id=payload.chapter_id,
            handoff=payload.model_dump(
                include={"title", "content", "blocks", "vision_title", "notebook_title"},
                exclude_unset=True,
            ),
        ),
    )


@app.post("/api/tasks")
def create_task(payload: TaskWrite) -> dict:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    entry_type = normalize_entry_type(payload.entry_type or "task")
    try:
        due_date = clean_due_date(payload.due_date if payload.due_date is not None else payload.start_date)
        end_date = clean_due_date(payload.end_date)
        start_time = clean_due_time(payload.start_time if payload.start_time is not None else payload.due_time)
        end_time = clean_due_time(payload.end_time)
        due_time = start_time
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    is_routine = 1 if payload.is_routine else 0
    recurrence_days = normalize_recurrence_days(payload.recurrence_days or [])
    is_parked = 1 if payload.is_parked else 0
    if entry_type in ("event", "log"):
        is_routine = 0
        recurrence_days = []
        is_parked = 0
    if is_routine and not recurrence_days:
        raise HTTPException(status_code=400, detail="Pick at least one weekday for a routine")
    if not is_routine:
        recurrence_days = []
        if end_date is None and due_date:
            end_date = due_date
        if end_date and due_date and end_date < due_date:
            raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    else:
        due_date = None
        end_date = None
    if is_parked:
        due_date = None
        end_date = None
        start_time = None
        end_time = None
        due_time = None
        is_routine = 0
        recurrence_days = []
    if entry_type == "log":
        start_time = None
        end_time = None
        due_time = None
    timing_mode = str(payload.timing_mode or "").strip().lower()
    is_all_day = 1 if payload.is_all_day else 0
    is_multiday = 1 if payload.is_multiday else 0
    if entry_type == "event":
        if timing_mode == "point":
            end_time = None
            is_all_day = 0
            is_multiday = 0
            if end_date is None:
                end_date = due_date
        elif timing_mode == "range":
            is_all_day = 0
            is_multiday = 0
            if end_date is None:
                end_date = due_date
        elif timing_mode in ("multiday", "multi-day", "multi_day"):
            is_all_day = 1
            is_multiday = 1
            start_time = None
            end_time = None
            due_time = None
        if due_date and end_date and end_date > due_date:
            is_multiday = 1
            is_all_day = 1
            start_time = None
            end_time = None
            due_time = None
        if is_all_day or is_multiday:
            start_time = None
            end_time = None
            due_time = None
    else:
        is_all_day = 0
        is_multiday = 0
    task_status = normalize_task_status(payload.task_status or payload.status, payload.is_done)
    drop_reason = None
    drop_note = None
    postponed_count = 0
    if entry_type != "task":
        task_status = "pending"
        is_done = 0
    else:
        if task_status == "cannot_done":
            drop_reason = normalize_drop_reason(payload.drop_reason or payload.cannot_reason) or "custom"
            drop_note = str(payload.drop_note or payload.cannot_note or "").strip() or None
        elif task_status == "postponed":
            postponed_count = 1
            task_status = "pending"
            if payload.postpone_date:
                try:
                    due_date = clean_due_date(payload.postpone_date)
                except SparkActionError as exc:
                    raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
            if payload.postpone_time is not None:
                try:
                    due_time = clean_due_time(payload.postpone_time)
                    start_time = due_time
                except SparkActionError as exc:
                    raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
        is_done = 1 if task_status == "completed" else 0
    accent_color = normalize_accent_color(payload.accent_color) if entry_type == "event" else None
    if entry_type == "event" and not accent_color:
        accent_color = EVENT_DEFAULT_ACCENT
    emoji = str(payload.emoji or "").strip() or None if entry_type == "event" else None
    is_theme = 1 if entry_type == "event" and payload.is_theme_of_day else 0
    project_id = payload.project_id
    phase_id = (payload.phase_id or "").strip() or None
    now = utc_now()
    notes_html = payload.notes if payload.notes is not None else payload.rich_notes
    stamp = local_hhmm()
    incoming_hist = payload.migration_history
    if incoming_hist is None and isinstance(payload.extra_data, dict):
        incoming_hist = payload.extra_data.get("migration_history")
    history = incoming_hist if isinstance(incoming_hist, list) and incoming_hist else birth_migration_history(entry_type, stamp)
    extra = normalize_task_extra({
        **(payload.extra_data or {}),
        **{k: v for k, v in {
            "location": payload.location,
            "with_person": payload.with_person,
            "checklist_mode": payload.checklist_mode,
            "checklist": payload.checklist,
            "notes": notes_html,
            "rich_notes": notes_html,
            "migration_history": history,
            "blocks": payload.blocks,
            "entities": payload.entities,
            "tags": payload.tags,
        }.items() if v is not None},
    })
    extra["migration_history"] = history
    plain_notes = (payload.raw_content or "").strip() or None
    column_notes = extra.get("notes") or None
    # Active schedule logs may stamp created_at to the scheduled start time.
    created_at = now
    client_created = str(payload.created_at or "").strip()
    if client_created:
        created_at = client_created
    elif extra.get("is_active_schedule_log") and extra.get("stream_date") and extra.get("stream_time"):
        created_at = f"{extra['stream_date']}T{str(extra['stream_time'])[:5]}:00"
    conn = get_connection()
    try:
        if project_id not in (None, ""):
            project_row = conn.execute(
                "SELECT id, extra_data FROM sparks WHERE id = ? AND item_type = 'project'",
                (int(project_id),),
            ).fetchone()
            if not project_row:
                raise HTTPException(status_code=404, detail="Project not found")
            if phase_id:
                phase_ids = {phase["id"] for phase in phases_from_extra(project_row["extra_data"])}
                if phase_id not in phase_ids:
                    raise HTTPException(status_code=404, detail="Phase not found on that project")
        elif phase_id:
            raise HTTPException(status_code=400, detail="phase_id requires project_id")
        if is_theme and due_date:
            clear_theme_of_day_for_date(conn, due_date)
        # Idempotency: one active schedule log per linked calendar item + stream date.
        if extra.get("is_active_schedule_log"):
            stream_day = clean_due_date(str(extra.get("stream_date") or due_date or ""))
            link_kind = "event" if entry_type == "event" else "task"
            linked_id = (
                extra.get("linked_event_id") or extra.get("event_id")
                if link_kind == "event"
                else extra.get("linked_task_id") or extra.get("task_id")
            )
            if linked_id not in (None, "") and stream_day:
                existing = find_active_schedule_log(
                    conn,
                    linked_id=linked_id,
                    stream_date=stream_day,
                    kind=link_kind,
                )
                if existing:
                    refreshed = refresh_active_schedule_log(
                        conn,
                        existing,
                        title=title,
                        stream_date=stream_day,
                        stream_time=str(extra.get("stream_time") or due_time or "00:00")[:5],
                        extra_patch=extra,
                        created_at=created_at,
                    )
                    conn.commit()
                    return _annotate_task(conn, serialize_spark(refreshed))
        account_id = get_demo_account_id(conn)
        cursor = conn.execute(
            """
            INSERT INTO sparks (
                account_id, title, raw_content, source_url, topic_tag,
                source_type, status, promoted_to_type, promoted_to_id,
                graduated_at, created_at, updated_at, item_type, is_done,
                assignee, extra_data, due_date, due_time, start_time, end_time,
                end_date, notes, is_routine, recurrence_days, project_id, phase_id, linked_vision_id,
                task_status, drop_reason, drop_note, postponed_count, is_parked,
                entry_type, is_theme_of_day, accent_color, emoji, is_all_day, is_multiday
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                account_id,
                title,
                plain_notes,
                None,
                None,
                None,
                "in_cloud",
                None,
                None,
                None,
                created_at,
                now,
                "task",
                is_done,
                "Me" if payload.assignee is None else payload.assignee.strip(),
                json.dumps(extra),
                None if is_routine or is_parked else due_date,
                due_time,
                start_time,
                end_time,
                None if is_routine or is_parked else end_date,
                column_notes,
                is_routine,
                json.dumps(recurrence_days),
                project_id,
                phase_id,
                payload.linked_vision_id,
                task_status,
                drop_reason,
                drop_note,
                postponed_count,
                is_parked,
                entry_type,
                is_theme,
                accent_color,
                emoji,
                is_all_day,
                is_multiday,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM sparks WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _annotate_task(conn, serialize_spark(row))
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.patch("/api/tasks/{spark_id}")
def patch_task(spark_id: int, payload: TaskPatch) -> dict:
    return _run_spark_change(
        spark_id,
        lambda conn: _annotate_task(
            conn,
            update_task(conn, spark_id, payload.model_dump(exclude_unset=True)),
        ),
    )


@app.patch("/api/tasks/{spark_id}/schedule")
def schedule_task_route(spark_id: int, payload: TaskSchedule) -> dict:
    return _run_spark_change(
        spark_id,
        lambda conn: _annotate_task(
            conn,
            schedule_task(conn, spark_id, payload.model_dump(exclude_unset=True)),
        ),
    )


@app.delete("/api/tasks/{spark_id}")
def delete_task_route(spark_id: int) -> dict:
    return _run_spark_change(spark_id, lambda conn: delete_task(conn, spark_id))


@app.patch("/api/sparks/{spark_id}/transform")
def transform_spark_route(spark_id: int, payload: SparkTransform) -> dict:
    if payload.item_type not in ITEM_TYPES:
        raise HTTPException(status_code=400, detail="Unknown item type")
    return _run_spark_change(
        spark_id,
        lambda conn: transform_spark(
            conn,
            spark_id,
            payload.item_type,
            payload.assignee,
            payload.extra_data if payload.extra_data is not None else None,
        ),
    )


@app.patch("/api/sparks/{spark_id}/action")
def spark_action_route(spark_id: int, payload: SparkAction) -> dict:
    body = payload.model_dump()
    return _run_spark_change(spark_id, lambda conn: apply_spark_action(conn, spark_id, body))


@app.delete("/api/sparks/{spark_id}")
def delete_spark(spark_id: int) -> dict:
    conn = get_connection()
    try:
        existing = conn.execute("SELECT id FROM sparks WHERE id = ?", (spark_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Spark not found")
        conn.execute("DELETE FROM sparks WHERE id = ?", (spark_id,))
        conn.commit()
        return {"ok": True, "id": spark_id}
    finally:
        conn.close()


class RewardWrite(BaseModel):
    title: str = Field(min_length=1)
    description: str | None = None
    photo_url: str | None = None
    trigger_type: str
    trigger_threshold: int | None = 1
    linked_entity_id: int | None = None


@app.get("/api/legacy-hall")
def legacy_hall_route() -> dict:
    conn = get_connection()
    try:
        return legacy_hall(conn)
    finally:
        conn.close()


@app.get("/api/legacy/milestones")
def legacy_milestones_route(
    filter: str | None = None,
    val: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    conn = get_connection()
    try:
        return list_legacy_milestones(
            conn,
            filter_type=filter,
            val=val,
            start_date=start_date,
            end_date=end_date,
        )
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/rewards")
def rewards_list() -> list[dict]:
    conn = get_connection()
    try:
        return list_rewards(conn)
    finally:
        conn.close()


@app.get("/api/rewards/pending")
def rewards_pending() -> list[dict]:
    conn = get_connection()
    try:
        return pending_rewards(conn)
    finally:
        conn.close()


@app.post("/api/rewards")
def rewards_create(payload: RewardWrite) -> dict:
    conn = get_connection()
    try:
        saved = create_reward(conn, payload.model_dump())
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.patch("/api/rewards/{reward_id}/claim")
def rewards_claim(reward_id: int) -> dict:
    conn = get_connection()
    try:
        saved = claim_reward(conn, reward_id)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/rewards/{reward_id}")
def rewards_delete(reward_id: int) -> dict:
    conn = get_connection()
    try:
        saved = delete_reward(conn, reward_id)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


class NotepadWrite(BaseModel):
    title: str | None = None
    content: str | None = None
    items: list | None = None
    pad_type: str | None = None
    scope: str | None = None
    target_date: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    linked_phase_id: str | None = None
    phase_id: str | None = None
    linked_project_id: int | None = None
    project_id: int | None = None
    color_theme: str | None = None
    color: str | None = None
    is_pinned: bool | None = None
    is_theme_of_day: bool | None = None


class NotepadGraduate(BaseModel):
    folder_id: int | None = None


class NotepadToTasks(BaseModel):
    due_date: str | None = None
    project_id: int | None = None
    phase_id: str | None = None


@app.get("/api/notepads/active")
def notepads_active(date: str | None = None) -> list[dict]:
    conn = get_connection()
    try:
        return list_active_notepads(conn, date)
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/notepads/theme")
def notepads_theme(date: str | None = None) -> dict | None:
    conn = get_connection()
    try:
        return get_theme_of_day(conn, date)
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/calendar/month")
def calendar_month_route(year: int, month: int) -> dict:
    conn = get_connection()
    try:
        return calendar_month(conn, year, month)
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/notepads")
def notepads_list(
    scope: str | None = None,
    date: str | None = None,
    phase_id: str | None = None,
    project_id: int | None = None,
    year: int | None = None,
    theme_only: bool = False,
) -> list[dict]:
    conn = get_connection()
    try:
        return list_notepads(
            conn,
            scope=scope,
            target_date=date,
            phase_id=phase_id,
            project_id=project_id,
            year=year,
            theme_only=theme_only,
        )
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/notepads")
def notepads_create(payload: NotepadWrite) -> dict:
    conn = get_connection()
    try:
        saved = create_notepad(conn, payload.model_dump(exclude_unset=True))
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.patch("/api/notepads/{pad_id}")
def notepads_patch(pad_id: int, payload: NotepadWrite) -> dict:
    conn = get_connection()
    try:
        saved = update_notepad(conn, pad_id, payload.model_dump(exclude_unset=True))
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/notepads/{pad_id}")
def notepads_delete(pad_id: int) -> dict:
    conn = get_connection()
    try:
        saved = delete_notepad(conn, pad_id)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/notepads/{pad_id}/graduate")
def notepads_graduate(pad_id: int, payload: NotepadGraduate | None = None) -> dict:
    conn = get_connection()
    try:
        folder_id = payload.folder_id if payload else None
        saved = graduate_notepad(conn, pad_id, folder_id)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/notepads/{pad_id}/convert-to-tasks")
def notepads_to_tasks(pad_id: int, payload: NotepadToTasks | None = None) -> dict:
    conn = get_connection()
    try:
        body = payload.model_dump(exclude_unset=True) if payload else {}
        saved = convert_notepad_to_tasks(
            conn,
            pad_id,
            due_date=body.get("due_date"),
            project_id=body.get("project_id"),
            phase_id=body.get("phase_id"),
        )
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


class BinderProjectCreate(BaseModel):
    title: str = Field(min_length=1)
    description: str | None = None


class BinderStyleShipFields(BaseModel):
    cover_color: str | None = None
    cover_image: str | None = None
    spine_color: str | None = None
    ship_date: str | None = None


BINDER_STYLE_SHIP_KEYS = ("cover_color", "cover_image", "spine_color", "ship_date")


class BinderProjectUpdate(BinderStyleShipFields):
    title: str | None = None
    description: str | None = None
    tracker: dict | None = None
    status: str | None = None


class BinderSectionCreate(BaseModel):
    title: str | None = None
    parent_id: int | None = None


class BinderSectionUpdate(BinderStyleShipFields):
    title: str | None = None
    blocks: list | dict | None = None
    columns: list | None = None


class BinderSectionReorder(BaseModel):
    section_ids: list[int] = Field(min_length=1)


class BinderLineCreate(BaseModel):
    content: str | None = None
    title: str | None = None
    blocks: list | dict | None = None
    is_completed: bool | None = None


class BinderLineUpdate(BaseModel):
    content: str | None = None
    title: str | None = None
    blocks: list | dict | None = None
    is_completed: bool | None = None


@app.get("/api/projects")
def api_list_binder_projects():
    conn = get_connection()
    try:
        return list_binder_projects(conn)
    finally:
        conn.close()


@app.post("/api/projects")
def api_create_binder_project(body: BinderProjectCreate):
    conn = get_connection()
    try:
        saved = create_binder_project(conn, body.title, body.description)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/projects/{project_id}")
def api_get_binder_project(project_id: int):
    conn = get_connection()
    try:
        return get_binder_project(conn, project_id)
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/projects/{project_id}")
def api_update_binder_project(project_id: int, body: BinderProjectUpdate):
    conn = get_connection()
    try:
        saved = update_binder_project(conn, project_id, body.model_dump(exclude_unset=True))
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/projects/{project_id}")
def api_delete_binder_project(project_id: int):
    conn = get_connection()
    try:
        result = delete_binder_project(conn, project_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/projects/{project_id}/sections")
def api_create_binder_section(project_id: int, body: BinderSectionCreate | None = None):
    conn = get_connection()
    try:
        title = body.title if body else None
        parent_id = body.parent_id if body else None
        saved = create_binder_section(conn, project_id, title, parent_id)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/projects/{project_id}/sections/reorder")
def api_reorder_binder_sections(project_id: int, body: BinderSectionReorder):
    conn = get_connection()
    try:
        saved = reorder_binder_sections(conn, project_id, body.section_ids)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/projects/sections/{section_id}")
def api_update_binder_section(section_id: int, body: BinderSectionUpdate):
    conn = get_connection()
    try:
        extra_fields = {key: value for key, value in body.model_dump(exclude_unset=True).items() if key in BINDER_STYLE_SHIP_KEYS}
        if body.title is None and body.blocks is None and body.columns is None and not extra_fields:
            raise HTTPException(status_code=400, detail="Nothing to update")
        saved = update_binder_section(conn, section_id, body.title, body.blocks, body.columns, extra_fields)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/projects/sections/{section_id}")
def api_delete_binder_section(section_id: int):
    conn = get_connection()
    try:
        result = delete_binder_section(conn, section_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/projects/sections/{section_id}/lines")
def api_create_binder_line(section_id: int, body: BinderLineCreate):
    conn = get_connection()
    try:
        content = (body.content if body.content is not None else body.title) or ""
        saved = create_binder_line(
            conn,
            section_id,
            content,
            body.blocks,
            bool(body.is_completed) if body.is_completed is not None else False,
        )
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/projects/lines/{line_id}")
def api_update_binder_line(line_id: int, body: BinderLineUpdate):
    conn = get_connection()
    try:
        content = body.content if body.content is not None else body.title
        saved = update_binder_line(conn, line_id, content, body.blocks, body.is_completed)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/projects/lines/{line_id}/toggle")
def api_toggle_binder_line(line_id: int):
    conn = get_connection()
    try:
        saved = toggle_binder_line(conn, line_id)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/projects/lines/{line_id}")
def api_delete_binder_line(line_id: int):
    conn = get_connection()
    try:
        result = delete_binder_line(conn, line_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


# --- Vision Boards (scrapboard workspace) ---

class VisionBoardCreate(BaseModel):
    title: str | None = None


class VisionBoardUpdate(BaseModel):
    title: str | None = None


class VisionCanvasSave(BaseModel):
    canvas: dict | list | None = None
    canvas_json: str | dict | list | None = None
    thumbnail_data: str | None = None


class VisionGoalCreate(BaseModel):
    content: str = Field(min_length=1)


class VisionGoalUpdate(BaseModel):
    content: str = Field(min_length=1)


class VisionAttachCreate(BaseModel):
    entity_type: str
    entity_id: int


class VisionBlockCreate(BaseModel):
    block_type: str
    content: dict | None = None


class VisionBlockUpdate(BaseModel):
    block_type: str | None = None
    content: dict | None = None


@app.get("/api/visions")
def api_list_vision_boards(status: str = "active"):
    conn = get_connection()
    try:
        return list_vision_boards(conn, status)
    finally:
        conn.close()


@app.post("/api/visions")
def api_create_vision_board(payload: VisionBoardCreate = VisionBoardCreate()):
    conn = get_connection()
    try:
        board = create_vision_board(conn, payload.title)
        conn.commit()
        return board
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/visions/goals/{goal_id}")
def api_update_vision_goal(goal_id: int, payload: VisionGoalUpdate):
    conn = get_connection()
    try:
        goal = update_vision_goal(conn, goal_id, payload.content)
        conn.commit()
        return goal
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/visions/goals/{goal_id}/toggle")
def api_toggle_vision_goal(goal_id: int):
    conn = get_connection()
    try:
        goal = toggle_vision_goal(conn, goal_id)
        conn.commit()
        return goal
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/visions/goals/{goal_id}")
def api_delete_vision_goal(goal_id: int):
    conn = get_connection()
    try:
        result = delete_vision_goal(conn, goal_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/visions/linked-elements/{link_id}")
def api_unlink_vision_element(link_id: int):
    conn = get_connection()
    try:
        result = detach_vision_element(conn, link_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/visions/blocks/{block_id}")
def api_delete_vision_block(block_id: int):
    conn = get_connection()
    try:
        result = delete_vision_block(conn, block_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/visions/blocks/{block_id}")
def api_update_vision_block(block_id: int, payload: VisionBlockUpdate):
    conn = get_connection()
    try:
        block = update_vision_block(conn, block_id, payload.content, payload.block_type)
        conn.commit()
        return block
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/visions/{vision_id}")
def api_get_vision_board(vision_id: int):
    conn = get_connection()
    try:
        return get_vision_board(conn, vision_id)
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.patch("/api/visions/{vision_id}")
def api_update_vision_board(vision_id: int, payload: VisionBoardUpdate):
    conn = get_connection()
    try:
        board = update_vision_board(conn, vision_id, payload.model_dump(exclude_unset=True))
        conn.commit()
        return board
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/visions/{vision_id}/canvas")
def api_save_vision_canvas(vision_id: int, payload: VisionCanvasSave):
    conn = get_connection()
    try:
        canvas = payload.canvas
        if canvas is None and payload.canvas_json is not None:
            canvas = payload.canvas_json
        board = save_vision_board_canvas(conn, vision_id, canvas, payload.thumbnail_data)
        conn.commit()
        return board
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/visions/{vision_id}/goals")
def api_create_vision_goal(vision_id: int, payload: VisionGoalCreate):
    conn = get_connection()
    try:
        goal = create_vision_goal(conn, vision_id, payload.content)
        conn.commit()
        return goal
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/visions/{vision_id}/linked-elements")
def api_link_vision_element(vision_id: int, payload: VisionAttachCreate):
    conn = get_connection()
    try:
        item = attach_vision_element(conn, vision_id, payload.entity_type, payload.entity_id)
        conn.commit()
        return item
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/visions/{vision_id}/attach")
def api_attach_vision_element(vision_id: int, payload: VisionAttachCreate):
    return api_link_vision_element(vision_id, payload)


@app.post("/api/visions/{vision_id}/blocks")
def api_create_vision_block(vision_id: int, payload: VisionBlockCreate):
    conn = get_connection()
    try:
        block = create_vision_block(conn, vision_id, payload.block_type, payload.content)
        conn.commit()
        return block
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/visions/attach/{attachment_id}")
def api_detach_vision_element(attachment_id: int):
    conn = get_connection()
    try:
        result = detach_vision_element(conn, attachment_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.patch("/api/visions/{vision_id}/fulfill")
def api_fulfill_vision_board(vision_id: int):
    conn = get_connection()
    try:
        board = fulfill_vision_board(conn, vision_id)
        conn.commit()
        return board
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/visions/{vision_id}")
def api_delete_vision_board(vision_id: int):
    conn = get_connection()
    try:
        result = delete_vision_board(conn, vision_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


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


class VaultNotebookCreate(BaseModel):
    title: str | None = None
    name: str | None = None
    stack_id: int | None = None


class VaultNotebookUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    cover_color: str | None = None
    cover_image: str | None = None
    spine_color: str | None = None
    stack_id: int | None = None


class VaultStackSave(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    shelf_id: int | None = None
    slot: int | None = None


class VaultShelfSave(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    tab_color: str | None = None


class VaultShelfOrder(BaseModel):
    shelf_ids: list[int] = Field(default_factory=list)


class VaultShelfStacks(BaseModel):
    stack_ids: list[int] = Field(default_factory=list)


class VaultChapterCreate(BaseModel):
    title: str | None = None


class VaultChapterReorder(BaseModel):
    chapter_ids: list[int] = Field(default_factory=list)


class VaultLineOrderItem(BaseModel):
    id: int
    parent_id: int | None = None


class VaultLineReorder(BaseModel):
    line_ids: list[int] = Field(default_factory=list)
    items: list[VaultLineOrderItem] | None = None


class VaultChapterUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    background_color: str | None = None
    background_image: str | None = None


class VaultLineCreate(BaseModel):
    content: str | None = None
    title: str | None = None
    blocks: list | dict | None = None
    kind: str | None = None
    parent_id: int | None = None


class VaultLineUpdate(BaseModel):
    content: str | None = None
    title: str | None = None
    blocks: list | dict | None = None
    collapsed: bool | None = None


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


@app.get("/api/vault/notebooks")
def api_list_vault_notebooks():
    conn = get_connection()
    try:
        return list_vault_notebooks(conn)
    finally:
        conn.close()


@app.post("/api/vault/notebooks")
def api_create_vault_notebook(body: VaultNotebookCreate):
    conn = get_connection()
    try:
        title = (body.title or body.name or "").strip()
        saved = create_vault_notebook(conn, title, body.stack_id)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/vault/stacks")
def api_list_vault_stacks():
    conn = get_connection()
    try:
        return list_vault_stacks(conn)
    finally:
        conn.close()


@app.post("/api/vault/stacks")
def api_create_vault_stack(body: VaultStackSave):
    conn = get_connection()
    try:
        saved = create_vault_stack(conn, body.title, body.shelf_id, body.slot)
        conn.commit()
        return saved
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/vault/stacks/{stack_id}")
def api_update_vault_stack(stack_id: int, body: VaultStackSave):
    conn = get_connection()
    try:
        saved = update_vault_stack(conn, stack_id, body.title, body.shelf_id, body.slot)
        conn.commit()
        return saved
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/vault/stacks/{stack_id}")
def api_delete_vault_stack(stack_id: int):
    conn = get_connection()
    try:
        result = delete_vault_stack(conn, stack_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/vault/shelves")
def api_list_vault_shelves():
    conn = get_connection()
    try:
        return list_vault_shelves(conn)
    finally:
        conn.close()


@app.post("/api/vault/shelves")
def api_create_vault_shelf(body: VaultShelfSave):
    conn = get_connection()
    try:
        saved = create_vault_shelf(conn, body.title)
        conn.commit()
        return saved
    finally:
        conn.close()


@app.put("/api/vault/shelves/order")
def api_reorder_vault_shelves(body: VaultShelfOrder):
    conn = get_connection()
    try:
        saved = reorder_vault_shelves(conn, body.shelf_ids)
        conn.commit()
        return saved
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/vault/shelves/{shelf_id}")
def api_update_vault_shelf(shelf_id: int, body: VaultShelfSave):
    conn = get_connection()
    try:
        style = body.model_dump(include={"tab_color"}, exclude_unset=True)
        saved = update_vault_shelf(conn, shelf_id, body.title, style)
        conn.commit()
        return saved
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/vault/shelves/{shelf_id}/stacks")
def api_arrange_vault_shelf_stacks(shelf_id: int, body: VaultShelfStacks):
    conn = get_connection()
    try:
        saved = arrange_vault_shelf_stacks(conn, shelf_id, body.stack_ids)
        conn.commit()
        return saved
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/vault/shelves/{shelf_id}")
def api_delete_vault_shelf(shelf_id: int):
    conn = get_connection()
    try:
        result = delete_vault_shelf(conn, shelf_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        conn.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.get("/api/vault/notebooks/{notebook_id}")
def api_get_vault_notebook(notebook_id: int):
    conn = get_connection()
    try:
        return get_vault_notebook(conn, notebook_id)
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/vault/notebooks/{notebook_id}")
def api_update_vault_notebook(notebook_id: int, body: VaultNotebookUpdate):
    conn = get_connection()
    try:
        style = body.model_dump(include={"cover_color", "cover_image", "spine_color"}, exclude_unset=True)
        stack = body.model_dump(include={"stack_id"}, exclude_unset=True)
        saved = update_vault_notebook(conn, notebook_id, body.title, style, stack)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/vault/notebooks/{notebook_id}")
def api_delete_vault_notebook(notebook_id: int):
    conn = get_connection()
    try:
        result = delete_vault_notebook(conn, notebook_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/vault/notebooks/{notebook_id}/chapters")
def api_create_vault_chapter(notebook_id: int, body: VaultChapterCreate | None = None):
    conn = get_connection()
    try:
        title = body.title if body else None
        saved = create_vault_chapter(conn, notebook_id, title)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/vault/notebooks/{notebook_id}/reorder-chapters")
def api_reorder_vault_chapters(notebook_id: int, body: VaultChapterReorder):
    conn = get_connection()
    try:
        result = reorder_vault_chapters(conn, notebook_id, body.chapter_ids)
        conn.commit()
        return result
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/vault/chapters/{chapter_id}")
def api_update_vault_chapter(chapter_id: int, body: VaultChapterUpdate):
    conn = get_connection()
    try:
        style = body.model_dump(include={"background_color", "background_image"}, exclude_unset=True)
        saved = update_vault_chapter(conn, chapter_id, body.title, style)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/vault/chapters/{chapter_id}")
def api_delete_vault_chapter(chapter_id: int):
    conn = get_connection()
    try:
        result = delete_vault_chapter(conn, chapter_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/vault/chapters/{chapter_id}/lines")
def api_create_vault_line(chapter_id: int, body: VaultLineCreate):
    conn = get_connection()
    try:
        content = (body.content if body.content is not None else body.title) or ""
        saved = create_vault_line(conn, chapter_id, content, body.blocks, body.kind, body.parent_id)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.post("/api/vault/chapters/{chapter_id}/reorder-lines")
def api_reorder_vault_lines(chapter_id: int, body: VaultLineReorder):
    conn = get_connection()
    try:
        items = [item.model_dump() for item in body.items] if body.items is not None else None
        result = reorder_vault_lines(conn, chapter_id, body.line_ids, items)
        conn.commit()
        return result
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.put("/api/vault/lines/{line_id}")
def api_update_vault_line(line_id: int, body: VaultLineUpdate):
    conn = get_connection()
    try:
        content = body.content if body.content is not None else body.title
        saved = update_vault_line(conn, line_id, content, body.blocks, body.collapsed)
        conn.commit()
        return saved
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


@app.delete("/api/vault/lines/{line_id}")
def api_delete_vault_line(line_id: int):
    conn = get_connection()
    try:
        result = delete_vault_line(conn, line_id)
        conn.commit()
        return result
    except SparkActionError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
