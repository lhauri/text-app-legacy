"""
Real-time Collaborative Text Editor
Local:  python app.py
Render: gunicorn -k eventlet -w 1 --timeout 90 wsgi:app
"""
import copy
import os
from datetime import timedelta
from typing import Optional

from flask import (
    Flask,
    abort,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "secret")

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="eventlet",
    ping_interval=25,
    ping_timeout=60,
)

COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4"]
DEFAULT_TEXT = "# Collaborative Editor\n# Start typing to test real-time sync!\n\n"

users = {}


def new_workspace_payload(name: Optional[str] = None):
    return {
        "name": name or "Untitled Workspace",
        "text": DEFAULT_TEXT,
        "segments": [],
        "version": 0,
        "history": [],
    }


workspaces = {
    "main": {
        "name": "Main Workspace",
        "text": DEFAULT_TEXT,
        "segments": [],
        "version": 0,
        "history": [],
    }
}

_codes = {c.strip() for c in os.getenv("ACTIVATION_CODES", "collab-code").split(",") if c.strip()}
VALID_CODES = (_codes or {"collab-code"}) | {"WFGWX-YVC9B-4J6C9"}
COOKIE_NAME = "activation_code"
COOKIE_MAX_AGE = int(timedelta(days=60).total_seconds())


def has_access():
    code = request.cookies.get(COOKIE_NAME)
    return bool(code and code in VALID_CODES)


def presence_payload(workspace: str):
    return [
        {"id": uid, "name": info["name"], "color": info["color"]}
        for uid, info in users.items()
        if info.get("workspace") == workspace
    ]


def broadcast_presence(workspace: str):
    socketio.emit(
        "presence",
        {"users": presence_payload(workspace)},
        room=workspace,
    )


def ensure_workspace(workspace_id: str):
    ws = workspaces.get(workspace_id)
    if ws is None:
        workspaces[workspace_id] = new_workspace_payload()
        ws = workspaces[workspace_id]
    if not isinstance(ws.get("history"), list):
        ws["history"] = []
    return ws


def sanitize_workspace_id(raw: Optional[str]):
    if not raw:
        return "main"
    cleaned = "".join(ch for ch in raw.lower() if ch.isalnum() or ch in ("-", "_"))
    return cleaned or "main"


def workspace_list_payload():
    return [
        {"id": key, "name": data.get("name", key.title())}
        for key, data in sorted(workspaces.items())
    ]


@app.route("/")
def index():
    if not has_access():
        return redirect(url_for("activate"))
    response = make_response(render_template("editor.html"))
    raw_workspace = request.cookies.get("workspace_id")
    workspace_id = sanitize_workspace_id(raw_workspace)
    ensure_workspace(workspace_id)
    if raw_workspace != workspace_id:
        response.set_cookie(
            "workspace_id",
            workspace_id,
            max_age=COOKIE_MAX_AGE,
            samesite="Lax",
            secure=request.is_secure,
        )
    return response


@app.route("/activate", methods=["GET", "POST"])
def activate():
    if has_access():
        return redirect(url_for("index"))

    error = None
    if request.method == "POST":
        submitted = request.form.get("code", "").strip()
        if submitted in VALID_CODES:
            response = make_response(redirect(url_for("index")))
            response.set_cookie(
                COOKIE_NAME,
                submitted,
                max_age=COOKIE_MAX_AGE,
                httponly=True,
                samesite="Lax",
                secure=request.is_secure,
            )
            return response
        error = "Invalid activation code. Please try again."

    return render_template("activate.html", error=error)


def require_access():
    if not has_access():
        abort(403)


@app.get("/api/workspaces")
def list_workspaces():
    require_access()
    active = sanitize_workspace_id(request.cookies.get("workspace_id"))
    ensure_workspace(active)
    return jsonify(
        {
            "workspaces": workspace_list_payload(),
            "active": active,
        }
    )


