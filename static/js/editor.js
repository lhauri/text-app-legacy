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
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const settingsClose = document.getElementById('settings-close');
const languageSelect = document.getElementById('language-select');
const workspaceControls = document.querySelector('.workspace-controls');
const userLabel = document.querySelector('.app-user-label');
const docEl = document.documentElement;
const cursorTooltip = wrapper ? (() => {
    const el = document.createElement('div');
    el.className = 'cursor-tooltip';
    wrapper.appendChild(el);
    return el;
})() : null;

const CURSOR_TOOLTIP_MARGIN_X = 10;
const CURSOR_TOOLTIP_MARGIN_Y = 14;
const CURSOR_THROTTLE_MS = 40;

/**
 * Compute the minimal range that changed between two text snapshots.
 * The returned object always uses the coordinates of the "before" text
 * for {@link start} and {@link old_end}, and the coordinates of the
 * "after" text for {@link new_end}. This makes it safe to map cursor
 * positions forward even when the server applied the edit slightly out
 * of order (for example when two people type at once).
 */
function computeTextDiff(before = '', after = '') {
    if (typeof before !== 'string') before = '';
    if (typeof after !== 'string') after = '';

    if (before === after) {
        const pos = before.length;
        return { start: pos, old_end: pos, new_end: pos };
    }

    let start = 0;
    const maxPrefix = Math.min(before.length, after.length);
    while (start < maxPrefix && before.charCodeAt(start) === after.charCodeAt(start)) {
        start += 1;
    }

    let beforeEnd = before.length;
    let afterEnd = after.length;
    while (
        beforeEnd > start &&
        afterEnd > start &&
        before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)
    ) {
        beforeEnd -= 1;
        afterEnd -= 1;
    }

    return { start, old_end: beforeEnd, new_end: afterEnd };
}

let myCol = '#3b82f6';
let myId = null;
let lastText = '';
let myName = '';
let peers = {};
let lastPresence = [];
let segments = [];
let workspaceId = 'main';
let workspaceLabel = 'Main Workspace';
let workspaceList = [];
let workspaceNoteTimer = null;
let workspaceBusy = false;
let workspaceVersion = 0;
let cursorEmitTimer = null;
let lastCursorEmit = 0;
let lastSentCursorPos = null;
let activeTooltipPeer = null;

const WEATHER_STORAGE_KEY = 'collab_weather_locations';
let weatherLocations = [];

const LANGUAGE_STORAGE_KEY = 'collab_language';
const FALLBACK_LANGUAGE = 'en';
let currentLanguage = FALLBACK_LANGUAGE;

