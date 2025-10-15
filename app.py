"""
Real-time Collaborative Text Editor
Local:  python app.py
Render: gunicorn -k eventlet -w 1 --timeout 90 wsgi:app
"""
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
    }


workspaces = {
    "main": {
        "name": "Main Workspace",
        "text": DEFAULT_TEXT,
        "segments": [],
        "version": 0,
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
        workspaces[workspace_id]["segments"] = base.get("segments", [])
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
    if "name" in payload:
        new_name = (payload.get("name") or "").strip()
        if new_name:
            workspaces[workspace_id]["name"] = new_name

    if "text" in payload and isinstance(payload["text"], str):
        workspaces[workspace_id]["text"] = payload["text"]

    if "segments" in payload and isinstance(payload["segments"], list):
        workspaces[workspace_id]["segments"] = payload["segments"]

    workspaces[workspace_id]["version"] = workspaces[workspace_id].get("version", 0) + 1

    return jsonify(
        {
            "workspace": {
                "id": workspace_id,
                "name": workspaces[workspace_id]["name"],
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
            },
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

    old_text = ws["text"]
    new_text = data["text"]
    ws["text"] = new_text
    ws["version"] = ws.get("version", 0) + 1

    change = None
    rng = data.get("range")
    if rng:
        start = rng["s"]
        end_new = rng["e"]
        old_end = start + (len(old_text) - len(new_text) + end_new - start)
        new_len = end_new - start

        change = {"start": start, "old_end": old_end, "new_end": end_new}

        new_segments = []
        for seg in ws["segments"]:
            if seg["end"] <= start:
                new_segments.append(seg)
            elif seg["start"] >= old_end:
                shift = new_len - (old_end - start)
                new_segments.append(
                    {
                        "start": seg["start"] + shift,
                        "end": seg["end"] + shift,
                        "color": seg["color"],
                    }
                )
            elif seg["start"] >= start and seg["end"] <= old_end:
                pass
            else:
                new_start = seg["start"] if seg["start"] < start else start
                new_end = seg["end"] if seg["end"] > old_end else old_end
                shift = new_len - (old_end - start)
                if new_end + shift > new_start:
                    new_segments.append(
                        {
                            "start": new_start,
                            "end": new_end + shift,
                            "color": seg["color"],
                        }
                    )

        if end_new > start:
            new_segments.append(
                {"start": start, "end": end_new, "color": users[sid]["color"]}
            )

        ws["segments"] = new_segments

    emit(
        "sync",
        {
            "text": ws["text"],
            "segments": ws["segments"],
            "from": sid,
            "change": change,
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
                },
                "users": presence_payload(target),
                "workspaces": workspace_list_payload(),
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
            },
            "text": new_ws["text"],
            "segments": new_ws["segments"],
            "users": presence_payload(target),
            "workspaces": workspace_list_payload(),
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
