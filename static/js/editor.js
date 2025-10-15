const socket = io({
    transports: ['websocket'],
    upgrade: false,
    reconnection: true,
    reconnectionAttempts: 50,
    reconnectionDelay: 500
});

const ed = document.getElementById('editor');
const gut = document.getElementById('gutter');
const ov = document.getElementById('overlay');
const curs = document.getElementById('curs');
const dot = document.getElementById('dot');
const meas = document.getElementById('measure');
const wrapper = document.getElementById('editor-wrapper');
const nameInput = document.getElementById('display-name');
const participants = document.getElementById('participants');
const themeToggle = document.getElementById('theme-toggle');
const workspaceSelect = document.getElementById('workspace-select');
const workspaceNewBtn = document.getElementById('workspace-new');
const workspaceSaveBtn = document.getElementById('workspace-save');
const workspaceDeleteBtn = document.getElementById('workspace-delete');
const workspaceNameEl = document.getElementById('workspace-name');
const workspaceNoteEl = document.getElementById('workspace-note');
const statusWords = document.getElementById('status-words');
const statusLines = document.getElementById('status-lines');
const statusChars = document.getElementById('status-chars');
const weatherToggle = document.getElementById('weather-toggle');
const weatherPanel = document.getElementById('weather-panel');
const weatherForm = document.getElementById('weather-form');
const weatherInput = document.getElementById('weather-query');
const weatherList = document.getElementById('weather-list');
const weatherMessage = document.getElementById('weather-message');
const userLabel = document.querySelector('.app-user-label');
const docEl = document.documentElement;

let myCol = '#3b82f6';
let myId = null;
let lastText = '';
let myName = '';
let peers = {};
let segments = [];
let workspaceId = 'main';
let workspaceLabel = 'Main Workspace';
let workspaceList = [];
let workspaceNoteTimer = null;
let workspaceBusy = false;

const WEATHER_STORAGE_KEY = 'collab_weather_locations';
let weatherLocations = [];

const WEATHER_CODE_MAP = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Drizzle',
    55: 'Heavy drizzle',
    56: 'Freezing drizzle',
    57: 'Freezing drizzle',
    61: 'Light rain',
    63: 'Rain',
    65: 'Heavy rain',
    66: 'Freezing rain',
    67: 'Freezing rain',
    71: 'Light snow',
    73: 'Snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Rain showers',
    81: 'Rain showers',
    82: 'Violent rain showers',
    85: 'Snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Thunderstorm with hail'
};

const ro = new ResizeObserver(() => {
    if (wrapper) {
        meas.style.width = ov.clientWidth + 'px';
    }
});
if (wrapper) {
    ro.observe(wrapper);
}

if (themeToggle) {
    const initialTheme = docEl.dataset.theme === 'light' ? 'light' : 'dark';
    updateThemeToggle(initialTheme);
    themeToggle.addEventListener('click', () => {
        const next = docEl.dataset.theme === 'light' ? 'dark' : 'light';
        applyTheme(next);
    });
}

if (workspaceSelect) {
    workspaceSelect.addEventListener('change', event => {
        const next = event.target.value;
        if (next) {
            selectWorkspace(next);
        }
    });
}

if (workspaceSaveBtn) {
    workspaceSaveBtn.addEventListener('click', () => {
        saveWorkspace();
    });
}

if (workspaceNewBtn) {
    workspaceNewBtn.addEventListener('click', () => {
        createWorkspace();
    });
}

if (workspaceDeleteBtn) {
    workspaceDeleteBtn.addEventListener('click', () => {
        deleteWorkspace();
    });
}

if (weatherToggle && weatherPanel) {
    weatherToggle.addEventListener('click', () => {
        const isHidden = weatherPanel.hasAttribute('hidden');
        if (isHidden) {
            weatherPanel.removeAttribute('hidden');
            weatherToggle.setAttribute('aria-expanded', 'true');
            if (!weatherLocations.length) {
                showWeatherMessage('Add a city to see its weather.');
            }
            refreshWeather();
        } else {
            weatherPanel.setAttribute('hidden', '');
            weatherToggle.setAttribute('aria-expanded', 'false');
        }
    });
}