const translations = {
    en: {
        brandTitle: 'Collaborative Editor',
        brandSubtitle: 'Write together in real time',
        userLabel: 'You',
        displayNameLabel: 'Display name',
        displayNamePlaceholder: 'Set your name',
        workspaceNew: 'New',
        workspaceSave: 'Save',
        workspaceDelete: 'Delete',
        weatherTitle: 'Weather',
        weatherAddLabel: 'Add location',
        weatherAddPlaceholder: 'Add a city',
        weatherAddAction: 'Add',
        weatherToggleLabel: 'Toggle weather panel',
        settingsTitle: 'Settings',
        settingsSubtitle: 'Personalize your workspace',
        settingsToggleLabel: 'Open settings',
        settingsCloseLabel: 'Close settings',
        languageLabel: 'Language',
        languageEnglish: 'English',
        languageGerman: 'Deutsch',
        languageChinese: '中文',
        statusWorkspace: 'Workspace',
        statusWords: 'Words',
        statusLines: 'Lines',
        statusChars: 'Characters',
        documentTitle: '{workspace} · Collaborative Editor',
        themeToggleLight: 'Switch to light mode',
        themeToggleDark: 'Switch to dark mode',
        collaboratorFallback: 'Collaborator',
        workspaceReady: 'Workspace ready',
        workspaceSwitching: 'Switching…',
        workspaceSwitchFailed: 'Unable to switch workspace',
        workspaceSaving: 'Saving…',
        workspaceSaveFailed: 'Save failed',
        workspaceSaved: 'Saved',
        workspaceCreatePrompt: 'Name for the new workspace',
        workspaceCreateEmpty: 'Workspace name is required',
        workspaceCreateCopyPrompt: 'Start from the current document?',
        workspaceCreating: 'Creating…',
        workspaceCreateFailed: 'Unable to create workspace',
        workspaceOpenNew: 'Opening new workspace…',
        workspaceCreated: 'Workspace created',
        workspaceDeleteProtected: 'The primary workspace cannot be deleted',
        workspaceDeleteConfirm: 'Delete this workspace? This action cannot be undone.',
        workspaceDeleting: 'Deleting…',
        workspaceDeleteFailed: 'Unable to delete workspace',
        workspaceDeleted: 'Workspace deleted',
        workspaceSelectPlaceholder: 'Select a workspace…',
        workspaceSelectEmpty: 'No saved workspaces yet',
        workspaceActiveIndicator: 'current',
        participantsLabel: 'Participants',
        participantsEmpty: 'No collaborators yet',
        weatherPromptEmpty: 'Add a city to see its weather.',
        weatherPromptEnter: 'Enter a city name to add it.',
        weatherLoading: 'Loading…',
        weatherRefresh: 'Refresh',
        weatherRemove: 'Remove',
        weatherRequestFailed: 'Weather request failed',
        weatherNoData: 'No data available',
        weatherUnableToLoad: 'Unable to load',
        weatherLookingUp: 'Looking up city…',
        weatherLookupFailed: 'Weather lookup failed. Try again later.',
        weatherNoMatch: 'No matching locations found.',
        weatherAdded: 'Added {location}',
        weatherWind: 'Wind {speed} km/h',
        weatherUpdated: 'Updated {time}',
        weatherLocationFallback: 'Location',
        weatherConditionsFallback: 'Conditions',
        nameDefault: 'You',
        nameWithValue: 'You · {name}',
        weatherApiLanguage: 'en'
    },
    de: {
        brandTitle: 'Gemeinsamer Editor',
        brandSubtitle: 'Schreibe in Echtzeit zusammen',
        userLabel: 'Du',
        displayNameLabel: 'Anzeigename',
        displayNamePlaceholder: 'Name festlegen',
        workspaceNew: 'Neu',
        workspaceSave: 'Speichern',
        workspaceDelete: 'Löschen',
        weatherTitle: 'Wetter',
        weatherAddLabel: 'Ort hinzufügen',
        weatherAddPlaceholder: 'Stadt hinzufügen',
        weatherAddAction: 'Hinzufügen',
        weatherToggleLabel: 'Wetterbereich umschalten',
        settingsTitle: 'Einstellungen',
        settingsSubtitle: 'Passe deinen Arbeitsbereich an',
        settingsToggleLabel: 'Einstellungen öffnen',
        settingsCloseLabel: 'Einstellungen schließen',
        languageLabel: 'Sprache',
        languageEnglish: 'English',
        languageGerman: 'Deutsch',
        languageChinese: '中文',
        statusWorkspace: 'Arbeitsbereich',
        statusWords: 'Wörter',
        statusLines: 'Zeilen',
        statusChars: 'Zeichen',
        documentTitle: '{workspace} · Gemeinsamer Editor',
        themeToggleLight: 'Zum Lichtmodus wechseln',
        themeToggleDark: 'Zum Dunkelmodus wechseln',
        collaboratorFallback: 'Mitarbeiter',
        workspaceReady: 'Arbeitsbereich bereit',
        workspaceSwitching: 'Wechsel wird vorbereitet…',
        workspaceSwitchFailed: 'Arbeitsbereich konnte nicht gewechselt werden',
        workspaceSaving: 'Speichern…',
        workspaceSaveFailed: 'Speichern fehlgeschlagen',
        workspaceSaved: 'Gespeichert',
        workspaceCreatePrompt: 'Name für den neuen Arbeitsbereich',
        workspaceCreateEmpty: 'Ein Name für den Arbeitsbereich ist erforderlich',
        workspaceCreateCopyPrompt: 'Vom aktuellen Dokument starten?',
        workspaceCreating: 'Erstelle…',
        workspaceCreateFailed: 'Arbeitsbereich konnte nicht erstellt werden',
        workspaceOpenNew: 'Neuer Arbeitsbereich wird geöffnet…',
        workspaceCreated: 'Arbeitsbereich erstellt',
        workspaceDeleteProtected: 'Der primäre Arbeitsbereich kann nicht gelöscht werden',
        workspaceDeleteConfirm: 'Diesen Arbeitsbereich löschen? Dies kann nicht rückgängig gemacht werden.',
        workspaceDeleting: 'Lösche…',
        workspaceDeleteFailed: 'Arbeitsbereich konnte nicht gelöscht werden',
        workspaceDeleted: 'Arbeitsbereich gelöscht',
        workspaceSelectPlaceholder: 'Arbeitsbereich wählen…',
        workspaceSelectEmpty: 'Noch keine Arbeitsbereiche',
        workspaceActiveIndicator: 'aktiv',
        participantsLabel: 'Teilnehmende',
        participantsEmpty: 'Keine weiteren Teilnehmenden',
        weatherPromptEmpty: 'Füge eine Stadt hinzu, um das Wetter zu sehen.',
        weatherPromptEnter: 'Gib eine Stadt ein, um sie hinzuzufügen.',
        weatherLoading: 'Lade…',
        weatherRefresh: 'Aktualisieren',
        weatherRemove: 'Entfernen',
        weatherRequestFailed: 'Wetterabruf fehlgeschlagen',
        weatherNoData: 'Keine Daten verfügbar',
        weatherUnableToLoad: 'Laden nicht möglich',
        weatherLookingUp: 'Suche nach Stadt…',
        weatherLookupFailed: 'Wetterabfrage fehlgeschlagen. Versuche es später erneut.',
        weatherNoMatch: 'Keine passenden Orte gefunden.',
        weatherAdded: '{location} hinzugefügt',
        weatherWind: 'Wind {speed} km/h',
        weatherUpdated: 'Aktualisiert {time}',
        weatherLocationFallback: 'Ort',
        weatherConditionsFallback: 'Bedingungen',
        nameDefault: 'Du',
        nameWithValue: 'Du · {name}',
        weatherApiLanguage: 'de'
    },
    zh: {
        brandTitle: '协同编辑器',
        brandSubtitle: '实时一起写作',
        userLabel: '你',
        displayNameLabel: '显示名称',
        displayNamePlaceholder: '设置你的名字',
        workspaceNew: '新建',
        workspaceSave: '保存',
        workspaceDelete: '删除',
        weatherTitle: '天气',
        weatherAddLabel: '添加地点',
        weatherAddPlaceholder: '添加城市',
        weatherAddAction: '添加',
        weatherToggleLabel: '切换天气面板',
        settingsTitle: '设置',
        settingsSubtitle: '个性化你的工作区',
        settingsToggleLabel: '打开设置',
        settingsCloseLabel: '关闭设置',
        languageLabel: '语言',
        languageEnglish: 'English',
        languageGerman: 'Deutsch',
        languageChinese: '中文',
        statusWorkspace: '工作区',
        statusWords: '词数',
        statusLines: '行数',
        statusChars: '字符',
        documentTitle: '{workspace} · 协同编辑器',
        themeToggleLight: '切换到亮色模式',
        themeToggleDark: '切换到暗色模式',
        collaboratorFallback: '协作者',
        workspaceReady: '工作区已就绪',
        workspaceSwitching: '正在切换…',
        workspaceSwitchFailed: '无法切换工作区',
        workspaceSaving: '正在保存…',
        workspaceSaveFailed: '保存失败',
        workspaceSaved: '已保存',
        workspaceCreatePrompt: '新工作区名称',
        workspaceCreateEmpty: '必须填写工作区名称',
        workspaceCreateCopyPrompt: '从当前文档开始吗？',
        workspaceCreating: '正在创建…',
        workspaceCreateFailed: '无法创建工作区',
        workspaceOpenNew: '正在打开新工作区…',
        workspaceCreated: '工作区已创建',
        workspaceDeleteProtected: '无法删除主工作区',
        workspaceDeleteConfirm: '确定删除此工作区？此操作无法撤销。',
        workspaceDeleting: '正在删除…',
        workspaceDeleteFailed: '无法删除工作区',
        workspaceDeleted: '工作区已删除',
        workspaceSelectPlaceholder: '选择工作区…',
        workspaceSelectEmpty: '尚未保存工作区',
        workspaceActiveIndicator: '当前',
        participantsLabel: '参与者',
        participantsEmpty: '暂无其他协作者',
        weatherPromptEmpty: '添加城市以查看天气。',
        weatherPromptEnter: '输入城市名称以添加。',
        weatherLoading: '加载中…',
        weatherRefresh: '刷新',
        weatherRemove: '移除',
        weatherRequestFailed: '天气请求失败',
        weatherNoData: '暂无数据',
        weatherUnableToLoad: '无法加载',
        weatherLookingUp: '正在查找城市…',
        weatherLookupFailed: '天气查询失败，请稍后再试。',
        weatherNoMatch: '未找到匹配的地点。',
        weatherAdded: '已添加 {location}',
        weatherWind: '风速 {speed} 公里/小时',
        weatherUpdated: '{time} 更新',
        weatherLocationFallback: '地点',
        weatherConditionsFallback: '天气',
        nameDefault: '你',
        nameWithValue: '你 · {name}',
        weatherApiLanguage: 'zh'
    }
};