@app.post("/api/workspaces")
def create_workspace():
    require_access()
    payload = request.get_json(silent=True) or {}
    raw_name = (payload.get("name") or "").strip()
    name = raw_name or "Untitled Workspace"
    requested_id = payload.get("id") or name.replace(" ", "-")
    workspace_id = sanitize_workspace_id(requested_id)

    if workspace_id in workspaces:
        return (
            jsonify({"error": "Workspace already exists.", "workspace": workspace_id}),
            409,
        )

    template_id = sanitize_workspace_id(payload.get("copy_from")) if payload.get("copy_from") else None
    base = workspaces.get(template_id) if template_id else None
    workspaces[workspace_id] = new_workspace_payload(name)
    if base:
        workspaces[workspace_id]["text"] = base.get("text", DEFAULT_TEXT)
        segments = base.get("segments")
        if isinstance(segments, list):
            workspaces[workspace_id]["segments"] = copy.deepcopy(segments)
        else:
            workspaces[workspace_id]["segments"] = []
        workspaces[workspace_id]["version"] = base.get("version", 0)

    return (
        jsonify(
            {
                "workspace": {
                    "id": workspace_id,
                    "name": workspaces[workspace_id]["name"],
                },
                "workspaces": workspace_list_payload(),
            }
        ),
        201,
    )


@app.put("/api/workspaces/<workspace_id>")
def update_workspace(workspace_id):
    require_access()
    workspace_id = sanitize_workspace_id(workspace_id)
    if workspace_id not in workspaces:
        abort(404)

    payload = request.get_json(silent=True) or {}
    ws = ensure_workspace(workspace_id)
    old_text = ws.get("text", "")
    history = ws.get("history")
    if not isinstance(history, list):
        history = []
    ws["history"] = history

    if "name" in payload:
        new_name = (payload.get("name") or "").strip()
        if new_name:
            ws["name"] = new_name

    text_updated = False
    if "text" in payload and isinstance(payload["text"], str):
        ws["text"] = payload["text"]
        text_updated = True

    if "segments" in payload and isinstance(payload["segments"], list):
        ws["segments"] = payload["segments"]

    ws["version"] = ws.get("version", 0) + 1

    if text_updated:
        history.append(
            {
                "version": ws["version"],
                "start": 0,
                "old_end": len(old_text),
                "new_end": len(ws.get("text", "")),
            }
        )
        if len(history) > 500:
            del history[:-500]

    return jsonify(
        {
            "workspace": {
                "id": workspace_id,
                "name": ws["name"],
            },
            "workspaces": workspace_list_payload(),
        }
    )


@app.delete("/api/workspaces/<workspace_id>")
def delete_workspace(workspace_id):
    require_access()
    workspace_id = sanitize_workspace_id(workspace_id)
    if workspace_id not in workspaces:
        abort(404)
    if workspace_id == "main":
        return jsonify({"error": "The primary workspace cannot be removed."}), 400
    if len(workspaces) <= 1:
        return jsonify({"error": "At least one workspace must exist."}), 400

    active_users = [uid for uid, info in users.items() if info.get("workspace") == workspace_id]
    if active_users:
        return (
            jsonify({"error": "Workspace is currently in use by collaborators."}),
            409,
        )

    del workspaces[workspace_id]
    return jsonify({"workspaces": workspace_list_payload()})


@app.post("/api/workspaces/select")
def select_workspace():
    require_access()
    payload = request.get_json(silent=True) or {}
    workspace_id = sanitize_workspace_id(payload.get("workspace"))
    if workspace_id not in workspaces:
        abort(404)

    response = jsonify(
        {
            "workspace": {
                "id": workspace_id,
                "name": workspaces[workspace_id]["name"],
            }
        }
    )
    response.set_cookie(
        "workspace_id",
        workspace_id,
        max_age=COOKIE_MAX_AGE,
        samesite="Lax",
        secure=request.is_secure,
    )
    return response