if (weatherForm) {
    weatherForm.addEventListener('submit', event => {
        event.preventDefault();
        const query = weatherInput ? weatherInput.value.trim() : '';
        if (!query) {
            showWeatherMessage('Enter a city name to add it.', 'error');
            return;
        }
        addWeatherLocation(query);
    });
}

if (nameInput) {
    const trySubmitName = () => {
        const cleaned = sanitizeName(nameInput.value);
        if (cleaned === myName) return;
        socket.emit('set_name', { name: cleaned });
        persistName(cleaned);
    };
    nameInput.addEventListener('change', trySubmitName);
    nameInput.addEventListener('blur', trySubmitName);
    nameInput.addEventListener('keydown', evt => {
        if (evt.key === 'Enter') {
            evt.preventDefault();
            nameInput.blur();
        }
    });
}

if (weatherList) {
    weatherLocations = loadWeatherLocations();
    renderWeatherLocations();
}

function caretClientXY(pos) {
    const before = esc(ed.value.substring(0, pos)).replace(/\n/g, '<br>');
    meas.innerHTML = before + '<span id="caret-marker">\u200b</span>';
    const marker = document.getElementById('caret-marker');
    const left = marker ? marker.offsetLeft : 0;
    const top = marker ? marker.offsetTop : 0;
    return { x: left - ed.scrollLeft, y: top - ed.scrollTop };
}

function indexForXY(targetX, targetY) {
    const n = ed.value.length;
    if (n === 0) return 0;

    let lo = 0, hi = n;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const p = caretClientXY(mid);
        if (p.y < targetY || (p.y === targetY && p.x < targetX)) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    let idx = Math.max(0, Math.min(n, lo));

    const win = 24;
    let best = idx;
    let bestd = Number.POSITIVE_INFINITY;
    const from = Math.max(0, idx - win);
    const to = Math.min(n, idx + win);
    for (let i = from; i <= to; i++) {
        const p = caretClientXY(i);
        const dy = p.y - targetY;
        const dx = p.x - targetX;
        const d2 = dy * dy + dx * dx;
        if (d2 < bestd) {
            bestd = d2;
            best = i;
        }
    }
    return best;
}

socket.on('init', data => {
    myId = data.id;
    myCol = data.color;
    dot.style.background = myCol;

    workspaceId = data.workspace?.id || workspaceId;
    workspaceLabel = data.workspace?.name || workspaceLabel;
    workspaceList = Array.isArray(data.workspaces) ? data.workspaces : [];
    populateWorkspaceSelect(workspaceList, workspaceId);
    updateWorkspaceStatus();

    updateSelfName(data.name || '');
    const storedName = sanitizeName(readCookie('collab_name'));
    if (storedName && storedName !== (data.name || '')) {
        if (nameInput) {
            nameInput.value = storedName;
        }
        socket.emit('set_name', { name: storedName });
        persistName(storedName);
    }

    const text = data.text || '';
    ed.value = text;
    lastText = text;
    segments = data.segments || [];
    meas.textContent = text;
    peers = {};
    updateParticipants(data.users || []);
    updateGutter();
    renderSegments();
    drawCurs();
    updateStatusBar();
});