const WEATHER_CODE_MAP = {
    en: {
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
    },
    de: {
        0: 'Klarer Himmel',
        1: 'Überwiegend klar',
        2: 'Teilweise bewölkt',
        3: 'Bedeckt',
        45: 'Nebel',
        48: 'Raureifnebel',
        51: 'Leichter Nieselregen',
        53: 'Nieselregen',
        55: 'Starker Nieselregen',
        56: 'Gefrierender Nieselregen',
        57: 'Gefrierender Nieselregen',
        61: 'Leichter Regen',
        63: 'Regen',
        65: 'Starker Regen',
        66: 'Gefrierender Regen',
        67: 'Gefrierender Regen',
        71: 'Leichter Schneefall',
        73: 'Schneefall',
        75: 'Starker Schneefall',
        77: 'Schneegriesel',
        80: 'Regenschauer',
        81: 'Regenschauer',
        82: 'Heftige Regenschauer',
        85: 'Schneeschauer',
        86: 'Starke Schneeschauer',
        95: 'Gewitter',
        96: 'Gewitter mit Hagel',
        99: 'Gewitter mit Hagel'
    },
    zh: {
        0: '晴朗',
        1: '多云转晴',
        2: '局部多云',
        3: '阴天',
        45: '雾',
        48: '霜雾',
        51: '小毛雨',
        53: '毛毛雨',
        55: '大毛雨',
        56: '冻毛雨',
        57: '冻毛雨',
        61: '小雨',
        63: '中雨',
        65: '大雨',
        66: '冻雨',
        67: '冻雨',
        71: '小雪',
        73: '中雪',
        75: '大雪',
        77: '霰',
        80: '阵雨',
        81: '阵雨',
        82: '暴雨',
        85: '阵雪',
        86: '大阵雪',
        95: '雷暴',
        96: '雷暴伴冰雹',
        99: '雷暴伴冰雹'
    }
};

