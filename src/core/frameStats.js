// Mesures de performance :
// - intervalle entre images (ce que voit le joueur, bridé par la synchro écran),
// - temps GPU réel du rendu via EXT_disjoint_timer_query_webgl2 (Chrome/Edge),
//   seul moyen fiable de savoir s'il reste de la marge sous la synchro,
// - « 1 % low » : la pire image sur 100, pour repérer les à-coups.

const RING = 240;

export class FrameStats {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.free = [];
    this.pending = [];
    this.active = null;

    this.intervals = new Float32Array(RING);
    this.head = 0;
    this.count = 0;
    this.gpuSum = 0;
    this.gpuN = 0;
    this.cpuSum = 0;
    this.cpuN = 0;

    // résultats de la dernière fenêtre
    this.fps = 60;
    this.avgMs = 16.7;
    this.lowMs = 16.7; // 1 % des pires images
    this.gpuMs = NaN;
    this.cpuMs = 0;
    this.refreshMs = 16.7; // période d'affichage estimée
    this.scratch = new Float32Array(RING);
  }

  get hasGpuTimer() {
    return !!this.ext;
  }

  beginGPU() {
    if (!this.ext || this.active || this.pending.length >= 4) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  endGPU() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  // Récupère les résultats GPU disponibles (asynchrones, quelques images de retard)
  poll() {
    const gl = this.gl;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      this.pending.shift();
      this.free.push(q);
      if (!disjoint) {
        this.gpuSum += ns / 1e6;
        this.gpuN++;
      }
    }
  }

  addFrame(intervalMs, cpuMs) {
    this.intervals[this.head] = intervalMs;
    this.head = (this.head + 1) % RING;
    this.count = Math.min(RING, this.count + 1);
    this.cpuSum += cpuMs;
    this.cpuN++;
  }

  // Calcule les statistiques de la fenêtre écoulée (appelé ~2×/s)
  summarize(windowFrames) {
    const n = Math.min(windowFrames, this.count);
    if (n < 5) return;
    const s = this.scratch;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = this.intervals[(this.head - 1 - i + RING) % RING];
      s[i] = v;
      sum += v;
    }
    const sorted = s.subarray(0, n).sort();
    this.avgMs = sum / n;
    this.fps = 1000 / this.avgMs;
    this.lowMs = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
    // période d'affichage ≈ 10e percentile (images les plus rapides)
    const p10 = sorted[Math.floor(n * 0.1)];
    this.refreshMs = Math.min(33.4, Math.max(6.9, this.refreshMs * 0.8 + p10 * 0.2));
    if (this.gpuN) this.gpuMs = this.gpuSum / this.gpuN;
    this.cpuMs = this.cpuN ? this.cpuSum / this.cpuN : 0;
    this.gpuSum = this.gpuN = this.cpuSum = this.cpuN = 0;
  }

  // Dessine le graphe des temps d'image (pour l'overlay de perfs)
  drawGraph(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const n = Math.min(this.count, w);
    const budget = this.refreshMs;
    const scale = h / (budget * 3);
    ctx.fillStyle = 'rgba(121,242,255,0.12)';
    ctx.fillRect(0, h - budget * scale, w, 1);
    for (let i = 0; i < n; i++) {
      const v = this.intervals[(this.head - 1 - i + RING) % RING];
      const bh = Math.min(h, v * scale);
      ctx.fillStyle = v > budget * 1.6 ? '#ff6fb1' : v > budget * 1.15 ? '#ffd47a' : '#79f2ff';
      ctx.fillRect(w - 1 - i, h - bh, 1, bh);
    }
  }
}