socket.on('sync', data => {
    const hadFocus = document.activeElement === ed;
    const prevSelStart = ed.selectionStart;
    const prevSelEnd = ed.selectionEnd;
    const selectionDirection = ed.selectionDirection;
    const prevScrollTop = ed.scrollTop;
    const prevScrollLeft = ed.scrollLeft;

    ed.value = data.text;
    lastText = data.text;
    segments = data.segments || [];
    meas.textContent = ed.value;

    if (hadFocus) {
        let nextStart = prevSelStart;
        let nextEnd = prevSelEnd;
        const change = data.change;
        if (change && data.from !== myId) {
            const { start, old_end, new_end } = change;
            const oldLen = old_end - start;
            const newLen = new_end - start;
            const delta = newLen - oldLen;
            const clamp = v => Math.max(0, Math.min(ed.value.length, v));
            const mapPos = pos => {
                if (pos <= start) return pos;
                if (pos >= old_end) return pos + delta;
                const rel = pos - start;
                return start + Math.min(newLen, Math.max(0, rel));
            };
            nextStart = mapPos(prevSelStart);
            nextEnd = mapPos(prevSelEnd);
            nextStart = clamp(nextStart);
            nextEnd = clamp(nextEnd);
        }
        ed.setSelectionRange(nextStart, nextEnd, selectionDirection);
    }

    ed.scrollTop = prevScrollTop;
    ed.scrollLeft = prevScrollLeft;

    if (data.change) {
        adjustPeerPositions(data.change, data.from);
    }

    updateGutter();
    renderSegments();
    drawCurs();
    updateStatusBar();
});

socket.on('cur', data => {
    if (data.id === myId) return;
    const existing = peers[data.id] || {};
    peers[data.id] = {
        pos: data.pos,
        col: data.col,
        name: data.name || existing.name || 'Collaborator'
    };
    drawCurs();
});

socket.on('bye', data => {
    delete peers[data.id];
    drawCurs();
});

socket.on('presence', data => {
    updateParticipants(data.users || []);
});

socket.on('workspace_switched', data => {
    workspaceList = Array.isArray(data.workspaces) ? data.workspaces : workspaceList;
    workspaceId = data.workspace?.id || workspaceId;
    workspaceLabel = data.workspace?.name || workspaceLabel;
    populateWorkspaceSelect(workspaceList, workspaceId);
    updateWorkspaceStatus();

    peers = {};
    updateParticipants(data.users || []);

    const text = data.text ?? '';
    const hadFocus = document.activeElement === ed;
    ed.value = text;
    lastText = text;
    segments = data.segments || [];
    meas.textContent = text;
    if (hadFocus) {
        const pos = Math.min(ed.value.length, ed.selectionStart);
        ed.setSelectionRange(pos, pos);
    }
    updateGutter();
    renderSegments();
    drawCurs();
    updateStatusBar();
    setWorkspaceBusy(false);
    showWorkspaceNote('Workspace ready', 'success');
});

ed.addEventListener('input', () => {
    const txt = ed.value;

    let s = 0;
    while (s < lastText.length && s < txt.length && lastText[s] === txt[s]) s++;
    let oldE = lastText.length;
    let newE = txt.length;
    while (oldE > s && newE > s && lastText[oldE - 1] === txt[newE - 1]) {
        oldE--;
        newE--;
    }

    socket.emit('edit', { text: txt, range: { s, e: newE } });

    lastText = txt;
    meas.textContent = txt;
    updateGutter();
    renderSegments();
    drawCurs();
    updateStatusBar();
});

let curT;
function sendCur() {
    clearTimeout(curT);
    curT = setTimeout(() => socket.emit('cur', { pos: ed.selectionStart }), 50);
}
ed.addEventListener('keyup', sendCur);
ed.addEventListener('mouseup', sendCur);
ed.addEventListener('click', sendCur);

ed.addEventListener('scroll', () => {
    gut.style.transform = 'translateY(-' + ed.scrollTop + 'px)';
    ov.scrollTop = ed.scrollTop;
    ov.scrollLeft = ed.scrollLeft;
    drawCurs();
});

function updateGutter() {
    const n = ed.value.split('\n').length;
    gut.innerHTML = Array.from({ length: n }, (_, i) => i + 1).join('\n');
}

