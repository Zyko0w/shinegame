import { progress } from '../core/progress.js';
import { islandSVG } from './islandPreview.js';
import { paletteOf } from '../game/moods.js';
import { CURIOS, GEMS, countObjects } from '../game/tiles.js';

// Couche DOM : écrans, menu d'accueil, HUD, toasts, bannières. Aucune logique
// de jeu ici, uniquement de l'affichage piloté par main.js via des callbacks.

const GEM_SVG = `
  <svg viewBox="0 0 22 26" aria-hidden="true">
    <path class="g-fill" d="M11 1 L21 10 L11 25 L1 10 Z" />
    <path class="g-outline" d="M11 1 L21 10 L11 25 L1 10 Z M1 10 H21 M7 10 L11 1 L15 10 L11 25" />
  </svg>`;
const LOCK_SVG = '<svg class="level-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

// 83.4 → « 1:23 »
export function fmtTime(sec) {
  if (sec == null) return '—';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Positions des îles sur la carte (en %), en forme de constellation sinueuse
function constellation(n) {
  const portrait = window.innerWidth < 760;
  return Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const wave = (i % 2 ? -1 : 1) * 15 + Math.sin(i * 1.7) * 4;
    return portrait ? { x: 50 + wave * 1.5, y: 7 + t * 78 } : { x: 9 + t * 82, y: 52 + wave };
  });
}

export class UI {
  constructor(handlers, levels) {
    this.h = handlers;
    this.levels = levels;
    this.el = {
      title: $('title'),
      hud: $('hud'),
      dock: $('dock'),
      hudIndex: $('hud-index'),
      hudName: $('hud-name'),
      hudSub: $('hud-sub'),
      hudGems: $('hud-gems'),
      steps: $('steps'),
      timer: $('timer'),
      hudCurios: $('hud-curios'),
      curiosN: $('curios-n'),
      mirrorVeil: $('mirror-veil'),
      mirrorBadge: $('mirror-badge'),
      toast: $('toast'),
      banner: $('banner'),
      bannerIndex: $('banner-index'),
      bannerName: $('banner-name'),
      bannerSub: $('banner-sub'),
      pause: $('pause'),
      complete: $('complete'),
      completeTitle: $('complete-title'),
      resultGems: $('result-gems'),
      statGems: $('stat-gems'),
      statSteps: $('stat-steps'),
      statTime: $('stat-time'),
      statCurios: $('stat-curios'),
      recSteps: $('rec-steps'),
      recTime: $('rec-time'),
      statsBest: $('stats-best'),
      btnNext: $('btn-next'),
      fade: $('fade'),
      soundBtn: $('btn-sound'),
      levels: $('levels'),
      levelGrid: $('level-grid'),
      credits: $('credits'),
    };

    // Dégradé partagé par toutes les icônes de cristal
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs.setAttribute('width', '0');
    defs.setAttribute('height', '0');
    defs.style.position = 'absolute';
    defs.innerHTML = `<defs><linearGradient id="gemGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e9fdff"/><stop offset=".45" stop-color="#79f2ff"/><stop offset="1" stop-color="#3a8cff"/>
    </linearGradient></defs>`;
    document.body.prepend(defs);

    const on = (id, fn) =>
      $(id).addEventListener('click', (e) => {
        e.currentTarget.blur();
        fn();
      });
    on('btn-sound', () => this.h.toggleSound());
    on('btn-pause', () => this.h.pause());
    on('btn-resume', () => this.h.resume());
    on('btn-restart', () => this.h.restart());
    on('btn-quit', () => this.h.quit());
    on('btn-replay', () => this.h.restart());
    on('btn-next', () => this.h.next());
    on('btn-rot-left', () => this.h.rotate(-1));
    on('btn-rot-right', () => this.h.rotate(1));
    on('btn-recenter', () => this.h.recenter());
    on('btn-settings-dock', () => this.h.openSettings());
    on('btn-settings-pause', () => this.h.openSettings());
    on('btn-settings-close', () => this.h.closeSettings());
    on('btn-settings-done', () => this.h.closeSettings());
    on('btn-levels-close', () => this.closeLevels());
    on('btn-credits-close', () => this.closeCredits());

    this.initMenu();

    // Petit son au survol des boutons
    document.querySelectorAll('#ui button').forEach((b) => b.addEventListener('pointerenter', () => this.h.hoverSound?.()));
  }

