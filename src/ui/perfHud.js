// Overlay de performances : i/s, 1 % low, temps GPU, palier, résolution,
// et graphe des temps d'image (cyan = fluide, jaune = limite, rose = à-coup).

export class PerfHud {
  constructor(el, { stats, renderer, quality, tiers, getPixelRatio }) {
    this.el = el;
    this.stats = stats;
    this.renderer = renderer;
    this.quality = quality;
    this.tiers = tiers;
    this.getPixelRatio = getPixelRatio;
    this.text = document.createElement('span');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 160;
    this.canvas.height = 30;
    this.canvas.className = 'perf-graph';
    this.ctx = this.canvas.getContext('2d');
    el.append(this.text, this.canvas);
    this.visible = false;
    this.clock = 0;
  }

  setVisible(v) {
    this.visible = v;
    this.el.classList.toggle('is-visible', v);
    this.clock = 1;
  }

  update(dt) {
    if (!this.visible || (this.clock += dt) < 0.25) return;
    this.clock = 0;
    const s = this.stats;
    const q = this.quality;
    const pr = this.getPixelRatio();
    const info = this.renderer.info.render;
    const gpu = Number.isFinite(s.gpuMs) ? `GPU ${s.gpuMs.toFixed(1)} ms · ` : '';
    this.text.textContent =
      `${s.fps.toFixed(0)} i/s · 1% ${(1000 / s.lowMs).toFixed(0)} · ${gpu}CPU ${s.cpuMs.toFixed(1)} ms · ` +
      `${this.tiers[q.tier].name}${q.auto ? ' (auto)' : ''} · ${Math.round(innerWidth * pr)}×${Math.round(innerHeight * pr)} · ${info.calls} draws`;
    s.drawGraph(this.ctx, this.canvas.width, this.canvas.height);
  }
}