function dictFor(language) {
    return translations[language] || translations[FALLBACK_LANGUAGE];
}

function t(key, vars = {}) {
    const dict = dictFor(currentLanguage);
    const fallback = dictFor(FALLBACK_LANGUAGE);
    let template = dict[key];
    if (template === undefined) {
        template = fallback[key] ?? key;
    }
    if (typeof template !== 'string') {
        return template;
    }
    return template.replace(/\{(\w+)\}/g, (match, token) => {
        if (Object.prototype.hasOwnProperty.call(vars, token)) {
            return vars[token];
        }
        return match;
    });
}

function applyTranslations() {
    const nodes = document.querySelectorAll('[data-i18n-key]');
    nodes.forEach(node => {
        const key = node.dataset.i18nKey;
        if (!key) return;
        const attr = node.dataset.i18nAttr;
        const value = t(key);
        if (attr) {
            node.setAttribute(attr, value);
        } else {
            node.textContent = value;
        }
    });
    updateThemeToggle(docEl.dataset.theme === 'light' ? 'light' : 'dark');
    updateParticipants(lastPresence);
    renderWeatherLocations();
    updateWorkspaceStatus();
    populateWorkspaceSelect(workspaceList, workspaceId);
}

function setLanguage(language) {
    const normalized = translations[language] ? language : FALLBACK_LANGUAGE;
    currentLanguage = normalized;
    document.documentElement.lang = normalized;
    if (languageSelect) {
        languageSelect.value = normalized;
    }
    try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    } catch (err) {
        // ignore storage issues
    }
    applyTranslations();
}

function initLanguage() {
    let preferred = FALLBACK_LANGUAGE;
    try {
        const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (stored && translations[stored]) {
            preferred = stored;
        }
    } catch (err) {
        preferred = FALLBACK_LANGUAGE;
    }
    setLanguage(preferred);
}

function openSettings() {
    if (settingsPanel) {
        settingsPanel.removeAttribute('hidden');
    }
    if (settingsToggle) {
        settingsToggle.setAttribute('aria-expanded', 'true');
    }
}

function closeSettings() {
    if (settingsPanel) {
        settingsPanel.setAttribute('hidden', '');
    }
    if (settingsToggle) {
        settingsToggle.setAttribute('aria-expanded', 'false');
    }
}

const ro = new ResizeObserver(() => {
    if (wrapper) {
        meas.style.width = ov.clientWidth + 'px';
    }
});
if (wrapper) {
    ro.observe(wrapper);
}

initLanguage();

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
        if (!next) {
            populateWorkspaceSelect(workspaceList, workspaceId);
            return;
        }
        selectWorkspace(next);
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
                showWeatherMessage(t('weatherPromptEmpty'));
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
            showWeatherMessage(t('weatherPromptEnter'), 'error');
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

if (settingsToggle && settingsPanel) {
    settingsToggle.addEventListener('click', () => {
        const hidden = settingsPanel.hasAttribute('hidden');
        if (hidden) {
            openSettings();
        } else {
            closeSettings();
        }
    });
}

if (settingsClose) {
    settingsClose.addEventListener('click', () => {
        closeSettings();
    });
}

if (languageSelect) {
    languageSelect.addEventListener('change', event => {
        setLanguage(event.target.value);
    });
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && settingsPanel && !settingsPanel.hasAttribute('hidden')) {
        closeSettings();
    }
});

document.addEventListener('click', event => {
    if (!settingsPanel || settingsPanel.hasAttribute('hidden')) return;
    if (settingsPanel.contains(event.target)) return;
    if (settingsToggle && settingsToggle.contains(event.target)) return;
    closeSettings();
});

if (wrapper) {
    wrapper.addEventListener('pointermove', handleCursorHover);
    wrapper.addEventListener('pointerleave', () => hideCursorTooltip());
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
    workspaceVersion = Number.isFinite(Number(data.version))
        ? Number(data.version)
        : Number.isFinite(Number(data.workspace?.version))
            ? Number(data.workspace.version)
            : 0;
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
    segments = normalizeSegments(data.segments || []);
    meas.textContent = text;
    peers = {};
    updateParticipants(data.users || []);
    updateGutter();
    renderSegments();
    drawCurs();
    updateStatusBar();
    scheduleCursorBroadcast(true);
});

