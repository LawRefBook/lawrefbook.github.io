// 中国法律快查手册 · 网站脚本
// 没有依赖。收藏、最近浏览、搜索历史和显示设置只保存在本机浏览器里（localStorage，键名以 lrb: 开头）

(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const root = document.documentElement;

  // ---------- 本地存储：无痕模式、禁用存储时照常使用，只是不记住 ----------

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('lrb:' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('lrb:' + key, JSON.stringify(value));
      } catch (e) {}
    },
    del(key) {
      try {
        localStorage.removeItem('lrb:' + key);
      } catch (e) {}
    },
  };

  // 外观和字号存原始字符串，<head> 里的脚本在页面显示前读取，避免闪一下
  const raw = {
    get(key) {
      try {
        return localStorage.getItem('lrb:' + key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        if (value == null) localStorage.removeItem('lrb:' + key);
        else localStorage.setItem('lrb:' + key, value);
      } catch (e) {}
    },
  };

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const decode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  };

  const wide = window.matchMedia('(min-width: 1200px)');

  // 比较名称时去掉空格、标点和“中华人民共和国”，“劳动法”能找到《中华人民共和国劳动法》
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[\s《》〈〉“”"'‘’「」『』、，。,.:：;；·()（）[\]【】\-—_]/g, '')
      .replace(/^中华人民共和国/, '');

  const cnDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${+m[1]}年${+m[2]}月${+m[3]}日` : '';
  };

  // ---------- 条号：20、二十、第二十条、20 之一 → 第二十条（之一） ----------

  const DIGITS = '零一二三四五六七八九';

  function toChinese(n) {
    if (!(n > 0) || n > 9999) return '';
    if (n < 10) return DIGITS[n];
    if (n < 20) return '十' + (n % 10 ? DIGITS[n % 10] : '');
    const units = ['', '十', '百', '千'];
    const digits = String(n).split('').map(Number);
    let out = '';
    let zero = false;
    digits.forEach((d, i) => {
      if (d === 0) {
        zero = true;
        return;
      }
      if (zero && out) out += '零';
      zero = false;
      out += DIGITS[d] + units[digits.length - 1 - i];
    });
    return out;
  }

  const CN_NUM = '[零〇一二三四五六七八九十百千]+';
  const ARTICLE_RE = new RegExp(`^第?\\s*(\\d+|${CN_NUM})\\s*条?(?:\\s*之\\s*(\\d+|[一二三四五六七八九十]+))?$`);

  function articleId(input) {
    const m = ARTICLE_RE.exec(String(input || '').trim());
    if (!m) return null;
    const num = /^\d+$/.test(m[1]) ? toChinese(parseInt(m[1], 10)) : m[1].replace(/〇/g, '零');
    if (!num) return null;
    let id = `第${num}条`;
    if (m[2]) id += '之' + (/^\d+$/.test(m[2]) ? toChinese(parseInt(m[2], 10)) : m[2]);
    return id;
  }

  // ---------- 提示、复制 ----------

  let toastTimer = 0;
  function toast(msg) {
    const el = $('[data-toast]');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {}
      ta.remove();
      return ok;
    }
  }

  // ---------- 下拉菜单：外观、历史版本 ----------

  function initDropdowns() {
    const boxes = $$('[data-dropdown]');
    if (!boxes.length) return;

    const close = (box, focus) => {
      const menu = $('[data-dropdown-menu]', box);
      const toggle = $('[data-dropdown-toggle]', box);
      if (menu.hidden) return;
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (focus) toggle.focus();
    };

    const open = (box) => {
      boxes.forEach((b) => b !== box && close(b));
      const menu = $('[data-dropdown-menu]', box);
      const toggle = $('[data-dropdown-toggle]', box);
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      // 菜单超出屏幕时往回挪
      menu.style.transform = '';
      const r = menu.getBoundingClientRect();
      const max = root.clientWidth - 8;
      if (r.right > max) menu.style.transform = `translateX(${max - r.right}px)`;
      else if (r.left < 8) menu.style.transform = `translateX(${8 - r.left}px)`;
      const current = $('[aria-checked="true"], [aria-current="page"]', menu) || $('button, a', menu);
      if (current) current.focus({ preventScroll: true });
    };

    boxes.forEach((box) => {
      const toggle = $('[data-dropdown-toggle]', box);
      const menu = $('[data-dropdown-menu]', box);
      toggle.addEventListener('click', () => (menu.hidden ? open(box) : close(box)));
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          close(box, true);
          return;
        }
        if (menu.hidden || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
        e.preventDefault();
        const items = $$('button, a', menu);
        const i = items.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        items[(next + items.length) % items.length].focus();
      });
      menu.addEventListener('click', (e) => {
        if (e.target.closest('button, a')) close(box);
      });
    });

    document.addEventListener('click', (e) => {
      boxes.forEach((box) => {
        if (!box.contains(e.target)) close(box);
      });
    });
  }

  // ---------- 外观 ----------

  const THEME_ICONS = { auto: '#i-auto', light: '#i-sun', dark: '#i-moon' };

  const currentTheme = () => {
    const t = raw.get('theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  };

  function syncTheme() {
    const t = currentTheme();
    if (t === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
    $$('[data-theme-value]').forEach((b) => {
      const on = b.dataset.themeValue === t;
      if (b.getAttribute('role') === 'menuitemradio') b.setAttribute('aria-checked', String(on));
      else b.setAttribute('aria-pressed', String(on));
    });
    $$('[data-theme-icon]').forEach((use) => use.setAttribute('href', THEME_ICONS[t]));
  }

  function initTheme() {
    syncTheme();
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme-value]');
      if (!b) return;
      raw.set('theme', b.dataset.themeValue === 'auto' ? null : b.dataset.themeValue);
      syncTheme();
    });
  }

  // ---------- 顶部导航 ----------

  function initHeader() {
    const header = $('[data-header]');
    if (!header) return;
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 2);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // 窄屏的菜单
    const toggle = $('[data-menu-toggle]', header);
    const menu = $('[data-mobile-menu]', header);
    if (!toggle || !menu) return;
    const icon = $('[data-menu-icon]', toggle);
    const set = (open) => {
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '关闭菜单' : '菜单');
      icon.setAttribute('href', open ? '#i-x' : '#i-menu');
    };
    toggle.addEventListener('click', () => set(menu.hidden));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        set(false);
        toggle.focus();
      }
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !header.contains(e.target)) set(false);
    });
  }

  function initToTop() {
    const btn = $('[data-to-top]');
    if (!btn) return;
    const onScroll = () => {
      const show = window.scrollY > window.innerHeight * 1.5;
      btn.classList.toggle('is-visible', show);
      btn.tabIndex = show ? 0 : -1;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const target = $('#main');
      if (target) target.focus({ preventScroll: true });
    });
  }

  // ---------- 搜索 ----------

  const BADGES = {
    r: ['已修订', 'revised'],
    e: ['已失效', 'expired'],
    a: ['已废止', 'expired'],
    p: ['未实施', 'pending'],
    u: ['新版待施行', 'pending'],
  };
  const MAX_RESULTS = 60;

  function initSearch() {
    const dialog = $('#search');
    if (!dialog) return null;
    const input = $('#search-input');
    const clearBtn = $('[data-search-clear]', dialog);
    const idle = $('[data-search-idle]', dialog);
    const output = $('[data-search-output]', dialog);
    const list = $('[data-search-results]', dialog);
    const summary = $('[data-search-summary]', dialog);
    const indexURL = document.body.dataset.searchIndex;

    let data = null;
    let loading = null;
    let active = -1;
    let timer = 0;
    let composing = false;
    let lastFocus = null;

    function load() {
      if (data) return Promise.resolve(data);
      if (!loading) {
        loading = fetch(indexURL)
          .then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.json();
          })
          .then((j) => (data = prepare(j)))
          .catch((e) => {
            loading = null;
            throw e;
          });
      }
      return loading;
    }

    function prepare(j) {
      const sections = j.s.map(([name, url, count]) => ({ name, url, count, n: norm(name) }));
      const items = j.i.map(([name, slug, si, st, v, listed, pub]) => {
        const sec = sections[si] || null;
        const href = slug.charAt(0) === '/' || !sec ? slug : sec.url + slug;
        const local = href.indexOf('/docs/dlc/') === 0 ? 2 : href.indexOf('/docs/部门规章/') === 0 ? 1 : 0;
        return { name, href, sec, st, v, listed: !!listed, pub, n: norm(name), sn: sec ? sec.n : '', local };
      });
      return { sections, items };
    }

    // “刑法 第二十条”“刑法第20条”“民法典 1165” → 名称 + 条号。四位数的年份不当作条号
    function parse(value) {
      let text = value.trim();
      let article = null;
      const m = new RegExp(`^(.*?)\\s*第\\s*(\\d+|${CN_NUM})\\s*条(?:\\s*之\\s*(\\d+|[一二三四五六七八九十]+))?$`).exec(text);
      if (m && m[1].trim()) {
        article = articleId(m[2] + (m[3] ? '条之' + m[3] : ''));
        text = m[1].trim();
      } else {
        const m2 = /^(.+?)\s+(\d{1,4})$/.exec(text);
        if (m2 && +m2[2] < 1900) {
          article = articleId(m2[2]);
          text = m2[1].trim();
        }
      }
      return { raw: text, q: norm(text), tokens: text.split(/\s+/).map(norm).filter(Boolean), article };
    }

    function score(it, p) {
      const n = it.n;
      let s;
      if (n === p.q) s = 1000;
      else if (n.indexOf(p.q) === 0) s = 800 - (n.length - p.q.length) * 0.5;
      else {
        const i = n.indexOf(p.q);
        if (i >= 0) s = 600 - Math.min(i, 40) * 2 - (n.length - p.q.length) * 0.5;
        else if (p.tokens.length > 1) {
          const hay = n + '|' + it.sn;
          if (!p.tokens.every((t) => hay.indexOf(t) !== -1)) return -1;
          s = 400 - n.length * 0.5;
        } else return -1;
      }
      if (it.listed) s += 120;
      if (it.st === 'r' || it.st === 'e' || it.st === 'a') s -= 150;
      return s - it.local * 25;
    }

    function highlight(name, p) {
      const tokens = p.raw
        .split(/\s+/)
        .map((t) => t.replace(/^中华人民共和国/, '').replace(/[《》]/g, ''))
        .filter(Boolean);
      if (!tokens.length) return esc(name);
      const re = new RegExp(tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
      let out = '';
      let last = 0;
      let m;
      while ((m = re.exec(name))) {
        if (!m[0]) {
          re.lastIndex++;
          continue;
        }
        out += esc(name.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
        last = m.index + m[0].length;
      }
      return out + esc(name.slice(last));
    }

    function rowHTML(r, p, i) {
      const id = `sr-${i}`;
      if (r.type === 'jump') {
        return `<li class="row" role="option" id="${id}"><a class="row-link" href="#${encodeURIComponent(r.id)}"><span class="row-title">跳到本法${esc(r.id)}</span><span class="row-meta">${esc(r.title)}</span></a></li>`;
      }
      if (r.type === 'section') {
        const s = r.section;
        return `<li class="row" role="option" id="${id}"><a class="row-link" href="${esc(s.url)}"><span class="row-title">${highlight(s.name, p)}</span><span class="row-meta">分类 · ${s.count} 部</span></a></li>`;
      }
      const it = r.item;
      const badge = BADGES[it.st];
      const struck = it.st === 'r' || it.st === 'e' || it.st === 'a';
      const version = !it.listed && it.pub ? cnDate(it.pub) + '版' : it.v > 1 ? `${it.v} 个版本` : '';
      const meta = [it.sec ? it.sec.name : '', version, p.article ? `打开后跳到${p.article}` : ''].filter(Boolean).join(' · ');
      const href = it.href + (p.article ? '#' + encodeURIComponent(p.article) : '');
      return (
        `<li class="row" role="option" id="${id}"><a class="row-link" href="${esc(href)}"><span class="row-main">` +
        `<span class="row-title${struck ? ' is-struck' : ''}">${highlight(it.name, p)}</span>` +
        (badge ? `<span class="badge badge--${badge[1]}">${badge[0]}</span>` : '') +
        `</span>${meta ? `<span class="row-meta">${esc(meta)}</span>` : ''}</a></li>`
      );
    }

    function run() {
      const value = input.value;
      clearBtn.hidden = !value;
      if (!value.trim()) return showIdle();

      idle.hidden = true;
      output.hidden = false;
      if (!data) {
        summary.textContent = '正在加载…';
        list.innerHTML = '';
        load().then(run, () => {
          summary.textContent = '加载失败，请检查网络后重试';
        });
        return;
      }

      const p = parse(value);
      const results = [];

      // 在法律页面里只输入条号：跳到本法这一条
      const law = $('[data-law]');
      const own = articleId(value);
      if (law && own && document.getElementById(own)) results.push({ type: 'jump', id: own, title: law.dataset.title });

      if (p.q) {
        if (!p.article) {
          data.sections
            .filter((s) => s.n.indexOf(p.q) !== -1)
            .slice(0, 3)
            .forEach((section) => results.push({ type: 'section', section }));
        }
        const hits = [];
        for (const item of data.items) {
          const s = score(item, p);
          if (s >= 0) hits.push([s, item]);
        }
        hits.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length);
        hits.slice(0, MAX_RESULTS).forEach(([, item]) => results.push({ type: 'law', item }));
        const total = hits.length;
        summary.textContent = total ? (total > MAX_RESULTS ? `找到 ${total} 部，显示前 ${MAX_RESULTS} 部` : `找到 ${total} 部`) : '';
      } else {
        summary.textContent = '';
      }

      if (!results.length) {
        list.innerHTML = `<li class="empty"><p>没有找到“${esc(value.trim())}”</p><p>试试更短的关键字，比如只输入“劳动”。</p></li>`;
        active = -1;
        input.removeAttribute('aria-activedescendant');
        return;
      }
      list.innerHTML = results.map((r, i) => rowHTML(r, p, i)).join('');
      setActive(0, true);
    }

    function setActive(i, quiet) {
      const links = $$('.row-link', list);
      if (!links.length) {
        active = -1;
        return;
      }
      active = (i + links.length) % links.length;
      links.forEach((a, j) => a.classList.toggle('is-active', j === active));
      input.setAttribute('aria-activedescendant', `sr-${active}`);
      if (!quiet) links[active].scrollIntoView({ block: 'nearest' });
    }

    function remember(q) {
      q = q.trim();
      if (!q) return;
      const h = store.get('history', []).filter((x) => x !== q);
      h.unshift(q);
      store.set('history', h.slice(0, 10));
    }

    function showIdle() {
      idle.hidden = false;
      output.hidden = true;
      active = -1;
      input.removeAttribute('aria-activedescendant');
      const history = store.get('history', []);
      const recent = store.get('recent', []).slice(0, 6);
      $('[data-search-history]', dialog).hidden = !history.length;
      $('[data-history-list]', dialog).innerHTML = history
        .map(
          (q) =>
            `<button class="btn btn--sm" type="button" data-q="${esc(q)}"><svg class="i i-sm" aria-hidden="true"><use href="#i-history"/></svg><span>${esc(q)}</span></button>`
        )
        .join('');
      $('[data-search-recent]', dialog).hidden = !recent.length;
      $('[data-recent-list]', dialog).innerHTML = recent.map((x) => savedRowHTML(x)).join('');
      $('[data-search-tips]', dialog).hidden = history.length > 0 || recent.length > 0;
    }

    function open(q) {
      if (!dialog.open) {
        lastFocus = document.activeElement;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        root.style.overflow = 'hidden';
      }
      if (typeof q === 'string') input.value = q;
      input.focus();
      if (typeof q !== 'string') input.select();
      load().catch(() => {});
      run();
    }

    function close() {
      if (!dialog.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }

    dialog.addEventListener('close', () => {
      root.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close();
    });

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(run, 60);
    };
    // 中文输入法拼写过程中不搜索，选好字以后再搜
    input.addEventListener('compositionstart', () => (composing = true));
    input.addEventListener('compositionend', () => {
      composing = false;
      schedule();
    });
    input.addEventListener('input', (e) => {
      clearBtn.hidden = !input.value;
      if (!composing && !e.isComposing) schedule();
    });

    const go = (a) => {
      remember(input.value);
      const url = new URL(a.href, location.href);
      if (url.pathname === location.pathname) close();
      location.href = url.href;
    };

    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(active + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(active - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(timer);
        const pick = () => {
          run();
          const links = $$('.row-link', list);
          const a = links[active] || links[0];
          if (a) go(a);
        };
        if (data) pick();
        else load().then(pick, () => {});
      }
    });

    list.addEventListener('click', (e) => {
      const a = e.target.closest('a.row-link');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      go(a);
    });
    $('[data-recent-list]', dialog).addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a && new URL(a.href, location.href).pathname === location.pathname) close();
    });
    $('[data-history-list]', dialog).addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]');
      if (!b) return;
      input.value = b.dataset.q;
      input.focus();
      run();
    });
    $('[data-history-clear]', dialog).addEventListener('click', () => {
      store.del('history');
      showIdle();
      input.focus();
    });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.hidden = true;
      showIdle();
      input.focus();
    });
    $('[data-search-close]', dialog).addEventListener('click', close);

    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-open-search]');
      if (!b) return;
      e.preventDefault();
      open();
    });
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        open();
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !dialog.open) {
        e.preventDefault();
        open();
      }
    });

    // 正文里引用的法律：名称完全一样的直接打开，找不到时打开搜索
    function resolve(name) {
      return load().then((d) => {
        const n = norm(name);
        const hits = d.items.filter((it) => it.n === n).sort((a, b) => b.listed - a.listed || a.local - b.local);
        if (hits.length) return hits[0].href;
        const section = d.sections.find((s) => s.n === n);
        return section ? section.url : null;
      });
    }

    // ?q=劳动合同法 打开就搜索：搜索链接可以分享，搜索引擎也能直接跳到站内搜索
    const initial = new URLSearchParams(location.search).get('q');
    if (initial) open(initial);

    return { open, resolve };
  }

  // ---------- 收藏、最近浏览 ----------

  function savedRowHTML(x) {
    return (
      `<li class="row"><a class="row-link" href="${esc(x.h)}"><span class="row-title">${esc(x.t)}</span>` +
      `${x.s ? `<span class="row-date">${esc(x.s)}</span>` : ''}</a></li>`
    );
  }

  function lawEntry() {
    const law = $('[data-law]');
    if (!law) return null;
    return { h: location.pathname, t: law.dataset.name || law.dataset.title, s: law.dataset.section };
  }

  function collapse(ul, n) {
    const items = $$(':scope > li', ul);
    if (items.length <= n + 1) return;
    items.slice(n).forEach((li) => (li.hidden = true));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'more';
    btn.textContent = `显示全部 ${items.length} 部`;
    btn.addEventListener('click', () => {
      items.forEach((li) => (li.hidden = false));
      btn.remove();
    });
    ul.after(btn);
  }

  function initHome() {
    const favSection = $('[data-fav-section]');
    if (!favSection) return;

    const favs = store.get('fav', []);
    if (favs.length) {
      favSection.hidden = false;
      const ul = $('[data-fav-list]');
      ul.innerHTML = favs.map(savedRowHTML).join('');
      collapse(ul, 5);
    }

    const recent = store.get('recent', []).slice(0, 5);
    const recentSection = $('[data-recent-section]');
    if (recent.length) {
      recentSection.hidden = false;
      $('[data-recent-home]').innerHTML = recent.map(savedRowHTML).join('');
    }
    $('[data-recent-clear]').addEventListener('click', () => {
      store.del('recent');
      recentSection.hidden = true;
    });
  }

  function initTabs() {
    $$('[data-tabs]').forEach((box) => {
      const tabs = $$('[role="tab"]', box);
      const select = (tab) =>
        tabs.forEach((t) => {
          const on = t === tab;
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1;
          const panel = document.getElementById(t.getAttribute('aria-controls'));
          if (panel) panel.hidden = !on;
        });
      tabs.forEach((tab, i) => {
        tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
        tab.addEventListener('click', () => select(tab));
        tab.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
          select(next);
          next.focus();
        });
      });
    });
  }

  // ---------- 分类页筛选 ----------

  function initFilter(search) {
    const input = $('[data-filter-input]');
    const list = $('[data-filter-list]');
    if (!input || !list) return;
    const rows = $$(':scope > li', list).map((li) => ({ li, n: norm(li.dataset.n), old: li.hasAttribute('data-old') }));
    const empty = $('[data-filter-empty]');
    const clear = $('[data-filter-clear]');
    // “只看现行”：隐藏已失效、已废止的，记在本机，下次打开分类时还是这样
    const current = $('[data-filter-current]');
    if (current) current.checked = raw.get('currentOnly') === '1';
    let composing = false;

    const apply = () => {
      const q = input.value.trim();
      const tokens = q.split(/\s+/).map(norm).filter(Boolean);
      const currentOnly = !!current && current.checked;
      let shown = 0;
      rows.forEach((r) => {
        const ok = !(currentOnly && r.old) && tokens.every((t) => r.n.indexOf(t) !== -1);
        r.li.hidden = !ok;
        if (ok) shown++;
      });
      clear.hidden = !q;
      empty.hidden = shown > 0;
      if (!shown) {
        const query = $('[data-filter-query]', empty);
        query.textContent = q;
        query.parentElement.hidden = !q;
        $('[data-filter-current-note]', empty).hidden = !currentOnly;
      }
    };

    input.addEventListener('compositionstart', () => (composing = true));
    input.addEventListener('compositionend', () => {
      composing = false;
      apply();
    });
    input.addEventListener('input', (e) => {
      if (!composing && !e.isComposing) apply();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        input.value = '';
        apply();
      }
    });
    clear.addEventListener('click', () => {
      input.value = '';
      apply();
      input.focus();
    });
    if (current) {
      current.addEventListener('change', () => {
        raw.set('currentOnly', current.checked ? '1' : null);
        apply();
      });
      if (current.checked) apply();
    }
    const more = $('[data-filter-search]');
    if (more && search) more.addEventListener('click', () => search.open(input.value.trim()));
  }

  // ---------- 法律正文 ----------

  function flashTarget() {
    const id = decode(location.hash.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (!el || !el.classList.contains('art')) return;
    el.classList.remove('is-target');
    void el.offsetWidth;
    el.classList.add('is-target');
  }

  function goToArticle(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (decode(location.hash.slice(1)) === id) {
      el.scrollIntoView();
      flashTarget();
    } else {
      location.hash = id;
    }
  }

  // 开头的信息很长时（比如修改过十几次），只显示第一条和最后两条，其余收起
  function initInfo() {
    const info = $('.law-info');
    if (!info) return;
    const lines = $$(':scope > p', info);
    if (lines.length <= 4) return;
    const hidden = lines.slice(1, lines.length - 2);
    hidden.forEach((p) => (p.hidden = true));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn info-more';
    btn.textContent = `⋯ 显示全部 ${lines.length} 条`;
    btn.addEventListener('click', () => {
      hidden.forEach((p) => (p.hidden = false));
      btn.remove();
    });
    lines[0].after(btn);
  }

  function initFavorite() {
    const btn = $('[data-fav]');
    const entry = lawEntry();
    if (!btn || !entry) return;
    const label = $('[data-fav-label]', btn);
    const isOn = () => store.get('fav', []).some((x) => x.h === entry.h);
    const sync = () => {
      const on = isOn();
      btn.setAttribute('aria-pressed', String(on));
      label.textContent = on ? '已收藏' : '收藏';
    };
    sync();
    btn.addEventListener('click', () => {
      const on = isOn();
      const list = store.get('fav', []).filter((x) => x.h !== entry.h);
      if (!on) list.unshift(Object.assign({ at: Date.now() }, entry));
      store.set('fav', list);
      sync();
      toast(on ? '已取消收藏' : '已收藏，可以在首页找到');
    });
  }

  function recordRecent() {
    const entry = lawEntry();
    if (!entry) return;
    const list = store.get('recent', []).filter((x) => x.h !== entry.h);
    list.unshift(Object.assign({ at: Date.now() }, entry));
    store.set('recent', list.slice(0, 20));
  }

  function initShare() {
    const btn = $('[data-share]');
    if (!btn) return;
    // 触屏设备用系统的分享，其他复制链接
    const canShare = typeof navigator.share === 'function' && window.matchMedia('(hover: none)').matches;
    if (canShare) {
      $('[data-share-label]', btn).textContent = '分享';
      $('use', btn).setAttribute('href', '#i-share');
    }
    btn.addEventListener('click', async () => {
      const law = $('[data-law]');
      const url = location.origin + location.pathname;
      if (canShare) {
        try {
          await navigator.share({ title: law.dataset.title, url });
        } catch (e) {}
        return;
      }
      toast((await copyText(url)) ? '已复制链接' : '复制失败，请手动复制地址栏');
    });
  }

  // 正文字号：默认 18px，同 App
  const SIZES = [14, 15, 16, 17, 18, 20, 22, 24, 26];
  const DEFAULT_SIZE = 18;

  const currentSize = () => {
    const f = parseInt(raw.get('fs'), 10);
    return SIZES.indexOf(f) === -1 ? DEFAULT_SIZE : f;
  };

  // 字号变了以后停在原来读到的那一段
  function keepReadingPosition(change) {
    const body = $('[data-law-body]');
    if (!body) return change();
    let anchor = null;
    for (const el of body.children) {
      if (el.getBoundingClientRect().bottom > 120) {
        anchor = el;
        break;
      }
    }
    const before = anchor ? anchor.getBoundingClientRect().top : 0;
    change();
    if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - before);
  }

  function initFontSize() {
    const buttons = $$('[data-font-step]');
    if (!buttons.length) return;
    const sync = () => {
      const f = currentSize();
      buttons.forEach((b) => {
        const step = Number(b.dataset.fontStep);
        b.disabled = step < 0 ? f === SIZES[0] : f === SIZES[SIZES.length - 1];
      });
    };
    sync();
    buttons.forEach((b) =>
      b.addEventListener('click', () => {
        const i = SIZES.indexOf(currentSize()) + Number(b.dataset.fontStep);
        if (i < 0 || i >= SIZES.length) return;
        const size = SIZES[i];
        keepReadingPosition(() => {
          if (size === DEFAULT_SIZE) root.style.removeProperty('--law-fs');
          else root.style.setProperty('--law-fs', size + 'px');
        });
        raw.set('fs', size === DEFAULT_SIZE ? null : String(size));
        sync();
        toast(size === DEFAULT_SIZE ? `正文字号 ${size}（默认）` : `正文字号 ${size}`);
      })
    );
  }

  function initToc() {
    const toc = $('[data-toc]');
    if (!toc) return;
    const toggle = $('[data-toc-toggle]', toc);
    const panel = $('[data-toc-panel]', toc);
    const body = $('[data-toc-body]', toc);
    const label = $('[data-toc-current]', toc);
    const links = $$('[data-toc-link]', toc);

    const reveal = (el) => {
      const br = panel.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.top < br.top + 8 || r.bottom > br.bottom - 8) panel.scrollTop += r.top - br.top - br.height / 3;
    };

    // 窄屏：目录是吸顶条下面的下拉
    const setOpen = (open) => {
      toc.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open && current) reveal(current);
    };
    toggle.addEventListener('click', () => setOpen(!toc.classList.contains('is-open')));
    document.addEventListener('click', (e) => {
      if (toc.classList.contains('is-open') && !toc.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && toc.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });

    const setCollapsed = (node, collapsed) => {
      node.classList.toggle('is-collapsed', collapsed);
      const t = $(':scope > .toc-item .toc-toggle', node);
      if (t) {
        t.setAttribute('aria-expanded', String(!collapsed));
        t.setAttribute('aria-label', collapsed ? '展开' : '折叠');
      }
    };

    body.addEventListener('click', (e) => {
      const t = e.target.closest('.toc-toggle');
      if (t) {
        const node = t.closest('.toc-node');
        setCollapsed(node, !node.classList.contains('is-collapsed'));
        return;
      }
      if (e.target.closest('[data-toc-link]') && !wide.matches) setOpen(false);
    });

    // 目录很长时（比如分编、章、节的法律）先收起，读到哪里展开到哪里
    if (links.length > 50) {
      $$('.toc-node', toc).forEach((node) => {
        if ($(':scope > .toc-list', node)) setCollapsed(node, true);
      });
    }
    requestAnimationFrame(() => toc.classList.add('is-ready'));

    const pairs = links.map((a) => [document.getElementById(decode(a.hash.slice(1))), a]).filter((p) => p[0]);
    let current = null;
    let ticking = false;
    const spy = () => {
      ticking = false;
      const line = toc.getBoundingClientRect().bottom + 24;
      let found = null;
      let lo = 0;
      let hi = pairs.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pairs[mid][0].getBoundingClientRect().top <= (wide.matches ? 120 : line)) {
          found = pairs[mid][1];
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (found === current) return;
      if (current) current.classList.remove('is-active');
      current = found;
      label.textContent = current ? current.textContent.trim() : '';
      if (!current) return;
      current.classList.add('is-active');
      let node = current.closest('.toc-node');
      while (node) {
        const parent = node.parentElement.closest('.toc-node');
        if (parent && parent.classList.contains('is-collapsed')) setCollapsed(parent, false);
        node = parent;
      }
      if (wide.matches || toc.classList.contains('is-open')) reveal(current);
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(spy);
        }
      },
      { passive: true }
    );
    spy();

    const form = $('[data-jump]', toc);
    if (form) {
      const msg = $('[data-jump-msg]', toc);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const field = $('input', form);
        const id = articleId(field.value);
        if (!id || !document.getElementById(id)) {
          msg.hidden = false;
          msg.textContent = id ? `本法没有${id}` : '请输入条号，比如 20 或 二十';
          return;
        }
        msg.hidden = true;
        field.value = '';
        field.blur();
        setOpen(false);
        goToArticle(id);
      });
    }
  }

  // 点条号：复制这一条（款也一起）或复制链接
  function articleText(p, title) {
    const parts = [p.textContent.trim()];
    let el = p.nextElementSibling;
    while (el && !el.classList.contains('art') && !/^H[1-6]$/.test(el.tagName)) {
      const t = el.textContent.trim();
      if (t) parts.push(t);
      el = el.nextElementSibling;
    }
    return `《${title}》${parts.join('\n')}`;
  }

  function initArticles() {
    const body = $('[data-law-body]');
    const law = $('[data-law]');
    if (!body || !law) return;
    let menu = null;
    let current = null;

    const close = () => {
      if (menu) menu.remove();
      menu = null;
      current = null;
    };

    body.addEventListener('click', (e) => {
      const a = e.target.closest('.art-no');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      const p = a.closest('.art');
      if (current === p) return close();
      close();
      current = p;
      const id = p.id;
      history.replaceState(null, '', '#' + encodeURIComponent(id));

      menu = document.createElement('div');
      menu.className = 'art-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', id);
      menu.innerHTML =
        '<button type="button" role="menuitem" data-act="text"><svg class="i i-sm" aria-hidden="true"><use href="#i-copy"/></svg>复制本条</button>' +
        '<button type="button" role="menuitem" data-act="link"><svg class="i i-sm" aria-hidden="true"><use href="#i-link"/></svg>复制链接</button>';
      document.body.appendChild(menu);
      const r = a.getBoundingClientRect();
      const above = r.top - menu.offsetHeight - 8;
      menu.style.top = (above < 110 ? r.bottom + 8 : above) + window.scrollY + 'px';
      menu.style.left = Math.max(8, Math.min(r.left, root.clientWidth - menu.offsetWidth - 8)) + window.scrollX + 'px';

      menu.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-act]');
        if (!b) return;
        const url = location.origin + location.pathname + '#' + encodeURIComponent(id);
        const isText = b.dataset.act === 'text';
        const ok = await copyText(isText ? articleText(p, law.dataset.title) : url);
        toast(ok ? (isText ? `已复制${id}` : '已复制链接') : '复制失败');
        close();
        a.focus({ preventScroll: true });
      });
      menu.addEventListener('keydown', (ev) => {
        const buttons = $$('button', menu);
        const i = buttons.indexOf(document.activeElement);
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
          ev.preventDefault();
          buttons[(i + (ev.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
        } else if (ev.key === 'Escape') {
          close();
          a.focus({ preventScroll: true });
        }
      });
      $('button', menu).focus({ preventScroll: true });
    });

    document.addEventListener('click', (e) => {
      if (menu && !menu.contains(e.target) && !e.target.closest('.art-no')) close();
    });
    window.addEventListener('resize', close);
  }

  // 正文里引用的其他法律《……》可以点开，和 App 一样
  function initReferences(search) {
    const body = $('[data-law-body]');
    const law = $('[data-law]');
    if (!body || !law || !search) return;
    const self = new Set([norm(law.dataset.title), norm(law.dataset.name)]);

    const linkify = () => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          n.nodeValue.indexOf('《') !== -1 && !n.parentElement.closest('a, .ref, h2, h3, h4, h5')
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT,
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const re = /《([^《》\n]{2,80}?)》/g;
      nodes.forEach((node) => {
        const text = node.nodeValue;
        const frag = document.createDocumentFragment();
        let last = 0;
        let changed = false;
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(text))) {
          if (self.has(norm(m[1]))) continue;
          frag.appendChild(document.createTextNode(text.slice(last, m.index + 1)));
          const span = document.createElement('span');
          span.className = 'ref';
          span.tabIndex = 0;
          span.setAttribute('role', 'link');
          span.title = '打开这部法律';
          span.dataset.ref = m[1];
          span.textContent = m[1];
          frag.appendChild(span);
          last = m.index + m[0].length - 1;
          changed = true;
        }
        if (!changed) return;
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
    };
    (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(linkify);

    const follow = (el) => {
      const name = el.dataset.ref;
      search.resolve(name).then(
        (href) => (href ? (location.href = href) : search.open(name)),
        () => search.open(name)
      );
    };
    body.addEventListener('click', (e) => {
      const ref = e.target.closest('.ref');
      if (ref && !String(window.getSelection())) follow(ref);
    });
    body.addEventListener('keydown', (e) => {
      const ref = e.target.closest('.ref');
      if (ref && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        follow(ref);
      }
    });
  }

  function initLaw(search) {
    if (!$('[data-law]')) return;
    initInfo();
    recordRecent();
    initFavorite();
    initShare();
    initFontSize();
    initToc();
    initArticles();
    initReferences(search);
    const print = $('[data-print]');
    if (print) print.addEventListener('click', () => window.print());
    flashTarget();
    window.addEventListener('hashchange', flashTarget);
  }

  // ---------- 启动 ----------

  const search = initSearch();
  initTheme();
  initDropdowns();
  initHeader();
  initToTop();
  initHome();
  initTabs();
  $$('[data-collapse]').forEach((ul) => collapse(ul, +ul.dataset.collapse || 5));
  initFilter(search);
  initLaw(search);
})();