function renderSegments() {
    if (!segments.length) {
        ov.innerHTML = esc(ed.value);
        return;
    }
    const txt = ed.value;
    let html = '';
    let pos = 0;
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    for (const seg of sorted) {
        if (seg.start > pos) html += esc(txt.substring(pos, seg.start));
        html += '<span class="highlight" style="--c:' + seg.color + '">' + esc(txt.substring(seg.start, seg.end)) + '</span>';
        pos = seg.end;
    }
    if (pos < txt.length) html += esc(txt.substring(pos));
    ov.innerHTML = html;
}

function drawCurs() {
    curs.innerHTML = '';
    for (const id in peers) {
        const peer = peers[id];
        const xy = caretClientXY(peer.pos);
        const cursor = document.createElement('div');
        cursor.className = 'remote-cursor';
        cursor.style.background = peer.col;
        cursor.style.left = xy.x + 'px';
        cursor.style.top = xy.y + 'px';
        cursor.dataset.name = peer.name || '';
        cursor.title = peer.name || '';
        curs.appendChild(cursor);
    }
}

function esc(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function updateThemeToggle(theme) {
    if (!themeToggle) return;
    themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

function applyTheme(theme) {
    docEl.dataset.theme = theme;
    try {
        localStorage.setItem('theme', theme);
    } catch (err) {
        // ignore persistence errors
    }
    updateThemeToggle(theme);
}

function sanitizeName(value) {
    return (value || '').replace(/\s+/g, ' ').trim().slice(0, 32);
}

function persistName(value) {
    setCookie('collab_name', value, 60);
}

function updateSelfName(name) {
    myName = name;
    if (nameInput) {
        nameInput.value = name;
    }
    if (userLabel) {
        userLabel.textContent = name ? `You · ${name}` : 'You';
    }
}

function updateParticipants(list) {
    if (!Array.isArray(list)) return;

    const seen = new Set();
    const selfId = myId;
    for (const user of list) {
        if (!user || !user.id) continue;
        if (selfId && user.id === selfId) {
            if (user.name !== undefined) {
                updateSelfName(user.name || '');
            }
            if (user.color && user.color !== myCol) {
                myCol = user.color;
                dot.style.background = myCol;
            }
            continue;
        }

        const existing = peers[user.id] || {};
        const hasPos = Object.prototype.hasOwnProperty.call(existing, 'pos');
        peers[user.id] = {
            pos: hasPos ? existing.pos : 0,
            col: user.color ?? existing.col ?? '#3b82f6',
            name: user.name ?? existing.name ?? 'Collaborator'
        };
        seen.add(user.id);
    }

    for (const id in peers) {
        if (!seen.has(id) && id !== myId) {
            delete peers[id];
        }
    }

    if (participants) {
        participants.innerHTML = '';
        for (const user of list) {
            if (!user || user.id === myId) continue;
            const item = document.createElement('span');
            item.className = 'participant';
            item.style.setProperty('--participant-color', user.color || '#6b7280');
            item.textContent = user.name || 'Collaborator';
            participants.appendChild(item);
        }
    }

    drawCurs();
}

function adjustPeerPositions(change, authorId) {
    const { start, old_end, new_end } = change;
    const oldLen = old_end - start;
    const newLen = new_end - start;
    const delta = newLen - oldLen;
    const clamp = value => Math.max(0, Math.min(ed.value.length, value));

    for (const id in peers) {
        const peer = peers[id];
        if (!peer) continue;
        if (id === authorId) {
            peer.pos = clamp(new_end);
            continue;
        }
        if (peer.pos <= start) {
            peer.pos = clamp(peer.pos);
        } else if (peer.pos >= old_end) {
            peer.pos = clamp(peer.pos + delta);
        } else {
            const rel = peer.pos - start;
            peer.pos = clamp(start + Math.min(newLen, Math.max(0, rel)));
        }
    }
}

function updateStatusBar() {
    const text = ed.value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text.length ? text.split('\n').length : 1;
    const chars = text.length;
    if (statusWords) statusWords.textContent = words.toString();
    if (statusLines) statusLines.textContent = lines.toString();
    if (statusChars) statusChars.textContent = chars.toString();
    updateWorkspaceStatus();
}

function populateWorkspaceSelect(list = [], active = workspaceId) {
    if (!workspaceSelect) return;
    workspaceSelect.innerHTML = '';
    for (const ws of list) {
        if (!ws || !ws.id) continue;
        const option = document.createElement('option');
        option.value = ws.id;
        option.textContent = ws.name || ws.id;
        if (ws.id === active) {
            option.selected = true;
        }
        workspaceSelect.appendChild(option);
    }
    if (workspaceSelect.options.length && !Array.from(workspaceSelect.options).some(opt => opt.value === active)) {
        workspaceSelect.selectedIndex = 0;
    }
}

function setWorkspaceBusy(state) {
    workspaceBusy = state;
    const controls = [workspaceSelect, workspaceNewBtn, workspaceSaveBtn, workspaceDeleteBtn];
    controls.forEach(ctrl => {
        if (ctrl) ctrl.disabled = state;
    });
}

function updateWorkspaceStatus(note, tone) {
    if (workspaceNameEl) {
        workspaceNameEl.textContent = workspaceLabel;
    }
    document.title = `${workspaceLabel} · Collaborative Editor`;
    if (typeof note !== 'undefined') {
        showWorkspaceNote(note, tone);
    }
}

function showWorkspaceNote(message, tone = 'info') {
    if (!workspaceNoteEl) return;
    if (!message) {
        workspaceNoteEl.textContent = '';
        workspaceNoteEl.classList.remove('success', 'error');
        if (workspaceNoteTimer) {
            clearTimeout(workspaceNoteTimer);
            workspaceNoteTimer = null;
        }
        return;
    }
    workspaceNoteEl.textContent = `· ${message}`;
    workspaceNoteEl.classList.remove('success', 'error');
    if (tone === 'success') {
        workspaceNoteEl.classList.add('success');
    } else if (tone === 'error') {
        workspaceNoteEl.classList.add('error');
    }
    if (workspaceNoteTimer) {
        clearTimeout(workspaceNoteTimer);
    }
    workspaceNoteTimer = setTimeout(() => {
        workspaceNoteEl.textContent = '';
        workspaceNoteEl.classList.remove('success', 'error');
        workspaceNoteTimer = null;
    }, 4000);
}

async function selectWorkspace(nextId) {
    if (!nextId || nextId === workspaceId || workspaceBusy) {
        populateWorkspaceSelect(workspaceList, workspaceId);
        return;
    }
    setWorkspaceBusy(true);
    try {
        const res = await fetch('/api/workspaces/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ workspace: nextId })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload.error || 'Unable to switch workspace');
        }
        showWorkspaceNote('Switching…');
        socket.emit('switch_workspace', { workspace: nextId });
    } catch (err) {
        console.error(err);
        showWorkspaceNote(err.message || 'Unable to switch workspace', 'error');
        setWorkspaceBusy(false);
        populateWorkspaceSelect(workspaceList, workspaceId);
    }
}

async function saveWorkspace() {
    if (workspaceBusy) return;
    setWorkspaceBusy(true);
    showWorkspaceNote('Saving…');
    try {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ text: ed.value, segments })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload.error || 'Unable to save workspace');
        }
        const updated = payload.workspace || {};
        if (updated.name) {
            workspaceLabel = updated.name;
        }
        workspaceList = Array.isArray(payload.workspaces) ? payload.workspaces : workspaceList;
        populateWorkspaceSelect(workspaceList, workspaceId);
        updateWorkspaceStatus('Saved', 'success');
    } catch (err) {
        console.error(err);
        showWorkspaceNote(err.message || 'Save failed', 'error');
    } finally {
        setWorkspaceBusy(false);
    }
}