socket.on('sync', data => {
    const incomingVersion = Number(data.version);
    if (Number.isFinite(incomingVersion)) {
        if (incomingVersion < workspaceVersion) {
            return;
        }
        workspaceVersion = incomingVersion;
    } else {
        workspaceVersion += 1;
    }

    const isSelf = data.from === myId;
    const incomingSegments = data.segments || [];

    if (isSelf) {
        segments = normalizeSegments(incomingSegments);
        meas.textContent = ed.value;
        lastText = ed.value;
        updateGutter();
        renderSegments();
        drawCurs();
        updateStatusBar();
        return;
    }

    const hadFocus = document.activeElement === ed;
    const prevText = ed.value;
    const prevSelStart = ed.selectionStart;
    const prevSelEnd = ed.selectionEnd;
    const selectionDirection = ed.selectionDirection;
    const prevScrollTop = ed.scrollTop;
    const prevScrollLeft = ed.scrollLeft;

    // Compare the text we currently display with what the server sent. The
    // derived range tells us exactly which slice changed in our view so we can
    // keep the local caret anchored even if multiple edits raced on the server.
    const incomingText = typeof data.text === 'string' ? data.text : '';
    const changeForView = computeTextDiff(prevText, incomingText);

    ed.value = incomingText;
    lastText = incomingText;
    segments = normalizeSegments(incomingSegments);
    meas.textContent = ed.value;

    if (hadFocus) {
        let nextStart = prevSelStart;
        let nextEnd = prevSelEnd;
        const change = changeForView || data.change;
        if (change) {
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

    if (changeForView) {
        // Re-base stored collaborator cursor positions against the same change
        // description we used for the local caret so everyone stays aligned.
        adjustPeerPositions(changeForView, data.from);
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
    const reportedVersion = Number(data.version);
    if (Number.isFinite(reportedVersion)) {
        workspaceVersion = reportedVersion;
    } else if (Number.isFinite(Number(data.workspace?.version))) {
        workspaceVersion = Number(data.workspace.version);
    } else {
        workspaceVersion = 0;
    }
    populateWorkspaceSelect(workspaceList, workspaceId);
    updateWorkspaceStatus();

    peers = {};
    updateParticipants(data.users || []);

    const text = data.text ?? '';
    const hadFocus = document.activeElement === ed;
    ed.value = text;
    lastText = text;
    segments = normalizeSegments(data.segments || []);
    meas.textContent = text;
    if (hadFocus) {
        const pos = Math.min(ed.value.length, ed.selectionStart);
        ed.setSelectionRange(pos, pos);
    }
    updateGutter();
    renderSegments();
    drawCurs();
    updateStatusBar();
    scheduleCursorBroadcast(true);
    setWorkspaceBusy(false);
    showWorkspaceNote(t('workspaceReady'), 'success');
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

    // Send the full text together with a compact range describing what changed
    // so the server can update other collaborators efficiently.
    socket.emit('edit', { text: txt, range: { s, e: newE } });

    applyLocalSegmentsEdit(s, oldE, newE);
    lastText = txt;
    meas.textContent = txt;
    updateGutter();
    renderSegments();
    drawCurs();
    updateStatusBar();
    scheduleCursorBroadcast();
});

const CURSOR_NAV_KEYS = new Set([
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'PageUp',
    'PageDown'
]);

if (ed) {
    ed.addEventListener('focus', () => scheduleCursorBroadcast(true));
    ed.addEventListener('blur', () => {
        lastSentCursorPos = null;
        hideCursorTooltip();
        if (cursorEmitTimer) {
            clearTimeout(cursorEmitTimer);
            cursorEmitTimer = null;
        }
    });
    ed.addEventListener('mouseup', () => {
        setTimeout(() => scheduleCursorBroadcast(true), 0);
    });
    ed.addEventListener('touchend', () => {
        setTimeout(() => scheduleCursorBroadcast(true), 0);
    });
    ed.addEventListener('keyup', event => {
        if (event.key === 'Backspace' || event.key === 'Delete') {
            scheduleCursorBroadcast();
        }
    });
    ed.addEventListener('keydown', event => {
        if (CURSOR_NAV_KEYS.has(event.key)) {
            requestAnimationFrame(() => scheduleCursorBroadcast());
        }
    });
}

document.addEventListener('selectionchange', () => {
    if (document.activeElement === ed) {
        scheduleCursorBroadcast();
    }
});

ed.addEventListener('scroll', () => {
    gut.style.transform = 'translateY(-' + ed.scrollTop + 'px)';
    ov.scrollTop = ed.scrollTop;
    ov.scrollLeft = ed.scrollLeft;
    drawCurs();
    hideCursorTooltip();
});

function updateGutter() {
    const n = ed.value.split('\n').length;
    gut.innerHTML = Array.from({ length: n }, (_, i) => i + 1).join('\n');
}

function normalizeSegments(list = []) {
    if (!Array.isArray(list) || !list.length) return [];
    const textLength = ed ? ed.value.length : 0;
    const sanitized = list
        .map(seg => {
            if (!seg) return null;
            const rawStart = Number(seg.start);
            const rawEnd = Number(seg.end);
            const start = Number.isFinite(rawStart) ? rawStart : 0;
            const end = Number.isFinite(rawEnd) ? rawEnd : start;
            const safeStart = Math.max(0, Math.min(textLength, Math.min(start, end)));
            const safeEnd = Math.max(0, Math.min(textLength, Math.max(start, end)));
            if (safeEnd <= safeStart) return null;
            const color = typeof seg.color === 'string' && seg.color.trim() ? seg.color : '#3b82f6';
            return { start: safeStart, end: safeEnd, color };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.start === b.start) {
                return a.end - b.end;
            }
            return a.start - b.start;
        });

    const merged = [];
    for (const seg of sanitized) {
        const last = merged[merged.length - 1];
        if (last && seg.start <= last.end) {
            if (last.color === seg.color) {
                last.end = Math.max(last.end, seg.end);
            } else {
                const clippedStart = Math.max(last.end, seg.start);
                if (clippedStart < seg.end) {
                    merged.push({ start: clippedStart, end: seg.end, color: seg.color });
                }
            }
        } else {
            merged.push({ ...seg });
        }
    }
    return merged;
}

function applyLocalSegmentsEdit(start, oldEnd, newEnd) {
    if (!Number.isFinite(start) || !Number.isFinite(oldEnd) || !Number.isFinite(newEnd)) {
        return;
    }
    let safeStart = Math.max(0, Math.floor(start));
    let safeOldEnd = Math.max(safeStart, Math.floor(oldEnd));
    let safeNewEnd = Math.max(safeStart, Math.floor(newEnd));
    const current = normalizeSegments(segments);
    const newLen = safeNewEnd - safeStart;
    const shift = newLen - (safeOldEnd - safeStart);
    const next = [];

    for (const seg of current) {
        if (seg.end <= safeStart) {
            next.push({ ...seg });
        } else if (seg.start >= safeOldEnd) {
            next.push({
                start: seg.start + shift,
                end: seg.end + shift,
                color: seg.color
            });
        } else if (seg.start >= safeStart && seg.end <= safeOldEnd) {
            continue;
        } else {
            const newStart = seg.start < safeStart ? seg.start : safeStart;
            const newSegEnd = seg.end > safeOldEnd ? seg.end : safeOldEnd;
            const adjustedEnd = newSegEnd + shift;
            if (adjustedEnd > newStart) {
                next.push({ start: newStart, end: adjustedEnd, color: seg.color });
            }
        }
    }

    if (safeNewEnd > safeStart) {
        next.push({ start: safeStart, end: safeNewEnd, color: myCol });
    }

    segments = normalizeSegments(next);
}

function renderSegments() {
    segments = normalizeSegments(segments);
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
    if (!curs) return;
    curs.innerHTML = '';
    hideCursorTooltip();

    let caretHeight = 18;
    if (ed && typeof window !== 'undefined') {
        try {
            const computed = window.getComputedStyle(ed);
            const lh = parseFloat(computed.lineHeight);
            if (!Number.isNaN(lh)) {
                caretHeight = lh;
            } else {
                const fs = parseFloat(computed.fontSize);
                if (!Number.isNaN(fs)) {
                    caretHeight = fs * 1.4;
                }
            }
        } catch (err) {
            // Fallback to default caret height
        }
    }

    for (const id in peers) {
        const peer = peers[id];
        if (!peer) continue;
        const xy = caretClientXY(peer.pos);
        const cursor = document.createElement('div');
        cursor.className = 'remote-cursor';
        cursor.style.background = peer.col;
        cursor.style.left = xy.x + 'px';
        cursor.style.top = xy.y + 'px';
        cursor.style.height = caretHeight + 'px';
        cursor.dataset.name = peer.name || '';
        cursor.dataset.peerId = id;
        cursor.title = peer.name || '';
        curs.appendChild(cursor);
    }
}

function hideCursorTooltip() {
    if (!cursorTooltip) return;
    cursorTooltip.classList.remove('visible');
    activeTooltipPeer = null;
}

function positionCursorTooltip(name, rect) {
    if (!cursorTooltip || !wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2 - wrapperRect.left;
    const top = rect.top - wrapperRect.top;
    if (cursorTooltip.textContent !== name) {
        cursorTooltip.textContent = name;
    }
    cursorTooltip.style.left = centerX + 'px';
    cursorTooltip.style.top = top + 'px';
    cursorTooltip.classList.add('visible');
}

function handleCursorHover(event) {
    if (!cursorTooltip || !wrapper || !curs) return;
    const { clientX, clientY } = event;
    const marginX = CURSOR_TOOLTIP_MARGIN_X;
    const marginY = CURSOR_TOOLTIP_MARGIN_Y;

    let matched = null;
    let matchedId = null;
    for (const cursorEl of curs.children) {
        const name = (cursorEl.dataset.name || '').trim();
        if (!name) continue;
        const rect = cursorEl.getBoundingClientRect();
        if (
            clientX >= rect.left - marginX &&
            clientX <= rect.right + marginX &&
            clientY >= rect.top - marginY &&
            clientY <= rect.bottom + marginY
        ) {
            matched = { name, rect };
            matchedId = cursorEl.dataset.peerId || null;
            break;
        }
    }

    if (matched) {
        if (activeTooltipPeer !== matchedId) {
            activeTooltipPeer = matchedId;
        }
        positionCursorTooltip(matched.name, matched.rect);
    } else {
        hideCursorTooltip();
    }
}

function emitCursorPosition() {
    if (!ed) return;
    cursorEmitTimer = null;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const pos = typeof ed.selectionStart === 'number' ? ed.selectionStart : 0;
    lastCursorEmit = now;
    if (lastSentCursorPos === pos) {
        return;
    }
    lastSentCursorPos = pos;
    socket.emit('cur', { pos });
}

function scheduleCursorBroadcast(force = false) {
    if (!ed) return;
    if (force) {
        lastCursorEmit = 0;
        lastSentCursorPos = null;
        if (cursorEmitTimer) {
            clearTimeout(cursorEmitTimer);
            cursorEmitTimer = null;
        }
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = now - lastCursorEmit;
    if (force || elapsed >= CURSOR_THROTTLE_MS) {
        emitCursorPosition();
    } else {
        if (cursorEmitTimer) {
            clearTimeout(cursorEmitTimer);
        }
        cursorEmitTimer = setTimeout(emitCursorPosition, CURSOR_THROTTLE_MS - elapsed);
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
    const key = theme === 'dark' ? 'themeToggleLight' : 'themeToggleDark';
    themeToggle.setAttribute('aria-label', t(key));
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
        userLabel.textContent = name ? t('nameWithValue', { name }) : t('nameDefault');
    }
}

function updateParticipants(list) {
    if (!Array.isArray(list)) list = [];
    lastPresence = list;

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
            name: user.name ?? existing.name ?? t('collaboratorFallback')
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
        const label = document.createElement('span');
        label.className = 'participants-label';
        label.textContent = t('participantsLabel');
        participants.appendChild(label);

        let visibleCount = 0;
        for (const user of list) {
            if (!user || user.id === myId) continue;
            visibleCount++;
            const item = document.createElement('span');
            item.className = 'participant';
            item.style.setProperty('--participant-color', user.color || '#6b7280');
            item.textContent = user.name || t('collaboratorFallback');
            participants.appendChild(item);
        }

        if (!visibleCount) {
            const placeholder = document.createElement('span');
            placeholder.className = 'participants-empty';
            placeholder.textContent = t('participantsEmpty');
            participants.appendChild(placeholder);
        }
        participants.dataset.count = String(visibleCount);
    }

    drawCurs();
}

function adjustPeerPositions(change, authorId) {
    // Shift all cached collaborator cursor positions so they remain attached to
    // the same logical text even after edits that happened before reaching us.
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
    const entries = Array.isArray(list) ? list.filter(ws => ws && ws.id) : [];
    const sorted = entries
        .slice()
        .sort((a, b) => {
            const labelA = (a.name || a.id || '').toString();
            const labelB = (b.name || b.id || '').toString();
            return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
        });

    workspaceSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.textContent = sorted.length ? t('workspaceSelectPlaceholder') : t('workspaceSelectEmpty');
    workspaceSelect.appendChild(placeholder);

    let hasActive = false;
    for (const ws of sorted) {
        const option = document.createElement('option');
        option.value = ws.id;
        const label = ws.name || ws.id;
        option.dataset.label = label;
        option.textContent = label;
        if (ws.id === active) {
            hasActive = true;
            option.selected = true;
            option.textContent = `${label} · ${t('workspaceActiveIndicator')}`;
        }
        workspaceSelect.appendChild(option);
    }

    placeholder.selected = !hasActive;
    workspaceSelect.dataset.hasActive = hasActive ? 'true' : 'false';
    if (hasActive) {
        workspaceSelect.value = active;
    } else {
        workspaceSelect.value = '';
    }
}

function setWorkspaceBusy(state) {
    workspaceBusy = state;
    const controls = [workspaceSelect, workspaceNewBtn, workspaceSaveBtn, workspaceDeleteBtn];
    controls.forEach(ctrl => {
        if (ctrl) ctrl.disabled = state;
    });
    if (workspaceControls) {
        workspaceControls.setAttribute('data-busy', state ? 'true' : 'false');
    }
    if (workspaceSelect) {
        workspaceSelect.setAttribute('aria-busy', state ? 'true' : 'false');
    }
}

function updateWorkspaceStatus(note, tone) {
    if (workspaceNameEl) {
        workspaceNameEl.textContent = workspaceLabel;
    }
    document.title = t('documentTitle', { workspace: workspaceLabel });
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
            throw new Error(payload.error || t('workspaceSwitchFailed'));
        }
        showWorkspaceNote(t('workspaceSwitching'));
        socket.emit('switch_workspace', { workspace: nextId });
    } catch (err) {
        console.error(err);
        showWorkspaceNote(err.message || t('workspaceSwitchFailed'), 'error');
        setWorkspaceBusy(false);
        populateWorkspaceSelect(workspaceList, workspaceId);
    }
}

async function saveWorkspace() {
    if (workspaceBusy) return;
    setWorkspaceBusy(true);
    showWorkspaceNote(t('workspaceSaving'));
    try {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ text: ed.value, segments })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload.error || t('workspaceSaveFailed'));
        }
        const updated = payload.workspace || {};
        if (updated.name) {
            workspaceLabel = updated.name;
        }
        workspaceList = Array.isArray(payload.workspaces) ? payload.workspaces : workspaceList;
        populateWorkspaceSelect(workspaceList, workspaceId);
        updateWorkspaceStatus(t('workspaceSaved'), 'success');
    } catch (err) {
        console.error(err);
        showWorkspaceNote(err.message || t('workspaceSaveFailed'), 'error');
    } finally {
        setWorkspaceBusy(false);
    }
}

