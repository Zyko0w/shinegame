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

  // Statistiques d'un niveau : meilleurs scores (pas, temps), cristaux,
  // curiosités découvertes (ids cumulés d'une partie à l'autre), parties finies
  level(id) {
    return { done: false, gems: 0, steps: null, time: null, curios: [], runs: 0, last: null, ...this.data.levels[id] };
  }

  setLast(index) {
    this.data.last = index;
    this.save();
  }

  // Enregistre une partie terminée ; renvoie les records battus
  complete(index, id, { gems, steps, time, curios = [] }, total) {
    const prev = this.level(id);
    const best = (a, b) => (a == null ? b : Math.min(a, b));
    const record = {
      steps: prev.steps != null && steps < prev.steps,
      time: prev.time != null && time < prev.time,
    };
    this.data.levels[id] = {
      done: true,
      gems: Math.max(prev.gems, gems),
      steps: best(prev.steps, steps),
      time: best(prev.time, time),
      curios: [...new Set([...prev.curios, ...curios])],
      runs: prev.runs + 1,
      last: { gems, steps, time, curios: curios.length },
    };
    this.data.unlocked = Math.max(this.data.unlocked, Math.min(index + 2, total));
    this.data.last = Math.min(index + 1, total - 1);
    this.save();
    return record;
  }

  // Vœu fait sur l'île (gardé même si le niveau n'est pas terminé)
  setWish(id, text) {
    this.data.levels[id] = { ...this.level(id), wish: text };
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
