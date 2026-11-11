// Edit mode for blog posts. Loaded only by edit.py, never on the live site.
(() => {
    const cfg = window.__EDIT;
    const article = document.querySelector('article');
    if (!cfg || !article) return;

    // Tag everything that came from the file, so on save anything the browser
    // invented while editing (spans, inline styles, <b>, <div>) can be cleaned up.
    article.querySelectorAll('*').forEach((el) => el.setAttribute('data-ed-o', ''));
    article.querySelectorAll('.ride-gallery').forEach((g) => { if (g.querySelector('figure')) g.setAttribute('data-ed-full', ''); });

    document.execCommand('defaultParagraphSeparator', false, 'p');
    article.contentEditable = 'true';
    article.spellcheck = true;

    // Photos, videos and the map are blocks you move or delete, not text you type into.
    // Captions stay editable.
    const islands = 'figure, .ride-map, .ride-gallery, [data-gpx], iframe, blockquote.twitter-tweet, script';
    article.querySelectorAll(islands).forEach((el) => { el.contentEditable = 'false'; });
    article.querySelectorAll('figcaption').forEach((el) => { el.contentEditable = 'true'; });

    // ---------- Toolbar ----------
    const bar = document.createElement('div');
    bar.className = 'ed-bar';
    bar.innerHTML = `
        <span class="ed-title">Editing</span>
        <button data-cmd="bold" title="Bold (⌘B)"><b>B</b></button>
        <button data-cmd="italic" title="Italic (⌘I)"><i>I</i></button>
        <button data-cmd="link" title="Link (⌘K)">Link</button>
        <button data-cmd="h2" title="Heading">H2</button>
        <button data-cmd="p" title="Normal text">¶</button>
        <span class="ed-sep"></span>
        <button data-cmd="undo-photo" title="Bring back the last photo you deleted or moved" disabled>Undo photo</button>
        <span class="ed-status"></span>
        <button data-cmd="save" class="ed-save" title="Save (⌘S)" disabled>Save</button>`;
    document.body.appendChild(bar);
    const status = bar.querySelector('.ed-status');
    const saveBtn = bar.querySelector('.ed-save');
    const undoBtn = bar.querySelector('[data-cmd="undo-photo"]');

    let dirty = false;
    const setDirty = (d) => {
        dirty = d;
        saveBtn.disabled = !d;
        status.textContent = d ? 'Unsaved changes' : status.dataset.saved || '';
    };
    article.addEventListener('input', () => setDirty(true));
    window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

    const link = () => {
        const sel = window.getSelection();
        const existing = sel.anchorNode && sel.anchorNode.parentElement.closest('a');
        const url = prompt('Link to:', existing ? existing.getAttribute('href') : 'https://');
        if (url === null) return;
        if (!url) document.execCommand('unlink');
        else document.execCommand('createLink', false, url);
        setDirty(true);
    };

    bar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text selection
    bar.addEventListener('click', (e) => {
        const cmd = e.target.closest('button')?.dataset.cmd;
        if (!cmd) return;
        if (cmd === 'bold' || cmd === 'italic') document.execCommand(cmd);
        else if (cmd === 'h2' || cmd === 'p') document.execCommand('formatBlock', false, cmd);
        else if (cmd === 'link') return link();
        else if (cmd === 'undo-photo') return undoPhoto();
        else if (cmd === 'save') return save();
        setDirty(true);
    });

    document.addEventListener('keydown', (e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        if (e.key === 's') { e.preventDefault(); save(); }
        if (e.key === 'k') { e.preventDefault(); link(); }
    });

    // Paste as plain text, so formatting from other apps doesn't sneak into the file
    article.addEventListener('paste', (e) => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });

    // ---------- Photos: delete and drag to reorder ----------
    // Photos move together with the line break + indent in front of them, so the file stays tidy
    const wsBefore = (el) => {
        const t = el.previousSibling;
        return t && t.nodeType === Node.TEXT_NODE && !t.textContent.trim() ? t : null;
    };
    const history = [];
    const remember = (fig) => {
        history.push({ fig, ws: wsBefore(fig), parent: fig.parentNode, next: fig.nextSibling });
        undoBtn.disabled = false;
    };
    const undoPhoto = () => {
        const h = history.pop();
        if (!h) return;
        const ref = h.next && h.next.parentNode === h.parent ? h.next : null;
        if (h.ws) h.parent.insertBefore(h.ws, ref);
        h.parent.insertBefore(h.fig, ref);
        undoBtn.disabled = !history.length;
        setDirty(true);
    };

    let dragged = null;
    article.querySelectorAll('.ride-gallery figure').forEach((fig) => {
        const del = document.createElement('button');
        del.className = 'ed-del';
        del.setAttribute('data-ed-ui', '');
        del.title = 'Remove this photo';
        del.textContent = '✕';
        del.addEventListener('click', (e) => {
            e.preventDefault();
            remember(fig);
            wsBefore(fig)?.remove();
            fig.remove();
            setDirty(true);
        });
        fig.appendChild(del);

        fig.draggable = true;
        fig.addEventListener('dragstart', (e) => {
            dragged = fig;
            fig.classList.add('ed-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', '');
        });
        fig.addEventListener('dragend', () => {
            fig.classList.remove('ed-dragging');
            dragged = null;
        });
    });

    article.addEventListener('dragover', (e) => {
        if (!dragged) return;
        const target = e.target.closest('.ride-gallery figure');
        e.preventDefault();
        if (!target || target === dragged) return;
        const r = target.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        if (!dragged.dataset.edMoved) { remember(dragged); dragged.dataset.edMoved = '1'; }
        const ws = wsBefore(dragged) || document.createTextNode('\n' + indentOf(target));
        if (after) target.after(ws, dragged);
        else target.before(dragged, ws);
        setDirty(true);
    });
    article.addEventListener('drop', (e) => { if (dragged) e.preventDefault(); });
    article.addEventListener('dragend', () => {
        article.querySelectorAll('[data-ed-moved]').forEach((f) => delete f.dataset.edMoved);
    });

    // ---------- Save ----------
    const indentOf = (el) => (wsBefore(el)?.textContent.split('\n').pop()) ?? '            ';
    const BLOCK = /^(P|H[1-6]|UL|OL|LI|BLOCKQUOTE|FIGURE|DIV|PRE|TABLE|HR)$/;
    const unwrap = (el) => el.replaceWith(...el.childNodes);
    const rename = (el, tag) => {
        const n = document.createElement(tag);
        for (const a of el.attributes) n.setAttribute(a.name, a.value);
        n.append(...el.childNodes);
        el.replaceWith(n);
        return n;
    };

    function serialize() {
        const copy = article.cloneNode(true);
        copy.querySelectorAll('[data-ed-ui]').forEach((el) => el.remove());

        // Clean up what the browser added while editing
        [...copy.querySelectorAll('*:not([data-ed-o])')].reverse().forEach((el) => {
            el.removeAttribute('style');
            const tag = el.tagName.toLowerCase();
            if (tag === 'span' || tag === 'font') unwrap(el);
            else if (tag === 'b') rename(el, 'strong');
            else if (tag === 'i') rename(el, 'em');
            else if (tag === 'div') el.parentNode === copy ? rename(el, 'p') : unwrap(el);
            else if (tag === 'br' && el.parentNode.lastChild === el) el.remove();
        });
        copy.querySelectorAll('p').forEach((p) => { if (!p.textContent.trim() && !p.querySelector('img, video')) { wsBefore(p)?.remove(); p.remove(); } });
        // A gallery you emptied goes too (but not the empty placeholder the new_*.py scripts fill)
        copy.querySelectorAll('.ride-gallery[data-ed-full]').forEach((g) => { if (!g.querySelector('figure')) { wsBefore(g)?.remove(); g.remove(); } });

        // New paragraphs (Enter) and moved photos go on their own line, indented like their neighbor
        copy.querySelectorAll('*').forEach((el) => {
            const prev = el.previousSibling;
            if (prev && prev.nodeType === Node.ELEMENT_NODE && BLOCK.test(el.tagName) && BLOCK.test(prev.tagName)) {
                el.before(document.createTextNode('\n' + indentOf(prev)));
            }
        });

        copy.querySelectorAll('*').forEach((el) => {
            ['data-ed-o', 'data-ed-full', 'data-ed-moved', 'contenteditable', 'draggable', 'spellcheck'].forEach((a) => el.removeAttribute(a));
            el.classList.remove('ed-dragging');
            if (el.getAttribute('class') === '') el.removeAttribute('class');
        });
        // Typing double spaces leaves non-breaking spaces behind; the posts never use them on purpose
        return copy.innerHTML.replace(/&nbsp;| /g, ' ');
    }

    async function save() {
        if (!dirty) return;
        status.textContent = 'Saving…';
        try {
            const res = await fetch('/__save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: cfg.path, hash: cfg.hash, html: serialize() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || res.statusText);
            cfg.hash = data.hash;
            status.dataset.saved = `Saved to ${data.file}`;
            setDirty(false);
        } catch (err) {
            status.textContent = `Not saved: ${err.message}`;
        }
    }

    window.__editorSerialize = serialize; // for tests
})();