  /* ───────────── Menu d'accueil ───────────── */

  initMenu() {
    const actions = {
      'menu-continue': () => this.h.continueGame(),
      'menu-new': () => this.confirmNewGame(),
      'menu-levels': () => this.openLevels(),
      'menu-settings': () => this.h.openSettings(),
      'menu-credits': () => this.openCredits(),
    };
    this.menuItems = [...document.querySelectorAll('#main-menu .menu-item')];
    this.menuIndex = 0;
    for (const item of this.menuItems) {
      item.addEventListener('click', () => {
        this.h.clickSound?.();
        actions[item.id]();
      });
      item.addEventListener('pointerenter', () => this.selectMenu(this.visibleMenuItems().indexOf(item), false));
      item.addEventListener('focus', () => this.selectMenu(this.visibleMenuItems().indexOf(item), false));
    }
  }

  visibleMenuItems() {
    return this.menuItems.filter((i) => !i.parentElement.hidden);
  }

  selectMenu(index, focus = true) {
    const items = this.visibleMenuItems();
    if (!items.length) return;
    this.menuIndex = (index + items.length) % items.length;
    const target = items[this.menuIndex];
    for (const i of this.menuItems) i.classList.toggle('is-selected', i === target);
    if (focus && document.activeElement !== target) target.focus({ preventScroll: true });
  }