async function createWorkspace() {
    if (workspaceBusy) return;
    const name = prompt('Name for the new workspace', '');
    if (name === null) return;
    const cleaned = name.trim().slice(0, 48);
    if (!cleaned) {
        showWorkspaceNote('Workspace name is required', 'error');
        return;
    }
    const copy = confirm('Start from the current document?');
    setWorkspaceBusy(true);
    showWorkspaceNote('Creating…');
    try {
        const payload = { name: cleaned };
        if (copy) payload.copy_from = workspaceId;
        const res = await fetch('/api/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'Unable to create workspace');
        }
        workspaceList = Array.isArray(data.workspaces) ? data.workspaces : workspaceList;
        populateWorkspaceSelect(workspaceList, workspaceId);
        setWorkspaceBusy(false);
        const created = data.workspace || {};
        if (created.id) {
            showWorkspaceNote('Opening new workspace…');
            selectWorkspace(created.id);
        } else {
            showWorkspaceNote('Workspace created', 'success');
        }
    } catch (err) {
        setWorkspaceBusy(false);
        console.error(err);
        showWorkspaceNote(err.message || 'Unable to create workspace', 'error');
    }
}

async function deleteWorkspace() {
    if (workspaceBusy) return;
    const target = workspaceSelect ? workspaceSelect.value : workspaceId;
    if (!target) return;
    if (target === 'main') {
        showWorkspaceNote('The primary workspace cannot be deleted', 'error');
        return;
    }
    const confirmed = confirm('Delete this workspace? This action cannot be undone.');
    if (!confirmed) return;
    setWorkspaceBusy(true);
    showWorkspaceNote('Deleting…');
    try {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(target)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'Unable to delete workspace');
        }
        workspaceList = Array.isArray(data.workspaces) ? data.workspaces : [];
        let nextId = workspaceId;
        if (target === workspaceId) {
            nextId = workspaceList.length ? workspaceList[0].id : 'main';
        }
        populateWorkspaceSelect(workspaceList, nextId);
        setWorkspaceBusy(false);
        if (target === workspaceId) {
            selectWorkspace(nextId);
        } else {
            showWorkspaceNote('Workspace deleted', 'success');
        }
    } catch (err) {
        setWorkspaceBusy(false);
        console.error(err);
        showWorkspaceNote(err.message || 'Unable to delete workspace', 'error');
        populateWorkspaceSelect(workspaceList, workspaceId);
    }
}