async function createWorkspace() {
    if (workspaceBusy) return;
    const name = prompt(t('workspaceCreatePrompt'), '');
    if (name === null) return;
    const cleaned = name.trim().slice(0, 48);
    if (!cleaned) {
        showWorkspaceNote(t('workspaceCreateEmpty'), 'error');
        return;
    }
    const copy = confirm(t('workspaceCreateCopyPrompt'));
    setWorkspaceBusy(true);
    showWorkspaceNote(t('workspaceCreating'));
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
            throw new Error(data.error || t('workspaceCreateFailed'));
        }
        workspaceList = Array.isArray(data.workspaces) ? data.workspaces : workspaceList;
        populateWorkspaceSelect(workspaceList, workspaceId);
        setWorkspaceBusy(false);
        const created = data.workspace || {};
        if (created.id) {
            showWorkspaceNote(t('workspaceOpenNew'));
            selectWorkspace(created.id);
        } else {
            showWorkspaceNote(t('workspaceCreated'), 'success');
        }
    } catch (err) {
        setWorkspaceBusy(false);
        console.error(err);
        showWorkspaceNote(err.message || t('workspaceCreateFailed'), 'error');
    }
}

async function deleteWorkspace() {
    if (workspaceBusy) return;
    const target = workspaceSelect ? workspaceSelect.value : workspaceId;
    if (!target) return;
    if (target === 'main') {
        showWorkspaceNote(t('workspaceDeleteProtected'), 'error');
        return;
    }
    const confirmed = confirm(t('workspaceDeleteConfirm'));
    if (!confirmed) return;
    setWorkspaceBusy(true);
    showWorkspaceNote(t('workspaceDeleting'));
    try {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(target)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || t('workspaceDeleteFailed'));
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
            showWorkspaceNote(t('workspaceDeleted'), 'success');
        }
    } catch (err) {
        setWorkspaceBusy(false);
        console.error(err);
        showWorkspaceNote(err.message || t('workspaceDeleteFailed'), 'error');
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
                longitude: Number(loc.longitude)
            }))
            .filter(loc => !Number.isNaN(loc.latitude) && !Number.isNaN(loc.longitude))
            .map(loc => ({ ...loc, label: buildWeatherLabel(loc) }));
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
            label: buildWeatherLabel(loc)
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
        showWeatherMessage(t('weatherPromptEmpty'));
        return;
    }
    showWeatherMessage('');
    for (const location of weatherLocations) {
        const label = buildWeatherLabel(location);
        location.label = label;
        const item = document.createElement('li');
        item.className = 'weather-item';
        item.dataset.id = location.id;

        const meta = document.createElement('div');
        meta.className = 'weather-meta';
        const title = document.createElement('span');
        title.className = 'weather-title';
        title.textContent = label;
        const details = document.createElement('span');
        details.className = 'weather-details';
        details.textContent = t('weatherLoading');
        meta.appendChild(title);
        meta.appendChild(details);

        const actions = document.createElement('div');
        actions.className = 'weather-actions';
        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'weather-refresh';
        refreshBtn.textContent = t('weatherRefresh');
        refreshBtn.addEventListener('click', () => {
            updateWeatherItem(location, details, item);
        });
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'weather-remove';
        removeBtn.textContent = t('weatherRemove');
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
    detailsEl.textContent = t('weatherLoading');
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current_weather=true&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(t('weatherRequestFailed'));
        }
        const data = await res.json();
        const current = data.current_weather;
        if (!current) {
            detailsEl.textContent = t('weatherNoData');
            return;
        }
        const temp = Math.round(current.temperature);
        const wind = Math.round(current.windspeed);
        const desc = describeWeather(current.weathercode);
        const timeText = formatWeatherTime(current.time);
        const parts = [`${temp}°C`, desc];
        if (!Number.isNaN(wind)) {
            parts.push(t('weatherWind', { speed: wind }));
        }
        if (timeText) parts.push(timeText);
        detailsEl.textContent = parts.join(' • ');
    } catch (err) {
        console.error(err);
        detailsEl.textContent = t('weatherUnableToLoad');
        itemEl?.classList.add('error');
    }
}