  // Navigation clavier du menu : renvoie true si la touche a été consommée
  menuKey(e) {
    if (!this.el.title.classList.contains('is-visible') || this.modalOpen()) return false;
    const items = this.visibleMenuItems();
    const cur = items.indexOf(document.activeElement);
    const idx = cur >= 0 ? cur : items.findIndex((i) => i.classList.contains('is-selected'));
    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      this.selectMenu(idx + 1);
      this.h.hoverSound?.();
      return true;
    }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      this.selectMenu(idx - 1);
      this.h.hoverSound?.();
      return true;
    }
    if ((e.code === 'Enter' || e.code === 'Space') && document.activeElement?.tagName !== 'BUTTON') {
      items[Math.max(0, idx)]?.click();
      return true;
    }
    return false;
  }

  refreshMenu() {
    const hasSave = progress.hasSave;
    $('menu-continue').parentElement.hidden = !hasSave;
    if (hasSave) {
      const i = Math.min(progress.data.last, this.levels.length - 1);
      $('menu-continue-sub').textContent = `${pad(i + 1)} · ${this.levels[i].name}`;
    }
    const done = this.levels.filter((l) => progress.level(l.id).done).length;
    $('menu-levels-sub').textContent = `${done}/${this.levels.length}`;
    $('menu-new').querySelector('.menu-label').textContent = 'Nouvelle partie';
    this.newGameArmed = false;
  }

  // « Nouvelle partie » efface la progression : on demande un second appui
  confirmNewGame() {
    if (!progress.hasSave || this.newGameArmed) {
      this.newGameArmed = false;
      this.h.newGame();
      return;
    }
    this.newGameArmed = true;
    const label = $('menu-new').querySelector('.menu-label');
    label.textContent = 'Effacer la progression ?';
    clearTimeout(this.armTimer);
    this.armTimer = setTimeout(() => {
      this.newGameArmed = false;
      label.textContent = 'Nouvelle partie';
    }, 3000);
  }

  showTitle(v) {
    this.setVisible(this.el.title, v);
    if (v) {
      this.refreshMenu();
      setTimeout(() => this.selectMenu(0, !matchMedia('(hover: none)').matches), 700);
    }
  }

  /* ───────────── Niveaux & crédits ───────────── */

  // Carte des constellations : chaque île est une étoile de la constellation,
  // avec sa miniature isométrique aux couleurs de son émotion.
  openLevels() {
    const nodes = this.el.levelGrid;
    const lines = $('starmap-lines');
    nodes.innerHTML = '';
    const pos = constellation(this.levels.length);
    // tracé de la constellation (lignes dorées entre îles débloquées)
    lines.innerHTML = pos
      .slice(1)
      .map((p, k) => {
        const a = pos[k];
        const lit = progress.isUnlocked(k + 1);
        return `<line x1="${a.x}" y1="${a.y}" x2="${p.x}" y2="${p.y}" class="${lit ? 'lit' : ''}" vector-effect="non-scaling-stroke"/>`;
      })
      .join('');

    this.levels.forEach((def, i) => {
      const p = progress.level(def.id);
      const unlocked = progress.isUnlocked(i);
      const palette = paletteOf(def.mood);
      const node = document.createElement('button');
      node.type = 'button';
      node.className = `sm-node${unlocked ? '' : ' is-locked'}${p.done ? ' is-done' : ''}`;
      node.style.setProperty('--x', `${pos[i].x}%`);
      node.style.setProperty('--y', `${pos[i].y}%`);
      node.style.setProperty('--mood', palette.accent);
      node.style.setProperty('--delay', `${i * 0.08}s`);
      node.setAttribute('aria-label', `${def.chapter} — ${def.name}${unlocked ? '' : ', verrouillé'}`);
      node.innerHTML = `
        <span class="sm-island">${islandSVG(def, palette)}</span>
        <span class="sm-star" aria-hidden="true"></span>
        <span class="sm-label"><span class="sm-num">${pad(i + 1)}</span>${def.name}</span>
        ${unlocked ? '' : LOCK_SVG}`;
      const select = () => this.showLevelInfo(i);
      node.addEventListener('pointerenter', () => {
        select();
        this.h.hoverSound?.();
      });
      node.addEventListener('focus', select);
      node.addEventListener('click', () => {
        if (!unlocked) return this.showLevelInfo(i, true);
        this.closeLevels(false);
        this.h.playLevel(i);
      });
      nodes.appendChild(node);
    });
    $('si-play').onclick = () => {
      if (!progress.isUnlocked(this.levelInfo)) return;
      this.closeLevels(false);
      this.h.playLevel(this.levelInfo);
    };
    this.setVisible(this.el.levels, true);
    // on se place sur le dernier chapitre accessible
    const current = Math.min(progress.data.unlocked, this.levels.length) - 1;
    this.showLevelInfo(current);
    setTimeout(() => nodes.children[current]?.focus({ preventScroll: true }), 80);
  }

  showLevelInfo(i, nudge = false) {
    this.levelInfo = i;
    const def = this.levels[i];
    const palette = paletteOf(def.mood);
    const p = progress.level(def.id);
    const unlocked = progress.isUnlocked(i);
    const total = countObjects(def, GEMS);
    const [chapter] = def.chapter.split('·');
    $('si-chapter').textContent = chapter.trim();
    $('si-emotion').textContent = palette.label;
    $('si-name').textContent = def.name;
    $('si-tagline').textContent = unlocked ? palette.tagline : 'Récupère la gemme du chapitre précédent pour rejoindre cette île.';
    const gems = Array.from({ length: total }, (_, g) => `<span class="gem-slot${g < p.gems ? ' is-filled' : ''}">${GEM_SVG}</span>`).join('');
    $('si-meta').innerHTML = `${gems}<span class="si-state${p.done ? ' done' : ''}">${p.done ? 'gemme récupérée' : unlocked ? 'à explorer' : 'verrouillée'}</span>`;
    // statistiques du niveau, une fois terminé au moins une fois
    const curioTotal = countObjects(def, CURIOS);
    const cell = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    $('si-stats').innerHTML = p.done
      ? [
          cell('meilleur temps', fmtTime(p.time)),
          cell('moins de pas', p.steps ?? '—'),
          cell('cristaux', `${p.gems}/${total}`),
          cell('curiosités', `${p.curios.length}/${curioTotal}`),
          ...(p.runs > 1 ? [cell('parties finies', p.runs)] : []),
          ...(p.last ? [cell('dernière partie', `${fmtTime(p.last.time)} · ${p.last.steps} pas`)] : []),
        ].join('')
      : '';
    if (p.wish) $('si-stats').insertAdjacentHTML('beforeend', `<div class="si-wish"><dt>ton vœu</dt><dd></dd></div>`);
    if (p.wish) $('si-stats').querySelector('.si-wish dd').textContent = `« ${p.wish} »`;
    const info = $('starmap-info');
    info.style.setProperty('--mood', palette.accent);
    info.classList.toggle('is-locked', !unlocked);
    $('si-play').disabled = !unlocked;
    this.el.levels.style.setProperty('--mood', palette.accent);
    for (const [k, n] of [...this.el.levelGrid.children].entries()) n.classList.toggle('is-selected', k === i);
    if (nudge) {
      info.classList.remove('shake');
      void info.offsetWidth;
      info.classList.add('shake');
    }
  }

  closeLevels(refocus = true) {
    this.setVisible(this.el.levels, false);
    if (refocus) $('menu-levels').focus({ preventScroll: true });
  }

  openCredits() {
    this.setVisible(this.el.credits, true);
    setTimeout(() => $('btn-credits-close').focus({ preventScroll: true }), 60);
  }

  closeCredits() {
    this.setVisible(this.el.credits, false);
    $('menu-credits').focus({ preventScroll: true });
  }

  // Ferme la fenêtre ouverte depuis le menu d'accueil (Échap). Renvoie true si fait.
  closeTopModal() {
    if (this.el.levels.classList.contains('is-visible')) {
      this.closeLevels();
      return true;
    }
    if (this.el.credits.classList.contains('is-visible')) {
      this.closeCredits();
      return true;
    }
    return false;
  }

  modalOpen() {
    return ['levels', 'credits', 'settings'].some((id) => $(id).classList.contains('is-visible'));
  }

  /* ───────────── Écrans ───────────── */

  setVisible(el, v) {
    el.classList.toggle('is-visible', v);
    el.setAttribute('aria-hidden', String(!v));
  }

  showHUD(v) {
    this.setVisible(this.el.hud, v);
    this.setVisible(this.el.dock, v);
  }

  showPause(v) {
    this.setVisible(this.el.pause, v);
    if (v) $('btn-resume').focus({ preventScroll: true });
  }

  fade(on) {
    this.el.fade.classList.toggle('is-on', on);
  }

  setSound(on) {
    this.el.soundBtn.setAttribute('aria-pressed', String(on));
    this.el.soundBtn.setAttribute('aria-label', on ? 'Couper le son' : 'Activer le son');
  }

  /* ───────────── HUD ───────────── */

  setLevel(index, def, gemTotal, curioTotal = 0) {
    const n = String(index + 1).padStart(2, '0');
    this.el.hudIndex.textContent = n;
    this.el.hudName.textContent = def.name;
    this.el.hudSub.textContent = def.subtitle;
    this.el.hudGems.innerHTML = '';
    this.slots = [];
    for (let i = 0; i < gemTotal; i++) {
      const s = document.createElement('span');
      s.className = 'gem-slot';
      s.innerHTML = GEM_SVG;
      this.el.hudGems.appendChild(s);
      this.slots.push(s);
    }
    this.el.hudGems.setAttribute('aria-label', `Cristaux : 0 sur ${gemTotal}`);
    this.el.hudGems.style.display = gemTotal ? '' : 'none';
    this.setSteps(0);
    this.timerShown = null;
    this.setTimer(0);
    this.curioTotal = curioTotal;
    this.setCurios(0);
    this.setMirror(false);
  }

  setSteps(n) {
    this.el.steps.textContent = n;
  }

  setTimer(sec) {
    const s = Math.floor(sec);
    if (s === this.timerShown) return;
    this.timerShown = s;
    this.el.timer.textContent = fmtTime(s);
  }

  setCurios(n, pop = false) {
    const el = this.el.hudCurios;
    el.classList.toggle('is-empty', !this.curioTotal);
    el.classList.toggle('is-complete', !!this.curioTotal && n >= this.curioTotal);
    this.el.curiosN.textContent = `${n}/${this.curioTotal}`;
    el.setAttribute('aria-label', `Curiosités : ${n} sur ${this.curioTotal}`);
    if (pop) {
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }
  }

  // Monde-miroir : liseré irisé + badge « commandes inversées »
  setMirror(on, flash = false) {
    this.el.mirrorVeil.classList.toggle('is-on', on);
    this.el.mirrorBadge.classList.toggle('is-visible', on);
    if (flash) {
      const v = this.el.mirrorVeil;
      v.classList.remove('flash');
      void v.offsetWidth;
      v.classList.add('flash');
    }
  }

  fillGem(index, total) {
    const s = this.slots?.[index];
    if (!s) return;
    s.classList.add('is-filled');
    s.classList.remove('pop');
    void s.offsetWidth;
    s.classList.add('pop');
    this.el.hudGems.setAttribute('aria-label', `Cristaux : ${index + 1} sur ${total}`);
  }

  // Un cristal « vole » de sa position à l'écran jusqu'à son emplacement du HUD
  flyGem(x, y, index, total, onDone) {
    const slot = this.slots?.[index];
    if (!slot) return onDone?.();
    const r = slot.getBoundingClientRect();
    const tx = r.left + r.width / 2;
    const ty = r.top + r.height / 2;
    const el = document.createElement('div');
    el.className = 'fly-gem';
    el.innerHTML = GEM_SVG.replace('class="g-fill"', 'class="g-fill" style="opacity:1;transform:none"');
    document.body.appendChild(el);
    const mx = (x + tx) / 2 + (tx > x ? -60 : 60);
    const my = Math.min(y, ty) - 80;
    const anim = el.animate(
      [
        { transform: `translate(${x}px, ${y}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${mx}px, ${my}px) scale(1.5)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${tx}px, ${ty}px) scale(0.85)`, opacity: 1 },
      ],
      { duration: 850, easing: 'cubic-bezier(.55,0,.25,1)', fill: 'forwards' },
    );
    anim.onfinish = () => {
      el.remove();
      this.fillGem(index, total);
      onDone?.();
    };
  }

  toast(text, { color, duration = 3800 } = {}) {
    const t = this.el.toast;
    clearTimeout(this.toastTimer);
    t.style.setProperty('--toast-color', color || '');
    const show = () => {
      t.textContent = text;
      t.classList.add('is-visible');
      this.toastTimer = setTimeout(() => t.classList.remove('is-visible'), duration);
    };
    if (t.classList.contains('is-visible')) {
      t.classList.remove('is-visible');
      this.toastTimer = setTimeout(show, 280);
    } else show();
  }

  hideToast() {
    clearTimeout(this.toastTimer);
    this.el.toast.classList.remove('is-visible');
  }

  // Carte d'ouverture de chapitre : émotion en grand, nom du niveau, phrase
  // d'ambiance. Résolue quand la carte a disparu (~4 s).
  banner(index, def, palette) {
    const b = this.el.banner;
    const [chapter] = (def.chapter ?? `Niveau ${pad(index + 1)}`).split('·');
    this.el.bannerIndex.textContent = chapter.trim();
    $('banner-emotion').textContent = palette?.label ?? def.name;
    this.el.bannerName.textContent = def.name;
    this.el.bannerSub.textContent = palette?.tagline ?? def.subtitle;
    b.style.setProperty('--mood', palette?.accent ?? '#ffd98a');
    b.classList.remove('play');
    void b.offsetWidth;
    b.classList.add('play');
    clearTimeout(this.bannerTimer);
    return new Promise((r) => (this.bannerTimer = setTimeout(r, 3600)));
  }

  /* ───────────── Fin de niveau ───────────── */

  showComplete(v, { def, gems = 0, total = 0, steps = 0, time = 0, curios = 0, curioTotal = 0, record = {}, best = null, hasNext = false } = {}) {
    this.setVisible(this.el.complete, v);
    if (!v) return;
    this.el.completeTitle.textContent = def.name;
    const outro = document.getElementById("outro");
    outro.classList.toggle("is-empty", !def.outro);
    if (def.outro) {
      document.getElementById("outro-text").textContent = `« ${def.outro.text} »`;
      document.getElementById("outro-who").textContent = def.npcs?.find((n) => n.id === def.outro.who)?.name ?? "";
    }
    this.el.statGems.textContent = `${gems}/${total}`;
    this.el.statSteps.textContent = steps;
    this.el.statTime.textContent = fmtTime(time);
    this.el.statCurios.textContent = `${curios}/${curioTotal}`;
    this.el.statCurios.parentElement.style.display = curioTotal ? '' : 'none';
    this.el.recSteps.classList.toggle('is-on', !!record.steps);
    this.el.recTime.classList.toggle('is-on', !!record.time);
    this.el.statsBest.textContent = best && best.runs > 1 ? `records · ${fmtTime(best.time)} · ${best.steps} pas · ${best.curios.length}/${curioTotal} curiosités` : '';
    this.el.btnNext.querySelector('span').textContent = hasNext ? 'Niveau suivant' : 'Retour au titre';
    const box = this.el.resultGems;
    box.innerHTML = '';
    box.style.display = total ? '' : 'none';
    for (let i = 0; i < total; i++) {
      const s = document.createElement('span');
      s.className = 'gem-slot' + (i < gems ? ' is-filled' : '');
      s.innerHTML = GEM_SVG;
      s.style.animationDelay = `${0.35 + i * 0.18}s`;
      box.appendChild(s);
      requestAnimationFrame(() => s.classList.add('reveal'));
    }
    setTimeout(() => this.el.btnNext.focus({ preventScroll: true }), 400);
  }
}