function setCookie(name, value, days = 60) {
    let maxAge = Math.floor(days * 24 * 60 * 60);
    if (!value) {
        maxAge = 0;
    }
    document.cookie = `${name}=${encodeURIComponent(value || '')}; max-age=${maxAge}; path=/`;
}

function readCookie(name) {
    const parts = document.cookie ? document.cookie.split(';') : [];
    for (const part of parts) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) {
            return decodeURIComponent(rest.join('='));
        }
    }
    return '';
}

function loadWeatherLocations() {
    try {
        const raw = localStorage.getItem(WEATHER_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map(loc => ({
                id: loc.id,
                name: loc.name,
                country: loc.country,
                latitude: Number(loc.latitude),
                longitude: Number(loc.longitude),
                label: loc.label || buildWeatherLabel(loc)
            }))
            .filter(loc => !Number.isNaN(loc.latitude) && !Number.isNaN(loc.longitude));
    } catch (err) {
        return [];
    }
}

function saveWeatherLocations() {
    try {
        const payload = weatherLocations.map(loc => ({
            id: loc.id,
            name: loc.name,
            country: loc.country,
            latitude: loc.latitude,
            longitude: loc.longitude,
            label: loc.label || buildWeatherLabel(loc)
        }));
        localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
        // ignore
    }
}

function renderWeatherLocations() {
    if (!weatherList) return;
    weatherList.innerHTML = '';
    if (!weatherLocations.length) {
        showWeatherMessage('Add a city to see its weather.');
        return;
    }
    showWeatherMessage('');
    for (const location of weatherLocations) {
        const item = document.createElement('li');
        item.className = 'weather-item';
        item.dataset.id = location.id;

        const meta = document.createElement('div');
        meta.className = 'weather-meta';
        const title = document.createElement('span');
        title.className = 'weather-title';
        title.textContent = location.label || buildWeatherLabel(location);
        const details = document.createElement('span');
        details.className = 'weather-details';
        details.textContent = 'Loading…';
        meta.appendChild(title);
        meta.appendChild(details);

        const actions = document.createElement('div');
        actions.className = 'weather-actions';
        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'weather-refresh';
        refreshBtn.textContent = 'Refresh';
        refreshBtn.addEventListener('click', () => {
            updateWeatherItem(location, details, item);
        });
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'weather-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
            removeWeatherLocation(location.id);
        });
        actions.appendChild(refreshBtn);
        actions.appendChild(removeBtn);

        item.appendChild(meta);
        item.appendChild(actions);
        weatherList.appendChild(item);
        updateWeatherItem(location, details, item);
    }
}

