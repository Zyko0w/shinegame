// Progression du joueur (niveaux débloqués, meilleurs scores), dans localStorage.

const KEY = 'shine:progress';

function empty() {
  return { unlocked: 1, last: 0, levels: {} };
}

class Progress {
  constructor() {
    this.data = empty();
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && typeof saved.unlocked === 'number') this.data = { ...empty(), ...saved };
    } catch {
      /* stockage indisponible ou corrompu */
    }
  }

  get hasSave() {
    return this.data.unlocked > 1 || Object.keys(this.data.levels).length > 0 || this.data.last > 0;
  }

  isUnlocked(index) {
    return index < this.data.unlocked;
  }

  level(id) {
    return this.data.levels[id] ?? { done: false, gems: 0, steps: null };
  }

  setLast(index) {
    this.data.last = index;
    this.save();
  }

  complete(index, id, gems, steps, total) {
    const prev = this.level(id);
    this.data.levels[id] = {
      done: true,
      gems: Math.max(prev.gems, gems),
      steps: prev.steps == null ? steps : Math.min(prev.steps, steps),
    };
    this.data.unlocked = Math.max(this.data.unlocked, Math.min(index + 2, total));
    this.data.last = Math.min(index + 1, total - 1);
    this.save();
  }

  reset() {
    this.data = empty();
    this.save();
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }
}

export const progress = new Progress();
