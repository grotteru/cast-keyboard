/**
 * Cast Keyboard v1.0.0
 * On-screen keyboard for Home Assistant dashboards on devices without a usable
 * keyboard (Nest Hub / Google Cast).
 * https://github.com/grotteru/cast-keyboard   (License: MIT)
 *
 * - Shows automatically when a text field is tapped on Google Cast ("CrKey" in the userAgent).
 * - Works inside dialogs and popovers (e.g. "Add event" in calendar cards).
 * - Light or dark keyboard, following the Home Assistant theme.
 * - Language follows the Home Assistant user language (en, nb, da, sv, fi, de, nl,
 *   fr, es, it, pt, pl, ru). Unsupported languages fall back to English.
 *
 * Optional overrides:
 *   Dashboard URL:  ?osk=1 (force on, for testing on PC/mobile), ?osk=0 (off),
 *                   ?osklang=de (language), ?osktheme=light|dark (force a theme),
 *                   ?oskdebug=1 (log to the console)
 *   Resource URL:   .../cast-keyboard.js?lang=de  and/or  ?force=1
 */
(() => {
  if (window.__castKeyboardLoaded) return;
  window.__castKeyboardLoaded = true;

  const params = new URLSearchParams(location.search);
  let resParams = new URLSearchParams();
  try { resParams = new URL(import.meta.url).searchParams; } catch (_) { /* ignore */ }

  const oskParam = params.get("osk");
  const enabled =
    oskParam === "0" ? false :
    oskParam === "1" || resParams.get("force") === "1" || /CrKey/i.test(navigator.userAgent);
  if (!enabled) return;
  const DEBUG = params.get("oskdebug") === "1";
  const log = (...a) => DEBUG && console.info("[cast-keyboard]", ...a);

  // ---------- Layouts ----------
  // r2/r3/r4 = letter rows (r4 gets SHIFT and BACK around it), extra = optional row of accented characters.
  const LANGS = {
    en: { done: "Done",      r2: "qwertyuiop",  r3: "asdfghjkl",   r4: "zxcvbnm" },
    nb: { done: "Ferdig",    r2: "qwertyuiopå", r3: "asdfghjkløæ", r4: "zxcvbnm" },
    da: { done: "Færdig",    r2: "qwertyuiopå", r3: "asdfghjklæø", r4: "zxcvbnm" },
    sv: { done: "Klar",      r2: "qwertyuiopå", r3: "asdfghjklöä", r4: "zxcvbnm" },
    fi: { done: "Valmis",    r2: "qwertyuiopå", r3: "asdfghjklöä", r4: "zxcvbnm" },
    de: { done: "Fertig",    r2: "qwertzuiopü", r3: "asdfghjklöä", r4: "yxcvbnmß" },
    nl: { done: "Klaar",     r2: "qwertyuiop",  r3: "asdfghjkl",   r4: "zxcvbnm", extra: "éëïöüáó" },
    fr: { done: "OK",        r2: "azertyuiop",  r3: "qsdfghjklm",  r4: "wxcvbn",  extra: "éèêàùçôîâû" },
    es: { done: "Hecho",     r2: "qwertyuiop",  r3: "asdfghjklñ",  r4: "zxcvbnm", extra: "áéíóúü¿¡" },
    it: { done: "Fine",      r2: "qwertyuiop",  r3: "asdfghjkl",   r4: "zxcvbnm", extra: "àèéìòù" },
    pt: { done: "Concluído", r2: "qwertyuiop",  r3: "asdfghjklç",  r4: "zxcvbnm", extra: "áàâãéêíóôõú" },
    pl: { done: "Gotowe",    r2: "qwertyuiop",  r3: "asdfghjkl",   r4: "zxcvbnm", extra: "ąćęłńóśźż" },
    ru: { done: "Готово",    r2: "йцукенгшщзхъ", r3: "фывапролджэ", r4: "ячсмитьбю" },
  };
  const ALIASES = { no: "nb", nn: "nb" };
  const normalize = (c) => {
    c = String(c || "").toLowerCase().split(/[-_]/)[0];
    c = ALIASES[c] || c;
    return LANGS[c] ? c : null;
  };
  // Order: ?osklang on the dashboard URL, ?lang on the resource URL, the Home Assistant
  // user language, the browser language, English.
  function currentLang() {
    const ha = document.querySelector("home-assistant");
    return normalize(params.get("osklang")) || normalize(resParams.get("lang")) ||
           normalize(ha && ha.hass && ha.hass.language) || normalize(navigator.language) || "en";
  }

  const NUMBERS = "1234567890".split("");
  const BOTTOM = ["MODE", "-", ",", "SPACE", ".", "@", "DONE"];
  const SYMBOLS = [
    NUMBERS,
    ["!","?","#","%","&","/","(",")","=","+"],
    ["*",":",";","'","\"","_","€","$","£"],
    ["<",">","{","}","[","]","\\","|","BACK"],
    BOTTOM,
  ];
  function lettersLayout(l) {
    return [
      NUMBERS,
      l.r2.split(""),
      l.r3.split(""),
      ["SHIFT", ...l.r4.split(""), "BACK"],
      ...(l.extra ? [l.extra.split("")] : []),
      BOTTOM,
    ];
  }
  const up = (k) => (k === "ß" ? "ẞ" : k.toUpperCase());

  // The Nest Hub font lacks ⇧ and ⌫ (shows an empty box), so they are drawn as SVG.
  const SVG = (d) =>
    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle">' + d + "</svg>";
  const ICONS = {
    SHIFT: SVG('<path d="M12 4l8 9h-5v6H9v-6H4z"/>'),
    BACK: SVG('<path d="M21 5H9l-6 7 6 7h12z"/><path d="M13 9.5l5 5M18 9.5l-5 5"/>'),
  };
  const FN_KEYS = ["SHIFT", "BACK", "MODE", "SPACE", "DONE"];

  let target = null;
  let lang = "en";
  let shift = false;
  let caps = false;
  let mode = "letters";
  let hideTimer = null;

  // ---------- Theme (light / dark) ----------
  const THEMES = {
    dark: {
      "--kb-bg": "#161618", "--kb-border": "#3a3a3c", "--kb-key": "#55555a",
      "--kb-key-active": "#85858c", "--kb-text": "#ffffff", "--kb-shadow": "none",
      "--kb-on-bg": "#f2f2f7", "--kb-on-text": "#000000",
    },
    light: {
      "--kb-bg": "#d3d5db", "--kb-border": "#b4b7bf", "--kb-key": "#ffffff",
      "--kb-key-active": "#bfc2ca", "--kb-text": "#1c1c1e", "--kb-shadow": "0 1px 0 rgba(0,0,0,.35)",
      "--kb-on-bg": "#1c1c1e", "--kb-on-text": "#ffffff",
    },
  };
  // Relative luminance (0 = black, 1 = white) of any CSS colour, or null if unknown.
  function luminance(color) {
    if (!color) return null;
    const probe = document.createElement("span");
    probe.style.color = color;
    if (!probe.style.color) return null;
    document.body.appendChild(probe);
    const m = getComputedStyle(probe).color.match(/[\d.]+/g);
    probe.remove();
    if (!m || m.length < 3) return null;
    const [r, g, b] = m.slice(0, 3).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  // 1) HA's own setting, 2) the background colour of the active HA theme,
  // 3) the device preference. ?osktheme=light|dark overrides all of these.
  function isDark() {
    const forced = params.get("osktheme");
    if (forced === "light" || forced === "dark") return forced === "dark";
    const ha = document.querySelector("home-assistant");
    const flag = ha && ha.hass && ha.hass.themes && ha.hass.themes.darkMode;
    if (typeof flag === "boolean") return flag;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--primary-background-color").trim();
    const lum = luminance(bg);
    if (lum !== null) return lum < 0.5;
    return !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function applyTheme() {
    const t = THEMES[isDark() ? "dark" : "light"];
    for (const k in t) host.style.setProperty(k, t[k]);
  }

  // ---------- UI ----------
  const host = document.createElement("div");
  host.setAttribute("data-cast-keyboard", "");
  host.style.cssText =
    "position:fixed;left:0;bottom:0;width:100vw;z-index:2147483000;display:none;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host{all:initial}
      .kb{background:var(--kb-bg);border-top:1px solid var(--kb-border);padding:6px 8px 8px;
          box-sizing:border-box;font-family:Roboto,system-ui,sans-serif;
          user-select:none;-webkit-user-select:none;touch-action:manipulation}
      .row{display:flex;gap:5px;margin-bottom:5px;justify-content:center}
      .row:last-child{margin-bottom:0}
      /* All keys share one colour; only Done (blue) and an active Shift differ. */
      button{flex:1 1 0;min-width:0;height:40px;border:0;border-radius:7px;
             background:var(--kb-key);background-image:none;color:var(--kb-text);font-size:19px;
             cursor:pointer;padding:0;font-family:inherit;box-shadow:var(--kb-shadow);
             text-shadow:none;opacity:1;filter:none;
             -webkit-appearance:none;appearance:none}
      button:active{background:var(--kb-key-active)}
      button.fn{flex:1.5 1 0;font-size:16px}
      button.space{flex:5 1 0}
      button.done{background:#0a84ff;color:#fff;flex:2 1 0;font-size:16px}
      button.done:active{background:#4aa3ff}
      button.on{background:var(--kb-on-bg);color:var(--kb-on-text)}
    </style>
    <div class="kb"></div>`;
  const kb = root.querySelector(".kb");
  document.body.appendChild(host);

  function render() {
    const l = LANGS[lang];
    kb.innerHTML = "";
    for (const row of mode === "letters" ? lettersLayout(l) : SYMBOLS) {
      const r = document.createElement("div");
      r.className = "row";
      for (const key of row) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.key = key;
        if (FN_KEYS.includes(key)) {
          b.className = key === "SPACE" ? "space" : key === "DONE" ? "done" : "fn";
          if (ICONS[key]) b.innerHTML = ICONS[key];
          else if (key === "MODE") b.textContent = mode === "symbols" ? "ABC" : "?123";
          else if (key === "DONE") b.textContent = l.done;
          else b.textContent = " ";
          if (key === "SHIFT" && (shift || caps)) b.classList.add("on");
        } else {
          b.textContent = mode === "letters" && (shift || caps) ? up(key) : key;
        }
        r.appendChild(b);
      }
      kb.appendChild(r);
    }
  }

  // ---------- Text insertion ----------
  function setValue(el, value, caret) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    try { el.setSelectionRange(caret, caret); } catch (_) { /* not supported on all types */ }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: null, inputType: "insertText" }));
  }
  const sel = () => {
    const v = target.value ?? "";
    return [v, target.selectionStart ?? v.length, target.selectionEnd ?? v.length];
  };
  function insert(text) {
    if (!target) return;
    const [v, s, e] = sel();
    setValue(target, v.slice(0, s) + text + v.slice(e), s + text.length);
  }
  function backspace() {
    if (!target) return;
    const [v, s, e] = sel();
    if (s !== e) return setValue(target, v.slice(0, s) + v.slice(e), s);
    if (s === 0) return;
    // Delete whole characters (including those made of two code units)
    const prev = [...v.slice(0, s)].slice(0, -1).join("");
    setValue(target, prev + v.slice(s), prev.length);
  }

  function press(key) {
    if (key === "SHIFT") {
      if (shift && !caps) caps = true; else { caps = false; shift = !shift; }
      return render();
    }
    if (key === "MODE") { mode = mode === "letters" ? "symbols" : "letters"; return render(); }
    if (key === "BACK") return backspace();
    if (key === "DONE") {
      target?.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      target?.blur();
      return hide();
    }
    insert(key === "SPACE" ? " " : (mode === "letters" && (shift || caps) ? up(key) : key));
    if (shift && !caps) { shift = false; render(); }
  }

  // Presses are handled on pointerdown (works for both mouse and touch on Cast),
  // and focus is kept in the field.
  host.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const b = e.composedPath().find((n) => n.dataset && n.dataset.key);
    if (b) {
      press(b.dataset.key);
      if (target && target.isConnected && getDeepActive() !== target) {
        target.focus({ preventScroll: true });
      }
    }
  });
  ["mousedown", "touchstart", "click", "pointerup", "mouseup", "touchend"].forEach((t) =>
    host.addEventListener(t, (e) => { e.stopPropagation(); if (t === "mousedown") e.preventDefault(); }, { passive: false })
  );

  // ---------- Placement ----------
  function getDeepActive() {
    let n = document.activeElement;
    while (n && n.shadowRoot && n.shadowRoot.activeElement) n = n.shadowRoot.activeElement;
    return n;
  }

  // Modal dialogs make everything outside themselves "inert", so the keyboard must
  // live inside the dialog/popover the field is in. Otherwise a general top level is used.
  function pickContainer(path) {
    const els = path.filter((n) => n instanceof Element);
    // 1) A real dialog / popover / dialog-like element
    const dlg = els.find(
      (n) =>
        n instanceof HTMLDialogElement ||
        n.getAttribute?.("role") === "dialog" ||
        n.getAttribute?.("aria-modal") === "true" ||
        /popover|dialog|modal/i.test(n.localName)
    );
    if (dlg) return dlg;
    // 2) Home Assistant: the element directly under home-assistant's shadow root
    const i = els.findIndex((n) => n.localName === "home-assistant");
    if (i > 0) return els[i - 1];
    // 3) Otherwise: body
    return document.body;
  }

  function mount(container) {
    const parent = container.shadowRoot || container;
    if (host.parentNode !== parent) parent.appendChild(host);
    log("container:", container.localName, container);
  }

  function place() {
    // If an ancestor has a transform/filter, "fixed" becomes relative to it.
    // Correct for that so the keyboard always sits at the bottom of the window.
    host.style.transform = "";
    const r = host.getBoundingClientRect();
    const dx = -r.left;
    const dy = window.innerHeight - r.bottom;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      host.style.transform = `translate(${dx}px, ${dy}px)`;
      log("corrected position", dx, dy);
    }
  }

  // ---------- Show / hide ----------
  const TEXT_TYPES = ["text", "search", "email", "url", "tel", "password", ""];
  // readOnly is set temporarily to prevent the device's own keyboard;
  // data-osk-ro marks that it was us who did it.
  const ro = (el) => el.readOnly && !el.dataset.oskRo;
  function isTextField(el) {
    if (el instanceof HTMLTextAreaElement) return !ro(el) && !el.disabled;
    return el instanceof HTMLInputElement && TEXT_TYPES.includes(el.type) && !ro(el) && !el.disabled;
  }
  function lock(el) {
    if (!el.readOnly) { el.dataset.oskRo = "1"; el.readOnly = true; }
  }
  function unlock(el) {
    if (el && el.dataset && el.dataset.oskRo) { delete el.dataset.oskRo; el.readOnly = false; }
  }

  function show(el, path) {
    clearTimeout(hideTimer);
    const first = target !== el;
    if (first) unlock(target);
    target = el;
    lock(el);
    if (first) { shift = !el.value; caps = false; mode = "letters"; lang = currentLang(); }
    mount(pickContainer(path));
    applyTheme();
    render();
    host.style.display = "block";
    requestAnimationFrame(() => {
      place();
      const kbTop = host.getBoundingClientRect().top;
      if (el.getBoundingClientRect().bottom > kbTop - 8) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  }

  function hide() {
    host.style.display = "none";
    unlock(target);
    target = null;
  }

  document.addEventListener("focusin", (e) => {
    const path = e.composedPath();
    const el = path[0];
    if (el && isTextField(el)) {
      el.setAttribute("inputmode", "none"); // no built-in keyboard
      show(el, path);
    }
  }, true);

  // On Cast the tap reaches the field (pointerdown), but focus doesn't always
  // land in it. So the keyboard is shown on the tap itself.
  let lastFieldTap = 0;
  document.addEventListener("pointerdown", (e) => {
    const path = e.composedPath();
    if (path.includes(host)) return;            // tap on the keyboard
    const el = path[0];
    if (el && isTextField(el)) {
      lastFieldTap = Date.now();
      el.setAttribute("inputmode", "none");
      show(el, path);
      try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      if (getDeepActive() !== el) {
        try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) { /* ignore */ }
      }
    } else if (target) {
      hide();                                   // tap somewhere else
    }
  }, true);

  document.addEventListener("focusout", () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (Date.now() - lastFieldTap < 1000) return; // just tapped in a field
      const a = getDeepActive();
      if (!a || !isTextField(a)) hide();
    }, 200);
  }, true);

  // The popover can close without us getting a focusout: clean up if the field is gone.
  setInterval(() => {
    if (target && !target.isConnected) hide();
  }, 500);
})();