async function addWeatherLocation(query) {
    showWeatherMessage(t('weatherLookingUp'));
    try {
        const lang = dictFor(currentLanguage).weatherApiLanguage || 'en';
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=${lang}&format=json`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error('Lookup failed');
        }
        const data = await res.json();
        if (!data.results || !data.results.length) {
            showWeatherMessage(t('weatherNoMatch'), 'error');
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
        showWeatherMessage(t('weatherAdded', { location: location.label }), 'success');
        renderWeatherLocations();
    } catch (err) {
        console.error(err);
        showWeatherMessage(t('weatherLookupFailed'), 'error');
    }
}

function removeWeatherLocation(id) {
    weatherLocations = weatherLocations.filter(loc => loc.id !== id);
    saveWeatherLocations();
    renderWeatherLocations();
    if (!weatherLocations.length) {
        showWeatherMessage(t('weatherPromptEmpty'));
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
    const dict = WEATHER_CODE_MAP[currentLanguage] || WEATHER_CODE_MAP[FALLBACK_LANGUAGE] || {};
    const fallback = WEATHER_CODE_MAP[FALLBACK_LANGUAGE] || {};
    return dict[code] || fallback[code] || t('weatherConditionsFallback');
}

function formatWeatherTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return t('weatherUpdated', { time });
}

function buildWeatherLabel(loc) {
    if (!loc) return '';
    const name = loc.name || t('weatherLocationFallback');
    const country = loc.country ? `, ${loc.country}` : '';
    return `${name}${country}`;
}