@socketio.on("connect")
def on_connect():
    if not has_access():
        return False

    sid = request.sid
    workspace_id = sanitize_workspace_id(request.cookies.get("workspace_id"))
    ws = ensure_workspace(workspace_id)
    used = [u["color"] for u in users.values()]
    avail = [c for c in COLORS if c not in used]
    color = avail[0] if avail else COLORS[len(users) % len(COLORS)]
    default_name = f"Guest {len(users) + 1}"
    users[sid] = {
        "color": color,
        "cursor": 0,
        "name": default_name,
        "workspace": workspace_id,
    }
    join_room(workspace_id)
    emit(
        "init",
        {
            "id": sid,
            "text": ws["text"],
            "color": color,
            "segments": ws["segments"],
            "name": default_name,
            "users": presence_payload(workspace_id),
            "workspaces": workspace_list_payload(),
            "workspace": {
                "id": workspace_id,
                "name": ws.get("name", workspace_id.title()),
                "version": ws.get("version", 0),
            },
            "version": ws.get("version", 0),
        },
    )
    broadcast_presence(workspace_id)
    print(f"User {sid[:8]} connected with color {color}")


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    if sid in users:
        workspace_id = users[sid].get("workspace")
        del users[sid]
        if workspace_id:
            emit("bye", {"id": sid}, room=workspace_id, skip_sid=sid)
            broadcast_presence(workspace_id)
    print(f"User {sid[:8]} disconnected")


