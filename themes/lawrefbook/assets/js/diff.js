// 修订对比：比较同一部法律的两个版本，按条标出修改、新增、删除
// 对比的算法和 App 一致（见 App 的 Shared/Manager/LawContent/LawDiff.swift）：
//   1. 正文按条切开，条号之后不带条号的段落属于同一条（款、项）
//   2. 新旧条文配对：先找内容完全一样的，再按双字组相似度找相近的，条号只作辅助
//   3. 修改过的条文逐字比较，夹在两处改动之间的很短的片段并入改动，读起来不会太碎
// 两个版本的内容直接读网站上已有的法律页面，不需要另外生成数据

(() => {
  'use strict';

  const root = document.querySelector('[data-diff]');
  if (!root) return;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  // ---------- 对比算法 ----------

  const ARTICLE_RE = /^第[一二三四五六七八九十零百千万]+条(之[一二三四五六七八九十零百千万]+)?/;
  // 数据来源的全角、半角标点不一致，比较时统一成全角，不算改动
  const FOLD = { ':': '：', ';': '；', ',': '，', '(': '（', ')': '）', '?': '？', '!': '！' };
  const fold = (s) => s.replace(/[:;,()?!]/g, (c) => FOLD[c]);

  const EXACT_SIMILARITY = 0.5;
  const SAME_TITLE_SIMILARITY = 0.25;
  const SAME_TITLE_BONUS = 0.1;
  const ABSORBED_RUN_LENGTH = 2;
  // 逐字比较的改动数上限，超过时整条当作替换（一条整个重写时逐字标出来也没法读）
  const MAX_EDITS = 2000;

  // paragraphs：[{ text, heading }]，heading 是段落所在的章节标题，没有条号的段落用它来称呼（比如“序言”）
  function articles(paragraphs) {
    const hasNumbers = paragraphs.some((p) => ARTICLE_RE.test(p.text));
    const drafts = [];
    for (const p of paragraphs) {
      const m = ARTICLE_RE.exec(p.text);
      if (m) drafts.push({ title: m[0], text: p.text.slice(m[0].length), label: '' });
      else if (hasNumbers && drafts.length) drafts[drafts.length - 1].text += '\n' + p.text;
      else drafts.push({ title: '', text: p.text, label: p.heading });
    }
    return drafts.map((d) => {
      const text = d.text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n');
      return { title: d.title, label: d.label, text, key: fold(text).replace(/\s/g, '') };
    });
  }

  function bigrams(s) {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }

  // 新版每一条对应的旧版下标（-1 是新增），优先内容一致，其次内容相近
  function match(oldA, newA) {
    const matches = new Array(newA.length).fill(-1);
    const used = new Set();

    const claim = (identity) => {
      const queues = new Map();
      oldA.forEach((a, i) => {
        if (used.has(i)) return;
        const k = identity(a);
        if (!queues.has(k)) queues.set(k, []);
        queues.get(k).push(i);
      });
      newA.forEach((a, i) => {
        if (matches[i] !== -1) return;
        const q = queues.get(identity(a));
        if (q && q.length) {
          const c = q.shift();
          matches[i] = c;
          used.add(c);
        }
      });
    };
    claim((a) => a.title + '\n' + a.key);
    claim((a) => a.key);

    const postings = new Map();
    const oldGrams = new Map();
    oldA.forEach((a, i) => {
      if (used.has(i)) return;
      const grams = bigrams(a.key);
      oldGrams.set(i, grams);
      grams.forEach((g) => {
        let list = postings.get(g);
        if (!list) postings.set(g, (list = []));
        list.push(i);
      });
    });

    const candidates = [];
    newA.forEach((a, i) => {
      if (matches[i] !== -1) return;
      const grams = bigrams(a.key);
      const overlaps = new Map();
      grams.forEach((g) => {
        const list = postings.get(g);
        if (list) list.forEach((o) => overlaps.set(o, (overlaps.get(o) || 0) + 1));
      });
      overlaps.forEach((overlap, o) => {
        const similarity = (2 * overlap) / (grams.size + oldGrams.get(o).size);
        const sameTitle = !!a.title && a.title === oldA[o].title;
        if (similarity >= (sameTitle ? SAME_TITLE_SIMILARITY : EXACT_SIMILARITY)) {
          candidates.push([similarity + (sameTitle ? SAME_TITLE_BONUS : 0), i, o]);
        }
      });
    });
    candidates.sort((p, q) => q[0] - p[0] || p[1] - q[1] || p[2] - q[2]);
    for (const [, i, o] of candidates) {
      if (matches[i] === -1 && !used.has(o)) {
        matches[i] = o;
        used.add(o);
      }
    }
    return matches;
  }

  // Myers 差分。返回旧版里删掉的位置和新版里加上的位置；改动太多时返回 null
  function myers(a, b) {
    const n = a.length;
    const m = b.length;
    const max = n + m;
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    for (let d = 0; d <= max; d++) {
      if (d > MAX_EDITS) return null;
      // 记下这一步开始前 k ∈ [-d-1, d+1] 的位置，回溯时用
      trace.push(v.slice(off - d - 1, off + d + 2));
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) {
          x++;
          y++;
        }
        v[off + k] = x;
        if (x >= n && y >= m) return backtrack(trace, n, m);
      }
    }
    return backtrack(trace, n, m);
  }

  function backtrack(trace, n, m) {
    const removed = new Set();
    const inserted = new Set();
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const v = trace[d];
      const base = d + 1;
      const k = x - y;
      const prevK = k === -d || (k !== d && v[k - 1 + base] < v[k + 1 + base]) ? k + 1 : k - 1;
      const prevX = v[prevK + base];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        x--;
        y--;
      }
      if (d > 0) {
        if (x === prevX) inserted.add(prevY);
        else removed.add(prevX);
      }
      x = prevX;
      y = prevY;
    }
    return { removed, inserted };
  }

  function chunks(oldText, newText) {
    const oldChars = Array.from(oldText);
    const newChars = Array.from(newText);
    const edits = myers(oldChars.map((c) => FOLD[c] || c), newChars.map((c) => FOLD[c] || c));
    if (!edits) {
      return [
        { kind: 'del', text: oldText },
        { kind: 'ins', text: newText },
      ];
    }

    const blocks = [];
    const change = (del, ins) => {
      const last = blocks[blocks.length - 1];
      if (last && last.change) {
        last.del += del;
        last.ins += ins;
      } else blocks.push({ change: true, del, ins });
    };
    let oi = 0;
    let ni = 0;
    while (oi < oldChars.length || ni < newChars.length) {
      if (edits.removed.has(oi)) {
        change(oldChars[oi], '');
        oi++;
      } else if (edits.inserted.has(ni)) {
        change('', newChars[ni]);
        ni++;
      } else {
        const last = blocks[blocks.length - 1];
        if (last && !last.change) last.text += newChars[ni];
        else blocks.push({ change: false, text: newChars[ni] });
        oi++;
        ni++;
      }
    }

    // 字符级的差分容易把一个词打碎：夹在两处改动之间的很短的片段并入改动
    const merged = [];
    for (const block of blocks) {
      const same = merged[merged.length - 1];
      const prev = merged[merged.length - 2];
      if (block.change && same && !same.change && Array.from(same.text).length <= ABSORBED_RUN_LENGTH && prev && prev.change) {
        merged.splice(-2, 2, { change: true, del: prev.del + same.text + block.del, ins: prev.ins + same.text + block.ins });
      } else merged.push(block);
    }

    const out = [];
    for (const b of merged) {
      if (!b.change) out.push({ kind: 'same', text: b.text });
      else {
        if (b.del) out.push({ kind: 'del', text: b.del });
        if (b.ins) out.push({ kind: 'ins', text: b.ins });
      }
    }
    return out;
  }

  function compare(oldParagraphs, newParagraphs) {
    const oldA = articles(oldParagraphs);
    const newA = articles(newParagraphs);
    const matches = match(oldA, newA);

    // 删除的条文排在它在旧版中的前一条后面，保持上下文
    const matched = new Set(matches.filter((i) => i !== -1));
    const removedAfter = new Map();
    let anchor = -1;
    oldA.forEach((_, i) => {
      if (matched.has(i)) anchor = i;
      else {
        if (!removedAfter.has(anchor)) removedAfter.set(anchor, []);
        removedAfter.get(anchor).push(i);
      }
    });

    const result = [];
    const appendRemoved = (after) => {
      for (const i of removedAfter.get(after) || []) {
        const a = oldA[i];
        result.push({ change: 'removed', title: a.title, label: a.label, oldTitle: a.title, movedFrom: '', chunks: [{ kind: 'del', text: a.text }] });
      }
    };
    appendRemoved(-1);
    newA.forEach((a, i) => {
      const o = matches[i];
      if (o === -1) {
        result.push({ change: 'added', title: a.title, label: a.label, oldTitle: '', movedFrom: '', chunks: [{ kind: 'ins', text: a.text }] });
        return;
      }
      const old = oldA[o];
      const same = old.key === a.key;
      result.push({
        change: same ? 'unchanged' : 'modified',
        title: a.title,
        label: a.label || old.label,
        oldTitle: old.title,
        movedFrom: old.title === a.title ? '' : old.title,
        chunks: same ? [{ kind: 'same', text: a.text }] : chunks(old.text, a.text),
      });
      appendRemoved(o);
    });
    return result;
  }

  // ---------- 读取法律页面 ----------

  // 地址参数是法律页面去掉 /docs/ 和结尾斜杠的路径，比如 刑法/刑法2023-12-29
  const clean = (v) =>
    String(v || '')
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .replace(/^docs\//, '');
  const isSafe = (v) => !!v && !/[:?#\\]/.test(v) && v.split('/').every((s) => s && s !== '.' && s !== '..');
  const pageURL = (v) => '/docs/' + v.split('/').map(encodeURIComponent).join('/') + '/';
  const pathOf = (href) => {
    try {
      return clean(decodeURIComponent(new URL(href, location.href).pathname));
    } catch (e) {
      return '';
    }
  };

  const pages = new Map();

  function loadPage(path) {
    if (!pages.has(path)) {
      const p = fetch(pageURL(path))
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        })
        .then((html) => parsePage(path, html));
      p.catch(() => pages.delete(path));
      pages.set(path, p);
    }
    return pages.get(path);
  }

  function parsePage(path, html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = $('[data-law-body]', doc);
    if (!body) throw new Error('not a law page');
    const paragraphs = [];
    let heading = '';
    $$('h2, h3, h4, h5, p, li, tr', body).forEach((el) => {
      if (/^H\d$/.test(el.tagName)) {
        heading = el.textContent.trim();
        return;
      }
      if (el.tagName === 'P' && el.closest('li, td, th')) return;
      const text =
        el.tagName === 'TR'
          ? $$('td, th', el)
              .map((c) => c.textContent.trim())
              .join(' | ')
          : el.textContent;
      const t = text.replace(/[ \t\r\n]+/g, ' ').trim();
      if (t) paragraphs.push({ text: t, heading });
    });
    const law = $('[data-law]', doc);
    const versions = $$('.versions-menu a.version', doc).map((a) => ({
      path: pathOf(a.getAttribute('href')),
      label: ($('.version-date', a) || a).textContent.trim(),
      status: (($('.badge', a) || {}).textContent || '').trim(),
    }));
    if (!versions.length) versions.push({ path, label: '当前版本', status: '' });
    return {
      path,
      title: law ? law.dataset.title : $('title', doc).textContent,
      name: law ? law.dataset.name : '',
      crumbs: $$('.crumbs a', doc).map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })),
      versions,
      paragraphs,
    };
  }

  // ---------- 界面 ----------

  const els = {
    crumbs: $('[data-diff-crumbs]', root),
    title: $('[data-diff-title]', root),
    sub: $('[data-diff-sub]', root),
    controls: $('[data-diff-controls]', root),
    oldSelect: $('[data-diff-old]', root),
    newSelect: $('[data-diff-new]', root),
    oldLink: $('[data-diff-old-link]', root),
    newLink: $('[data-diff-new-link]', root),
    unchanged: $('[data-diff-unchanged]', root),
    status: $('[data-diff-status]', root),
    summary: $('[data-diff-summary]', root),
    list: $('[data-diff-list]', root),
    copy: $('[data-diff-copy]', root),
  };
  const preview = parseInt(root.dataset.preview, 10) || 0;
  const KINDS = {
    modified: { label: '修改', badge: 'revised' },
    added: { label: '新增', badge: 'current' },
    removed: { label: '删除', badge: 'pending' },
  };

  const state = {
    newPath: '',
    oldPath: '',
    versions: [],
    diffs: null,
    filter: new Set(),
    // 显示方式：选过的记在本机；没选过时宽屏并排、窄屏合并，跟着窗口宽度变
    chosenView: '',
    expanded: new Set(),
  };
  const wide = window.matchMedia('(min-width: 1024px)');
  const viewMode = () => state.chosenView || (wide.matches ? 'split' : 'inline');

  try {
    const saved = localStorage.getItem('lrb:diffView');
    if (saved === 'split' || saved === 'inline') state.chosenView = saved;
  } catch (e) {}
  if (wide.addEventListener) {
    wide.addEventListener('change', () => {
      if (!state.chosenView) render();
    });
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function setStatus(text, isError) {
    els.status.hidden = !text;
    els.status.textContent = text || '';
    els.status.classList.toggle('is-error', !!isError);
  }

  function toast(msg) {
    const el = $('[data-toast]');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('is-visible'), 2000);
  }

  function versionLabel(v) {
    return v.status ? `${v.label}（${v.status}）` : v.label;
  }

  // 新旧两侧都可以选任意版本，顺序冲突时另一侧挪到相邻的版本（和 App 的 LawVersionPair 一样）
  function fillSelects() {
    const vs = state.versions;
    const ni = vs.findIndex((v) => v.path === state.newPath);
    const oi = vs.findIndex((v) => v.path === state.oldPath);
    els.newSelect.innerHTML = vs
      .slice(0, -1)
      .map((v, i) => `<option value="${i}"${i === ni ? ' selected' : ''}>${esc(versionLabel(v))}</option>`)
      .join('');
    els.oldSelect.innerHTML = vs
      .map((v, i) => (i === 0 ? '' : `<option value="${i}"${i === oi ? ' selected' : ''}>${esc(versionLabel(v))}</option>`))
      .join('');
    els.newLink.href = pageURL(state.newPath);
    els.oldLink.href = pageURL(state.oldPath);
  }

  function updateURL() {
    const q = new URLSearchParams({ new: state.newPath, old: state.oldPath });
    history.replaceState(null, '', `${location.pathname}?${q.toString()}${location.hash}`);
  }

  function renderHeader(page) {
    const title = page.title || page.name;
    document.title = `《${title}》修订对比 - ${document.title.split(' - ').pop()}`;
    els.title.textContent = `《${title}》修订对比`;
    const crumbs = page.crumbs
      .map((c) => `<a href="${esc(c.href)}">${esc(c.text)}</a><svg class="i i-xs" aria-hidden="true"><use href="#i-chevron-right"/></svg>`)
      .join('');
    els.crumbs.innerHTML = `${crumbs}<a href="${esc(pageURL(page.path))}">${esc(title)}</a><svg class="i i-xs" aria-hidden="true"><use href="#i-chevron-right"/></svg><span>修订对比</span>`;
  }

  function chunkHTML(list, side) {
    return list
      .map((c) => {
        if (c.kind === 'same') return esc(c.text);
        if (c.kind === 'del') return side === 'new' ? '' : `<del class="diff-del">${esc(c.text)}</del>`;
        return side === 'old' ? '' : `<ins class="diff-ins">${esc(c.text)}</ins>`;
      })
      .join('');
  }

  function cardHTML(d) {
    const kind = KINDS[d.change];
    const title = d.title || d.oldTitle;
    const anchor = d.change === 'removed' ? pageURL(state.oldPath) : pageURL(state.newPath);
    const head =
      `<div class="diff-card-head">` +
      (title
        ? `<a class="diff-card-title" href="${esc(anchor)}#${encodeURIComponent(title)}">${esc(title)}</a>`
        : `<span class="diff-card-title is-untitled">${esc(d.label || '无条号的段落')}</span>`) +
      (d.movedFrom ? `<span class="diff-moved">原${esc(d.movedFrom)}</span>` : '') +
      (kind ? `<span class="badge badge--${kind.badge}">${kind.label}</span>` : '') +
      `</div>`;
    let body;
    if (viewMode() === 'split' && d.change !== 'unchanged') {
      const left = d.change === 'added' ? '<span class="diff-none">（旧版本没有这一条）</span>' : chunkHTML(d.chunks, 'old');
      const right = d.change === 'removed' ? '<span class="diff-none">（新版本删除了这一条）</span>' : chunkHTML(d.chunks, 'new');
      body = `<div class="diff-split"><div class="diff-body"><span class="diff-side">旧</span>${left}</div><div class="diff-body"><span class="diff-side">新</span>${right}</div></div>`;
    } else {
      body = `<div class="diff-body">${chunkHTML(d.chunks, 'both')}</div>`;
    }
    return `<article class="diff-card is-${d.change}">${head}${body}</article>`;
  }

  function gapHTML(group, index) {
    const first = group[0].title;
    const last = group[group.length - 1].title;
    const range = first && last ? (first === last ? `（${first}）` : `（${first}至${last}）`) : '';
    return `<button class="diff-gap" type="button" data-gap="${index}"><svg class="i i-sm" aria-hidden="true"><use href="#i-chevron-down"/></svg>${group.length} 条未改动${esc(range)}</button>`;
  }

  function render() {
    const diffs = state.diffs;
    if (!diffs) return;
    const changed = diffs.filter((d) => d.change !== 'unchanged');
    const counts = { modified: 0, added: 0, removed: 0 };
    changed.forEach((d) => counts[d.change]++);
    const unchanged = diffs.length - changed.length;

    $$('[data-diff-filter]', root).forEach((b) => {
      const k = b.dataset.diffFilter;
      $('.btn-count', b).textContent = counts[k];
      b.setAttribute('aria-pressed', String(state.filter.has(k)));
      // 只预览前几处改动时不能筛选，否则筛选能绕过预览的限制
      b.disabled = preview > 0 || (counts[k] === 0 && !state.filter.has(k));
    });
    const view = viewMode();
    $$('[data-diff-view]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.diffView === view)));
    root.classList.toggle('is-split', view === 'split');

    if (!changed.length) {
      els.summary.textContent = '';
      els.list.innerHTML = '<div class="empty"><p>两个版本的条文内容相同。</p></div>';
      return;
    }
    els.summary.textContent = `共 ${changed.length} 处改动：修改 ${counts.modified} 条，新增 ${counts.added} 条，删除 ${counts.removed} 条；${unchanged} 条未改动。`;

    const html = [];
    if (state.filter.size) {
      const shown = changed.filter((d) => state.filter.has(d.change));
      shown.forEach((d) => html.push(cardHTML(d)));
      if (!shown.length) html.push('<div class="empty"><p>没有符合筛选的条文。</p></div>');
    } else {
      // 连续未改动的条文收起成一行，点开再看；勾选“显示未改动的条文”时全部展开
      let group = [];
      let gapIndex = 0;
      let shownChanges = 0;
      const flush = () => {
        if (!group.length) return;
        const i = gapIndex++;
        if (els.unchanged.checked || state.expanded.has(i)) group.forEach((d) => html.push(cardHTML(d)));
        else html.push(gapHTML(group, i));
        group = [];
      };
      for (const d of diffs) {
        if (preview && shownChanges >= preview) break;
        if (d.change === 'unchanged') {
          group.push(d);
          continue;
        }
        flush();
        html.push(cardHTML(d));
        shownChanges++;
      }
      if (!preview || shownChanges < preview) flush();
      if (preview && changed.length > preview) {
        html.push(
          `<div class="diff-locked"><p><strong>还有 ${changed.length - preview} 处改动</strong></p>` +
            `<p>在 iOS 应用中查看完整的修订对比。</p>` +
            `<a class="btn btn--primary" href="${esc(root.dataset.appStore)}" rel="noopener">下载 iOS 应用</a></div>`
        );
      }
    }
    els.list.innerHTML = html.join('');
  }

  async function run() {
    setStatus('正在比较两个版本…');
    els.list.innerHTML = '';
    els.summary.textContent = '';
    try {
      const [newPage, oldPage] = await Promise.all([loadPage(state.newPath), loadPage(state.oldPath)]);
      state.diffs = compare(oldPage.paragraphs, newPage.paragraphs);
      state.expanded.clear();
      setStatus('');
      render();
    } catch (e) {
      state.diffs = null;
      setStatus('无法读取所选版本的内容，请检查网络后刷新重试。', true);
    }
  }

  async function start() {
    const params = new URLSearchParams(location.search);
    state.newPath = clean(params.get('new'));
    state.oldPath = clean(params.get('old'));
    if (!isSafe(state.newPath) || (state.oldPath && !isSafe(state.oldPath))) {
      setStatus('请从法律页面的“修订对比”进入，选择要比较的两个版本。', true);
      return;
    }
    setStatus('正在读取版本…');
    let page;
    try {
      page = await loadPage(state.newPath);
    } catch (e) {
      setStatus('找不到这部法律，可能已经移动或改名。', true);
      return;
    }
    renderHeader(page);
    state.versions = page.versions;
    const ni = state.versions.findIndex((v) => v.path === state.newPath);
    let oi = state.versions.findIndex((v) => v.path === state.oldPath);
    if (ni === -1 || state.versions.length < 2) {
      setStatus('这部法律只有一个版本，没有可以对比的修订。', true);
      return;
    }
    // 没给旧版本、或给的不比新版本旧时，用新版本的上一版；新版本是最早的一版时和下一版比
    if (oi <= ni) {
      if (ni + 1 < state.versions.length) oi = ni + 1;
      else {
        oi = ni;
        state.newPath = state.versions[ni - 1].path;
      }
    }
    state.oldPath = state.versions[oi].path;
    updateURL();
    fillSelects();
    els.controls.hidden = false;
    await run();
  }

  els.newSelect.addEventListener('change', () => {
    const ni = +els.newSelect.value;
    let oi = state.versions.findIndex((v) => v.path === state.oldPath);
    if (oi <= ni) oi = ni + 1;
    state.newPath = state.versions[ni].path;
    state.oldPath = state.versions[oi].path;
    updateURL();
    fillSelects();
    run();
  });
  els.oldSelect.addEventListener('change', () => {
    const oi = +els.oldSelect.value;
    let ni = state.versions.findIndex((v) => v.path === state.newPath);
    if (ni >= oi) ni = oi - 1;
    state.newPath = state.versions[ni].path;
    state.oldPath = state.versions[oi].path;
    updateURL();
    fillSelects();
    run();
  });

  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-diff-filter]');
    if (f) {
      const k = f.dataset.diffFilter;
      if (state.filter.has(k)) state.filter.delete(k);
      else state.filter.add(k);
      render();
      return;
    }
    const v = e.target.closest('[data-diff-view]');
    if (v) {
      state.chosenView = v.dataset.diffView;
      try {
        localStorage.setItem('lrb:diffView', state.chosenView);
      } catch (err) {}
      render();
      return;
    }
    const gap = e.target.closest('[data-gap]');
    if (gap) {
      state.expanded.add(+gap.dataset.gap);
      render();
    }
  });
  els.unchanged.addEventListener('change', render);
  els.copy.addEventListener('click', async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(location.href);
      ok = true;
    } catch (e) {}
    toast(ok ? '已复制对比链接' : '复制失败，请手动复制地址栏');
  });

  start();
})();
