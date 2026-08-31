/* ampersand code — a VS Code–style web editor
 * Everything runs client-side: files live in this browser's localStorage.
 * Monaco (the same editor VS Code uses) supplies syntax highlighting,
 * bracket matching and language-aware autocomplete. Running/compiling code
 * is not wired up yet (see the Run button) — that needs a server-side
 * compiler/interpreter per language, which is future work.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "ampersand_ide_files_v1";

  var LANGUAGES = [
    { id: "javascript", label: "JavaScript", ext: "js", color: "#f1e05a" },
    { id: "typescript", label: "TypeScript", ext: "ts", color: "#3178c6" },
    { id: "python", label: "Python", ext: "py", color: "#3572A5" },
    { id: "java", label: "Java", ext: "java", color: "#b07219" },
    { id: "c", label: "C", ext: "c", color: "#a8b9cc" },
    { id: "cpp", label: "C++", ext: "cpp", color: "#f34b7d" },
    { id: "csharp", label: "C#", ext: "cs", color: "#178600" },
    { id: "go", label: "Go", ext: "go", color: "#00ADD8" },
    { id: "rust", label: "Rust", ext: "rs", color: "#dea584" },
    { id: "ruby", label: "Ruby", ext: "rb", color: "#701516" },
    { id: "php", label: "PHP", ext: "php", color: "#4F5D95" },
    { id: "swift", label: "Swift", ext: "swift", color: "#ffac45" },
    { id: "kotlin", label: "Kotlin", ext: "kt", color: "#A97BFF" },
    { id: "lua", label: "Lua", ext: "lua", color: "#000080" },
    { id: "perl", label: "Perl", ext: "pl", color: "#0298c3" },
    { id: "html", label: "HTML", ext: "html", color: "#e34c26" },
    { id: "css", label: "CSS", ext: "css", color: "#563d7c" },
    { id: "json", label: "JSON", ext: "json", color: "#cbcb41" },
    { id: "markdown", label: "Markdown", ext: "md", color: "#083fa1" },
    { id: "shell", label: "Shell Script", ext: "sh", color: "#89e051" },
    { id: "sql", label: "SQL", ext: "sql", color: "#e38c00" },
    { id: "yaml", label: "YAML", ext: "yaml", color: "#cb171e" },
    { id: "xml", label: "XML", ext: "xml", color: "#0060ac" },
    { id: "plaintext", label: "Plain Text", ext: "txt", color: "#6e7681" }
  ];

  var LANG_BY_ID = {};
  var LANG_BY_EXT = {};
  LANGUAGES.forEach(function (l) {
    LANG_BY_ID[l.id] = l;
    LANG_BY_EXT[l.ext] = l;
  });

  function langMeta(id) {
    return LANG_BY_ID[id] || { id: id, label: id, ext: "txt", color: "#6e7681" };
  }

  function guessLangFromName(name) {
    var m = /\.([a-zA-Z0-9]+)$/.exec(name || "");
    if (!m) return null;
    var ext = m[1].toLowerCase();
    if (LANG_BY_EXT[ext]) return LANG_BY_EXT[ext].id;
    if (ext === "yml") return "yaml";
    if (ext === "htm") return "html";
    if (ext === "h" || ext === "hpp") return "cpp";
    if (ext === "cc" || ext === "cxx") return "cpp";
    if (ext === "mjs" || ext === "cjs") return "javascript";
    if (ext === "tsx") return "typescript";
    if (ext === "jsx") return "javascript";
    return null;
  }

  function iconAbbrev(langId) {
    switch (langId) {
      case "javascript": return "JS";
      case "typescript": return "TS";
      case "python": return "PY";
      case "java": return "JV";
      case "c": return "C";
      case "cpp": return "C+";
      case "csharp": return "C#";
      case "go": return "GO";
      case "rust": return "RS";
      case "ruby": return "RB";
      case "php": return "PH";
      case "swift": return "SW";
      case "kotlin": return "KT";
      case "lua": return "LU";
      case "perl": return "PL";
      case "html": return "<>";
      case "css": return "#";
      case "json": return "{}";
      case "markdown": return "MD";
      case "shell": return "SH";
      case "sql": return "DB";
      case "yaml": return "YM";
      case "xml": return "XM";
      default: return "TX";
    }
  }

  function uid() {
    return "f_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------------------------------------------------------------------
  // Symbol / "function list" extraction — heuristic, regex based.
  // Monaco doesn't ship a language server for most of these languages, so
  // this scans the visible text for function/class-like declarations. It
  // won't be perfect, but it gives a live outline the way VS Code's does.
  // ---------------------------------------------------------------------
  function extractSymbols(code, langId) {
    var lines = code.split(/\r\n|\r|\n/);
    var out = [];
    var push = function (name, line, kind) {
      out.push({ name: name, line: line, kind: kind });
    };

    var defPy = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
    var classPy = /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/;
    var defRuby = /^\s*def\s+(self\.)?([A-Za-z_][A-Za-z0-9_?!=]*)/;
    var classRuby = /^\s*(class|module)\s+([A-Za-z_][A-Za-z0-9_:]*)/;
    var funcJs = /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;
    var arrowJs = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(?[^=]*\)?\s*=>/;
    var methodJs = /^\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{?\s*$/;
    var classJs = /^\s*(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
    var funcGo = /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
    var funcRust = /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*[(<]/;
    var structRust = /^\s*(?:pub\s+)?(?:struct|enum|trait|impl)\s+([A-Za-z_][A-Za-z0-9_<>]*)/;
    var funcPhp = /^\s*(?:public\s+|private\s+|protected\s+|static\s+)*function\s+&?([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
    var classPhp = /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/;
    var funcLua = /^\s*(?:local\s+)?function\s+([A-Za-z_][A-Za-z0-9_.:]*)\s*\(/;
    var funcCLike = /^\s*(?:[A-Za-z_][A-Za-z0-9_:<>\[\]\*&,\s]*\s+[\*&]?)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{)]*)\)\s*(?:const\s*)?\{?\s*$/;
    var classCLike = /^\s*(?:public\s+|final\s+|abstract\s+|static\s+)*(?:class|struct|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/;
    var funcSql = /^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+([A-Za-z_][A-Za-z0-9_."]*)/i;
    var tableSql = /^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z_][A-Za-z0-9_."]*)/i;
    var mdHeading = /^(#{1,6})\s+(.+)$/;
    var cKeywords = /^(if|for|while|switch|catch|return|else|do|try)$/;

    lines.forEach(function (raw, i) {
      var line = raw;
      var n = i + 1;
      var m;

      switch (langId) {
        case "python":
          if ((m = classPy.exec(line))) push(m[1], n, "class");
          else if ((m = defPy.exec(line))) push(m[1], n, "func");
          break;
        case "ruby":
          if ((m = classRuby.exec(line))) push(m[2], n, "class");
          else if ((m = defRuby.exec(line))) push((m[1] ? "self." : "") + m[2], n, "func");
          break;
        case "go":
          if ((m = funcGo.exec(line))) push(m[1], n, "func");
          else if ((m = classCLike.exec(line))) push(m[1], n, "class");
          break;
        case "rust":
          if ((m = funcRust.exec(line))) push(m[1], n, "func");
          else if ((m = structRust.exec(line))) push(m[1], n, "class");
          break;
        case "php":
          if ((m = classPhp.exec(line))) push(m[1], n, "class");
          else if ((m = funcPhp.exec(line))) push(m[1], n, "func");
          break;
        case "lua":
          if ((m = funcLua.exec(line))) push(m[1], n, "func");
          break;
        case "sql":
          if ((m = funcSql.exec(line))) push(m[1], n, "func");
          else if ((m = tableSql.exec(line))) push(m[1], n, "class");
          break;
        case "markdown":
          if ((m = mdHeading.exec(line))) push(m[2].trim(), n, "heading" + m[1].length);
          break;
        case "javascript":
        case "typescript":
          if ((m = classJs.exec(line))) push(m[1], n, "class");
          else if ((m = funcJs.exec(line))) push(m[1], n, "func");
          else if ((m = arrowJs.exec(line))) push(m[1], n, "func");
          else if ((m = methodJs.exec(line)) && !cKeywords.test(m[1]) && m[1] !== "if" ) push(m[1], n, "method");
          break;
        case "java":
        case "csharp":
        case "kotlin":
        case "swift":
        case "cpp":
        case "c":
          if ((m = classCLike.exec(line))) push(m[1], n, "class");
          else if ((m = funcCLike.exec(line)) && !cKeywords.test(m[1])) push(m[1], n, "func");
          break;
        default:
          break;
      }
    });

    return out;
  }

  function symbolKindStyle(kind) {
    if (kind === "class") return { badge: "C", bg: "#4ec9b0" };
    if (kind === "method") return { badge: "M", bg: "#b180d7" };
    if (kind && kind.indexOf("heading") === 0) return { badge: "H" + kind.slice(7), bg: "#569cd6" };
    return { badge: "ƒ", bg: "#dcdcaa" };
  }

  // ---------------------------------------------------------------------
  // App
  // ---------------------------------------------------------------------
  var App = {
    monaco: null,
    editor: null,
    models: {}, // fileId -> monaco model
    state: null, // { files: [{id,name,language,content}], openTabs: [id], activeId }
    dom: {},
    pendingLangSelection: null
  };

  function loadState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.files)) return parsed;
    } catch (e) { /* ignore corrupt/blocked storage */ }
    return null;
  }

  var saveState = debounce(function () {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state));
    } catch (e) { /* storage full or blocked — editing still works this session */ }
  }, 250);

  function defaultFiles() {
    var welcomeId = uid();
    var exampleId = uid();
    return {
      files: [
        {
          id: welcomeId,
          name: "welcome.md",
          language: "markdown",
          content:
            "# ampersand code\n\n" +
            "A small VS Code–style editor that runs entirely in your browser.\n\n" +
            "- Click **New File** in the Explorer (or the + button) and pick a language.\n" +
            "- You get syntax highlighting and autocomplete for whatever you write.\n" +
            "- The **Outline** panel on the left lists functions/classes in the current file — click one to jump to it.\n" +
            "- Files are saved to this browser's local storage automatically, so they'll be here next time.\n\n" +
            "> Running/compiling code isn't wired up yet — the Run button is a placeholder until a " +
            "server-side compiler/interpreter per language is added.\n"
        },
        {
          id: exampleId,
          name: "example.js",
          language: "javascript",
          content:
            "// try editing this — you'll get JavaScript IntelliSense as you type\n" +
            "function greet(name) {\n" +
            "  return `Hello, ${name}!`;\n" +
            "}\n\n" +
            "function sumAll(numbers) {\n" +
            "  return numbers.reduce((total, n) => total + n, 0);\n" +
            "}\n\n" +
            "console.log(greet(\"world\"));\n" +
            "console.log(sumAll([1, 2, 3, 4]));\n"
        }
      ],
      openTabs: [welcomeId, exampleId],
      activeId: exampleId
    };
  }

  function getFile(id) {
    for (var i = 0; i < App.state.files.length; i++) {
      if (App.state.files[i].id === id) return App.state.files[i];
    }
    return null;
  }

  function fileIndex(id) {
    for (var i = 0; i < App.state.files.length; i++) {
      if (App.state.files[i].id === id) return i;
    }
    return -1;
  }

  function showToast(msg, ms) {
    var stack = App.dom.toastStack;
    var t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    stack.appendChild(t);
    setTimeout(function () {
      t.style.transition = "opacity .3s";
      t.style.opacity = "0";
      setTimeout(function () { t.remove(); }, 300);
    }, ms || 3200);
  }

  // ---- Model management -------------------------------------------------
  function ensureModel(file) {
    if (App.models[file.id]) return App.models[file.id];
    var model = App.monaco.editor.createModel(file.content || "", file.language);
    model.onDidChangeContent(debounce(function () {
      file.content = model.getValue();
      saveState();
      if (App.state.activeId === file.id) renderOutline(file);
    }, 300));
    App.models[file.id] = model;
    return model;
  }

  function disposeModel(id) {
    if (App.models[id]) {
      App.models[id].dispose();
      delete App.models[id];
    }
  }

  // ---- Rendering ----------------------------------------------------------
  function renderExplorer() {
    var list = App.dom.explorerList;
    list.innerHTML = "";
    if (!App.state.files.length) {
      var empty = document.createElement("div");
      empty.className = "explorer-empty";
      empty.textContent = "No files yet. Click + above to create one.";
      list.appendChild(empty);
      return;
    }
    App.state.files.forEach(function (file) {
      var row = document.createElement("div");
      row.className = "file-row" + (file.id === App.state.activeId ? " active" : "");
      row.dataset.id = file.id;

      var meta = langMeta(file.language);
      var icon = document.createElement("span");
      icon.className = "file-icon";
      icon.style.background = meta.color;
      icon.textContent = iconAbbrev(file.language);

      var name = document.createElement("span");
      name.className = "file-name";
      name.textContent = file.name;

      var actions = document.createElement("span");
      actions.className = "file-row-actions";

      var renameBtn = iconButton(icons.pencil, "Rename");
      renameBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        startRename(row, file);
      });

      var delBtn = iconButton(icons.trash, "Delete");
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        deleteFile(file.id);
      });

      actions.appendChild(renameBtn);
      actions.appendChild(delBtn);

      row.appendChild(icon);
      row.appendChild(name);
      row.appendChild(actions);

      row.addEventListener("click", function () { openFile(file.id); });
      row.addEventListener("dblclick", function () { startRename(row, file); });

      list.appendChild(row);
    });
  }

  function startRename(row, file) {
    var nameSpan = row.querySelector(".file-name");
    var actions = row.querySelector(".file-row-actions");
    if (!nameSpan) return;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "rename-input";
    input.value = file.name;
    nameSpan.replaceWith(input);
    if (actions) actions.style.display = "none";
    input.focus();
    input.select();

    function commit() {
      var newName = input.value.trim();
      if (newName && newName !== file.name) {
        file.name = newName;
        var guessed = guessLangFromName(newName);
        if (guessed && guessed !== file.language) {
          file.language = guessed;
          var model = App.models[file.id];
          if (model) App.monaco.editor.setModelLanguage(model, guessed);
        }
        saveState();
      }
      renderExplorer();
      renderTabs();
      if (file.id === App.state.activeId) updateStatusBar(file);
    }

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") { input.value = file.name; input.blur(); }
    });
  }

  function iconButton(svg, title) {
    var b = document.createElement("button");
    b.className = "icon-btn";
    b.title = title;
    b.innerHTML = svg;
    return b;
  }

  function renderTabs() {
    var bar = App.dom.tabBar;
    bar.innerHTML = "";
    App.state.openTabs.forEach(function (id) {
      var file = getFile(id);
      if (!file) return;
      var meta = langMeta(file.language);
      var tab = document.createElement("div");
      tab.className = "tab" + (id === App.state.activeId ? " active" : "");
      tab.dataset.id = id;

      var icon = document.createElement("span");
      icon.className = "file-icon";
      icon.style.background = meta.color;
      icon.textContent = iconAbbrev(file.language);

      var name = document.createElement("span");
      name.className = "tab-name";
      name.textContent = file.name;

      var close = document.createElement("span");
      close.className = "tab-close";
      close.innerHTML = icons.close;
      close.title = "Close";
      close.addEventListener("click", function (e) {
        e.stopPropagation();
        closeTab(id);
      });

      tab.appendChild(icon);
      tab.appendChild(name);
      tab.appendChild(close);
      tab.addEventListener("click", function () { openFile(id); });

      bar.appendChild(tab);
    });
  }

  function renderOutline(file) {
    var list = App.dom.outlineList;
    list.innerHTML = "";
    if (!file) {
      var e1 = document.createElement("div");
      e1.className = "outline-empty";
      e1.textContent = "Open a file to see its outline.";
      list.appendChild(e1);
      return;
    }
    var model = App.models[file.id];
    var code = model ? model.getValue() : (file.content || "");
    var symbols = extractSymbols(code, file.language);
    if (!symbols.length) {
      var e2 = document.createElement("div");
      e2.className = "outline-empty";
      e2.textContent = "No functions or classes detected yet.";
      list.appendChild(e2);
      return;
    }
    symbols.forEach(function (sym) {
      var style = symbolKindStyle(sym.kind);
      var row = document.createElement("div");
      row.className = "outline-row";
      var badge = document.createElement("span");
      badge.className = "kind-badge";
      badge.style.background = style.bg;
      badge.style.color = "#1a1a1a";
      badge.textContent = style.badge;
      var name = document.createElement("span");
      name.textContent = sym.name;
      row.appendChild(badge);
      row.appendChild(name);
      row.title = "Line " + sym.line;
      row.addEventListener("click", function () {
        if (!App.editor) return;
        App.editor.revealLineInCenter(sym.line);
        App.editor.setPosition({ lineNumber: sym.line, column: 1 });
        App.editor.focus();
      });
      list.appendChild(row);
    });
  }

  function updateStatusBar(file) {
    if (!file) {
      App.dom.statusLang.textContent = "Plain Text";
      App.dom.statusPos.textContent = "";
      return;
    }
    App.dom.statusLang.textContent = langMeta(file.language).label;
    var pos = App.editor ? App.editor.getPosition() : null;
    App.dom.statusPos.textContent = pos ? ("Ln " + pos.lineNumber + ", Col " + pos.column) : "";
  }

  // ---- File operations ----------------------------------------------------
  function openFile(id) {
    var file = getFile(id);
    if (!file) return;
    var model = ensureModel(file);
    App.editor.setModel(model);
    App.dom.emptyState.style.display = "none";
    if (App.state.openTabs.indexOf(id) === -1) App.state.openTabs.push(id);
    App.state.activeId = id;
    saveState();
    renderExplorer();
    renderTabs();
    renderOutline(file);
    updateStatusBar(file);
    App.editor.focus();
  }

  function closeTab(id) {
    var idx = App.state.openTabs.indexOf(id);
    if (idx === -1) return;
    App.state.openTabs.splice(idx, 1);
    if (App.state.activeId === id) {
      var next = App.state.openTabs[idx] || App.state.openTabs[idx - 1] || App.state.openTabs[0];
      if (next) {
        openFile(next);
      } else {
        App.state.activeId = null;
        App.editor.setModel(null);
        App.dom.emptyState.style.display = "flex";
        renderExplorer();
        renderTabs();
        renderOutline(null);
        updateStatusBar(null);
      }
    } else {
      renderTabs();
    }
    saveState();
  }

  function deleteFile(id) {
    var file = getFile(id);
    if (!file) return;
    if (!window.confirm('Delete "' + file.name + '"? This cannot be undone.')) return;
    var idx = fileIndex(id);
    if (idx !== -1) App.state.files.splice(idx, 1);
    var tabIdx = App.state.openTabs.indexOf(id);
    if (tabIdx !== -1) App.state.openTabs.splice(tabIdx, 1);
    disposeModel(id);
    if (App.state.activeId === id) {
      var next = App.state.openTabs[0] || null;
      App.state.activeId = null;
      if (next) {
        openFile(next);
      } else {
        App.editor.setModel(null);
        App.dom.emptyState.style.display = "flex";
      }
    }
    saveState();
    renderExplorer();
    renderTabs();
    if (App.state.activeId !== id) renderOutline(getFile(App.state.activeId));
    showToast('Deleted "' + file.name + '".');
  }

  function createFile(name, languageId) {
    var file = { id: uid(), name: name, language: languageId, content: "" };
    App.state.files.push(file);
    App.state.openTabs.push(file.id);
    saveState();
    renderExplorer();
    openFile(file.id);
  }

  // ---- New File modal -------------------------------------------------
  function buildLangGrid() {
    var grid = App.dom.langGrid;
    grid.innerHTML = "";
    LANGUAGES.forEach(function (lang) {
      var chip = document.createElement("div");
      chip.className = "lang-chip";
      chip.dataset.id = lang.id;
      var icon = document.createElement("span");
      icon.className = "file-icon";
      icon.style.background = lang.color;
      icon.textContent = iconAbbrev(lang.id);
      var label = document.createElement("span");
      label.textContent = lang.label;
      chip.appendChild(icon);
      chip.appendChild(label);
      chip.addEventListener("click", function () { selectLanguage(lang.id); });
      grid.appendChild(chip);
    });
  }

  function selectLanguage(langId) {
    App.pendingLangSelection = langId;
    var chips = App.dom.langGrid.querySelectorAll(".lang-chip");
    chips.forEach(function (c) {
      c.classList.toggle("selected", c.dataset.id === langId);
    });
    var meta = langMeta(langId);
    var nameInput = App.dom.newFileName;
    var current = nameInput.value.trim();
    var base = current.replace(/\.[^./\\]+$/, "") || "untitled";
    nameInput.value = base + "." + meta.ext;
  }

  function openNewFileModal() {
    App.dom.newFileName.value = "untitled." + LANGUAGES[0].ext;
    App.pendingLangSelection = LANGUAGES[0].id;
    buildLangGrid();
    selectLanguage(LANGUAGES[0].id);
    App.dom.modalOverlay.hidden = false;
    App.dom.newFileName.focus();
    App.dom.newFileName.select();
  }

  function closeNewFileModal() {
    App.dom.modalOverlay.hidden = true;
  }

  function confirmNewFile() {
    var name = App.dom.newFileName.value.trim();
    if (!name) { showToast("Enter a file name first."); return; }
    var guessed = guessLangFromName(name);
    var langId = guessed || App.pendingLangSelection || "plaintext";
    // if the typed extension doesn't match the picked chip, trust the extension
    createFile(name, langId);
    closeNewFileModal();
  }

  // ---- Status bar language switcher ---------------------------------------
  function cycleLanguagePrompt() {
    var file = getFile(App.state.activeId);
    if (!file) return;
    var labels = LANGUAGES.map(function (l) { return l.label; });
    var choice = window.prompt(
      "Set language for \"" + file.name + "\":\n" + labels.join(", "),
      langMeta(file.language).label
    );
    if (!choice) return;
    var match = LANGUAGES.find(function (l) {
      return l.label.toLowerCase() === choice.trim().toLowerCase();
    });
    if (!match) { showToast('Unknown language "' + choice + '".'); return; }
    file.language = match.id;
    var model = App.models[file.id];
    if (model) App.monaco.editor.setModelLanguage(model, match.id);
    saveState();
    renderExplorer();
    renderTabs();
    renderOutline(file);
    updateStatusBar(file);
  }

  // Some hosting contexts (e.g. a sandboxed preview) don't allow a page to
  // trigger a browser download directly and instead mediate it through
  // window.claude.use("downloads"). Prefer that when present; otherwise
  // fall back to a plain anchor download, which is what a normal browser
  // visiting this page directly (like the deployed site) uses.
  var downloadsCapPromise = null;
  function getDownloadsCapability() {
    if (downloadsCapPromise) return downloadsCapPromise;
    if (typeof window.claude === "object" && window.claude && typeof window.claude.use === "function") {
      downloadsCapPromise = window.claude.use("downloads").catch(function () { return null; });
    } else {
      downloadsCapPromise = Promise.resolve(null);
    }
    return downloadsCapPromise;
  }

  function downloadCurrentFile() {
    var file = getFile(App.state.activeId);
    if (!file) { showToast("Open a file first."); return; }
    var model = App.models[file.id];
    var content = model ? model.getValue() : file.content;

    getDownloadsCapability().then(function (downloads) {
      if (downloads) {
        downloads.save({ filename: file.name, data: content }).then(function () {
          showToast('Saved "' + file.name + '".');
        }, function (err) {
          var code = err && err.code;
          if (code === "declined") return;
          if (code === "rejected_extension" || code === "extension_not_enabled") {
            showToast(
              "This preview can only save a few file types (txt, md, html, json, csv, svg, pdf). " +
              "Select all the code (Ctrl/Cmd+A) and copy it instead.",
              6000
            );
          } else if (code === "too_large") {
            showToast("That file is too large to save from here.");
          } else {
            showToast("Couldn't save the file here — try copying the code instead.");
          }
        });
        return;
      }
      // Not mediated — do a normal browser download.
      var blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  }

  function handleRun() {
    showToast(
      "Running code isn't wired up yet — each language needs its own compiler/interpreter " +
      "on a server, which is planned but not built. For now this is an editor only.",
      5000
    );
  }

  // ---- Icons ---------------------------------------------------------------
  var icons = {
    files: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.35-4.35"></path></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z"></path></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"></path></svg>',
    pencil: '<svg viewBox="0 0 24 24"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"></path></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 3v12"></path><path d="M7 10l5 5 5-5"></path><path d="M5 21h14"></path></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M6 3l14 9-14 9V3z"></path></svg>'
  };

  // ---- Boot -----------------------------------------------------------------
  function cacheDom() {
    App.dom.explorerList = document.getElementById("explorerList");
    App.dom.outlineList = document.getElementById("outlineList");
    App.dom.tabBar = document.getElementById("tabBar");
    App.dom.emptyState = document.getElementById("editorEmptyState");
    App.dom.statusLang = document.getElementById("statusLang");
    App.dom.statusPos = document.getElementById("statusPos");
    App.dom.toastStack = document.getElementById("toastStack");
    App.dom.modalOverlay = document.getElementById("newFileModal");
    App.dom.newFileName = document.getElementById("newFileName");
    App.dom.langGrid = document.getElementById("langGrid");
  }

  function wireEvents() {
    document.getElementById("newFileBtnSidebar").addEventListener("click", openNewFileModal);
    document.getElementById("newFileBtnEmpty").addEventListener("click", openNewFileModal);
    document.getElementById("modalCancel").addEventListener("click", closeNewFileModal);
    document.getElementById("modalCreate").addEventListener("click", confirmNewFile);
    App.dom.modalOverlay.addEventListener("click", function (e) {
      if (e.target === App.dom.modalOverlay) closeNewFileModal();
    });
    App.dom.newFileName.addEventListener("keydown", function (e) {
      if (e.key === "Enter") confirmNewFile();
      if (e.key === "Escape") closeNewFileModal();
    });
    App.dom.newFileName.addEventListener("input", function () {
      var guessed = guessLangFromName(App.dom.newFileName.value);
      if (guessed) {
        App.pendingLangSelection = guessed;
        var chips = App.dom.langGrid.querySelectorAll(".lang-chip");
        chips.forEach(function (c) { c.classList.toggle("selected", c.dataset.id === guessed); });
      }
    });
    App.dom.statusLang.addEventListener("click", cycleLanguagePrompt);
    document.getElementById("downloadBtn").addEventListener("click", downloadCurrentFile);
    document.getElementById("runBtn").addEventListener("click", handleRun);

    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveState();
        showToast("Saved to browser storage.");
      }
    });
  }

  window.AmpersandIDE = {
    boot: function (monacoGlobal) {
      App.monaco = monacoGlobal;
      cacheDom();

      App.state = loadState() || defaultFiles();
      if (!App.state.openTabs) App.state.openTabs = [];
      if (!App.state.activeId && App.state.openTabs.length) App.state.activeId = App.state.openTabs[0];

      document.getElementById("newFileBtnSidebar").innerHTML = icons.plus;
      document.getElementById("downloadBtn").innerHTML = icons.download + "<span>Download</span>";
      document.getElementById("runBtn").innerHTML = icons.play + "<span>Run</span>";

      monacoGlobal.editor.defineTheme("ampersand-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {}
      });

      App.editor = monacoGlobal.editor.create(document.getElementById("monaco-container"), {
        theme: "ampersand-dark",
        automaticLayout: true,
        fontSize: 14,
        fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
        minimap: { enabled: true },
        wordWrap: "off",
        tabSize: 2,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        suggestOnTriggerCharacters: true,
        quickSuggestions: true
      });

      App.editor.onDidChangeCursorPosition(function () {
        updateStatusBar(getFile(App.state.activeId));
      });

      wireEvents();
      renderExplorer();
      renderTabs();

      if (App.state.activeId && getFile(App.state.activeId)) {
        openFile(App.state.activeId);
      } else {
        App.dom.emptyState.style.display = "flex";
        renderOutline(null);
        updateStatusBar(null);
      }
    }
  };
})();