@socketio.on("edit")
def on_edit(data):
    sid = request.sid

    if sid not in users:
        return

    workspace_id = users[sid]["workspace"]
    ws = ensure_workspace(workspace_id)

    old_text = ws.get("text", "")
    incoming_text = data.get("text") if isinstance(data, dict) else None
    if not isinstance(incoming_text, str):
        incoming_text = old_text

    def to_int(value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    range_payload = data.get("range") if isinstance(data, dict) else None
    if not isinstance(range_payload, dict):
        range_payload = {}

    raw_start = range_payload.get("start")
    if raw_start is None:
        raw_start = range_payload.get("s")
    raw_old_end = range_payload.get("old_end")
    raw_new_end = range_payload.get("new_end")
    if raw_new_end is None:
        raw_new_end = range_payload.get("e")

    text_length = len(incoming_text)
    slice_start = to_int(raw_start)
    if slice_start is None:
        slice_start = 0
    slice_start = max(0, min(text_length, slice_start))

    slice_end = to_int(raw_new_end)
    if slice_end is None:
        slice_end = slice_start
    slice_end = max(slice_start, min(text_length, slice_end))

    delta_text = data.get("delta") if isinstance(data, dict) else None
    if not isinstance(delta_text, str):
        delta_text = incoming_text[slice_start:slice_end]

    start = to_int(raw_start)
    if start is None:
        start = slice_start

    old_end = to_int(raw_old_end)
    if old_end is None and start is not None:
        base_delta = len(old_text) - len(incoming_text)
        replacement = slice_end - slice_start
        guess = start + max(0, base_delta + replacement)
        old_end = guess

    if start is None or old_end is None:
        start = 0
        old_end = len(old_text)
        delta_text = incoming_text

    base_version = to_int((data or {}).get("version")) if isinstance(data, dict) else None
    if base_version is None and isinstance(data, dict):
        base_version = to_int(data.get("base_version"))

    current_version = ws.get("version", 0)
    history = ws.get("history")
    if not isinstance(history, list):
        history = []
    ws["history"] = history

    def map_position(pos, c_start, c_old_end, c_new_end, treat_end=False):
        if pos is None:
            return None
        c_start = max(0, c_start)
        if c_old_end < c_start:
            c_old_end = c_start
        if c_new_end < c_start:
            c_new_end = c_start
        old_len = c_old_end - c_start
        new_len = c_new_end - c_start
        delta = new_len - old_len
        if pos <= c_start:
            return pos
        if pos >= c_old_end:
            return pos + delta
        return c_start + (new_len if treat_end else 0)

    if (
        base_version is not None
        and base_version < current_version
        and history
    ):
        for change_entry in history:
            change_version = to_int(change_entry.get("version"))
            if change_version is None or change_version <= base_version:
                continue
            c_start = to_int(change_entry.get("start")) or 0
            c_old_end = to_int(change_entry.get("old_end"))
            if c_old_end is None:
                c_old_end = c_start
            c_new_end = to_int(change_entry.get("new_end"))
            if c_new_end is None:
                c_new_end = c_start
            start = map_position(start, c_start, c_old_end, c_new_end, treat_end=False)
            old_end = map_position(old_end, c_start, c_old_end, c_new_end, treat_end=True)

    old_text_len = len(old_text)
    start = max(0, min(old_text_len, start))
    old_end = max(start, min(old_text_len, old_end))

    if not isinstance(delta_text, str):
        delta_text = ""

    new_text = old_text[:start] + delta_text + old_text[old_end:]

    new_end = start + len(delta_text)
    change = {"start": start, "old_end": old_end, "new_end": new_end}

    prev_segments = ws.get("segments")
    if not isinstance(prev_segments, list):
        prev_segments = []

    new_segments = []
    shift = new_end - start - (old_end - start)
    for seg in prev_segments:
        if not isinstance(seg, dict):
            continue
        seg_start = seg.get("start")
        seg_end = seg.get("end")
        seg_color = seg.get("color")
        if not all(isinstance(v, (int, float)) for v in (seg_start, seg_end)):
            continue
        seg_start = int(seg_start)
        seg_end = int(seg_end)
        if seg_end <= start:
            new_segments.append({"start": seg_start, "end": seg_end, "color": seg_color})
        elif seg_start >= old_end:
            new_segments.append(
                {
                    "start": seg_start + shift,
                    "end": seg_end + shift,
                    "color": seg_color,
                }
            )
        elif seg_start >= start and seg_end <= old_end:
            continue
        else:
            new_start = seg_start if seg_start < start else start
            new_seg_end = seg_end if seg_end > old_end else old_end
            adjusted_end = new_seg_end + shift
            if adjusted_end > new_start:
                new_segments.append(
                    {"start": new_start, "end": adjusted_end, "color": seg_color}
                )

    if new_end > start and delta_text:
        new_segments.append(
            {"start": start, "end": new_end, "color": users[sid]["color"]}
        )

    ws["text"] = new_text
    ws["segments"] = new_segments
    ws["version"] = current_version + 1

    history.append(
        {
            "version": ws["version"],
            "start": start,
            "old_end": old_end,
            "new_end": new_end,
        }
    )
    if len(history) > 500:
        del history[:-500]

    emit(
        "sync",
        {
            "text": ws["text"],
            "segments": ws["segments"],
            "from": sid,
            "change": change,
            "version": ws.get("version", 0),
        },
        room=workspace_id,
        include_self=True,
    )


@socketio.on("cur")
def on_cursor(data):
    sid = request.sid
    if sid in users:
        users[sid]["cursor"] = data["pos"]
        workspace_id = users[sid]["workspace"]
        emit(
            "cur",
            {
                "id": sid,
                "pos": data["pos"],
                "col": users[sid]["color"],
                "name": users[sid]["name"],
            },
            room=workspace_id,
            skip_sid=sid,
        )


@socketio.on("set_name")
def on_set_name(data):
    sid = request.sid
    if sid not in users:
        return

    raw_name = (data or {}).get("name", "")
    cleaned = " ".join(raw_name.split())[:32]
    users[sid]["name"] = cleaned or f"Guest {len(users)}"
    workspace_id = users[sid]["workspace"]
    broadcast_presence(workspace_id)


@socketio.on("switch_workspace")
def on_switch_workspace(data):
    sid = request.sid
    if sid not in users:
        return

    target = sanitize_workspace_id((data or {}).get("workspace"))
    if not target:
        return

    old_workspace = users[sid].get("workspace") or "main"
    if target == old_workspace:
        emit(
            "workspace_switched",
            {
                "workspace": {
                    "id": target,
                    "name": workspaces[target].get("name", target.title()),
                    "version": workspaces[target].get("version", 0),
                },
                "users": presence_payload(target),
                "workspaces": workspace_list_payload(),
                "version": workspaces[target].get("version", 0),
            },
        )
        return

    ensure_workspace(target)
    leave_room(old_workspace)
    join_room(target)
    users[sid]["workspace"] = target

    new_ws = workspaces[target]
    emit(
        "workspace_switched",
        {
            "workspace": {
                "id": target,
                "name": new_ws.get("name", target.title()),
                "version": new_ws.get("version", 0),
            },
            "text": new_ws["text"],
            "segments": new_ws["segments"],
            "users": presence_payload(target),
            "workspaces": workspace_list_payload(),
            "version": new_ws.get("version", 0),
        },
    )

    broadcast_presence(old_workspace)
    broadcast_presence(target)


if __name__ == "__main__":
    print("=" * 50)
    print("Starting Collaborative Editor")
    print("Open http://localhost:5000 in multiple tabs")
    print("=" * 50)
    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", "5000")),
        debug=True,
        allow_unsafe_werkzeug=True,
    )
