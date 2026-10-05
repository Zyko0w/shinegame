import { findPath } from '../game/pathfinding.js';

// Outils de développement (chargés uniquement par `npm run dev`) :
// window.__shine.walkTo(x, z), goto(i), closeup(), info()…

export function installDevtools(ctx) {
  const { game, rig, player } = ctx;
  window.__shine = {
    ...ctx,
    goto: (i) => ctx.goToLevel(i),
    walkTo(x, z) {
      const path = findPath(game.level, player.nextTile, game.level.tileAt(x, z));
      if (path) player.walk(path);
      return !!path;
    },
    // gros plan sur Lumi (captures de test)
    closeup(r = 2.2, phi = 1.15) {
      rig.controls.minDistance = 0.5;
      rig.target.copy(player.root.position).y += 0.65;
      rig.set(r, phi, rig.read().theta);
    },
    cam: () => ({ pos: rig.camera.position.toArray(), target: rig.target.toArray(), radius: rig.view.radius }),
    info: () => ({
      fps: ctx.quality.fps,
      tier: ctx.quality.tier,
      pr: ctx.gfx.pixelRatio,
      calls: ctx.gfx.renderer.info.render.calls,
    }),
  };
}