async function updateWeatherItem(location, detailsEl, itemEl) {
    if (!detailsEl) return;
    itemEl?.classList.remove('error');
    detailsEl.textContent = 'Loading…';
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current_weather=true&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error('Weather request failed');
        }
        const data = await res.json();
        const current = data.current_weather;
        if (!current) {
            detailsEl.textContent = 'No data available';
            return;
        }
        const temp = Math.round(current.temperature);
        const wind = Math.round(current.windspeed);
        const desc = describeWeather(current.weathercode);
        const timeText = formatWeatherTime(current.time);
        const parts = [`${temp}°C`, desc, `Wind ${wind} km/h`];
        if (timeText) parts.push(timeText);
        detailsEl.textContent = parts.join(' • ');
    } catch (err) {
        console.error(err);
        detailsEl.textContent = 'Unable to load';
        itemEl?.classList.add('error');
    }
}

async function addWeatherLocation(query) {
    showWeatherMessage('Looking up city…');
    try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error('Lookup failed');
        }
        const data = await res.json();
        if (!data.results || !data.results.length) {
            showWeatherMessage('No matching locations found.', 'error');
            return;
        }
        const result = data.results[0];
        const location = {
            id: `${result.latitude.toFixed(2)}_${result.longitude.toFixed(2)}_${Date.now()}`,
            name: result.name,
            country: result.country || '',
            latitude: result.latitude,
            longitude: result.longitude
        };
        location.label = buildWeatherLabel(location);
        weatherLocations.push(location);
        saveWeatherLocations();
        if (weatherInput) {
            weatherInput.value = '';
        }
        showWeatherMessage(`Added ${location.label}`, 'success');
        renderWeatherLocations();
    } catch (err) {
        console.error(err);
        showWeatherMessage('Weather lookup failed. Try again later.', 'error');
    }
}

function removeWeatherLocation(id) {
    weatherLocations = weatherLocations.filter(loc => loc.id !== id);
    saveWeatherLocations();
    renderWeatherLocations();
    if (!weatherLocations.length) {
        showWeatherMessage('Add a city to see its weather.');
    }
}

function refreshWeather() {
    if (!weatherList) return;
    const items = weatherList.querySelectorAll('.weather-item');
    items.forEach(item => {
        const id = item.dataset.id;
        const location = weatherLocations.find(loc => loc.id === id);
        const details = item.querySelector('.weather-details');
        if (location && details) {
            updateWeatherItem(location, details, item);
        }
    });
}

function showWeatherMessage(message, tone = 'info') {
    if (!weatherMessage) return;
    weatherMessage.textContent = message;
    if (tone === 'info' && !message) {
        weatherMessage.removeAttribute('data-tone');
    } else {
        weatherMessage.setAttribute('data-tone', tone);
    }
}

function describeWeather(code) {
    return WEATHER_CODE_MAP[code] || 'Conditions';
}

function formatWeatherTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return `Updated ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function buildWeatherLabel(loc) {
    if (!loc) return '';
    const name = loc.name || 'Location';
    const country = loc.country ? `, ${loc.country}` : '';
    return `${name}${country}`;
}
