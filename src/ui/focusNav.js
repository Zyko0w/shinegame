// Navigation au focus pour la manette, dans n'importe quel conteneur :
// haut/bas déplacent le focus, gauche/droite ajustent la valeur d'un
// curseur ou d'une liste, A « clique ».

const FOCUSABLE = 'button:not([disabled]), select, input:not([type="hidden"])';

function isVisible(el) {
  if (el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function focusables(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter(isVisible);
}

export function moveFocus(container, delta) {
  const list = focusables(container);
  if (!list.length) return null;
  const i = list.indexOf(document.activeElement);
  const next = list[i < 0 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length];
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return next;
}

// Navigation 2D dans une grille (cartes de niveaux) : élément le plus proche dans la direction
export function moveFocusSpatial(container, dir) {
  const list = focusables(container);
  const cur = document.activeElement;
  if (!list.includes(cur)) {
    list[0]?.focus({ preventScroll: true });
    return;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax;
    const dy = b.top + b.height / 2 - ay;
    const along = { left: -dx, right: dx, up: -dy, down: dy }[dir];
    if (along <= 4) continue;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  best?.focus({ preventScroll: true });
}

// Gauche/droite sur l'élément focalisé ; renvoie true si consommé
export function adjustFocused(delta) {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === 'INPUT' && el.type === 'range') {
    const step = Math.max(1, Math.round((+el.max - +el.min) / 20));
    el.value = Math.min(+el.max, Math.max(+el.min, +el.value + delta * step));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (el.tagName === 'SELECT') {
    const i = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + delta));
    if (i !== el.selectedIndex) {
      el.selectedIndex = i;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  if (el.tagName === 'INPUT' && el.type === 'checkbox') {
    const want = delta > 0;
    if (el.checked !== want) {
      el.checked = want;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  return false;
}

export function activateFocused() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  if (el.tagName === 'INPUT' && el.type === 'checkbox') {
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (el.tagName === 'SELECT') return adjustFocused(1);
  el.click();
  return true;
}
