/**
 * PixiJS renderer for match. Receives server snapshots and lerps player + bullet positions.
 * Renders obstacles (crates/barrels/walls) and visual FX (muzzle flash, hit sparks, death burst).
 */
import { Application, Graphics, Container, Text } from 'pixi.js';
import type {
  SSnapshot,
  SnapshotPlayer,
  SnapshotBullet,
  SWelcome,
  SnapshotEvent,
  Obstacle,
} from '@arena/protocol';
import { MAP_WIDTH, MAP_HEIGHT, PLAYER_RADIUS, BULLET_RADIUS } from '@arena/shared';

interface PlayerView {
  gfx: Graphics;
  label: Text;
  prevX: number;
  prevY: number;
  curX: number;
  curY: number;
  prevAngle: number;
  curAngle: number;
  hp: number;
  isYou: boolean;
  isOpponent: boolean;
}

interface BulletView {
  gfx: Graphics;
}

interface Particle {
  gfx: Graphics;
  vx: number;
  vy: number;
  ttl: number; // ms
  maxTtl: number;
  fade: boolean;
}

const COLOR_YOU = 0x4ad29a;
const COLOR_OPP = 0xe06c75;
const COLOR_BULLET_YOU = 0x9be7c4;
const COLOR_BULLET_OPP = 0xff8a8a;

export type FxCallback = (ev: { kind: string; x?: number; y?: number; who?: number; victim?: number; obstacle?: boolean }) => void;

export class PixiRenderer {
  private app: Application;
  private world: Container;
  private fxLayer: Container;
  private players = new Map<number, PlayerView>();
  private bullets = new Map<number, BulletView>();
  private particles: Particle[] = [];
  private obstacles: Obstacle[] = [];
  private obstaclesLayer: Container | null = null;
  private youId = 0;
  private oppId = 0;
  private snapTime = 0;
  private cameraScale = 1;
  /** Optional FX/sound callback. */
  onEvent: FxCallback | null = null;

  constructor(private readonly host: HTMLElement) {
    this.app = new Application();
    this.world = new Container();
    this.fxLayer = new Container();
  }

  async init(): Promise<void> {
    await this.app.init({
      background: 0x0e1117,
      antialias: true,
      resizeTo: this.host,
    });
    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.fxLayer);
    this.drawArena();
    this.app.ticker.add(() => this.tick(this.app.ticker.deltaMS));
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  destroy(): void {
    window.removeEventListener('resize', this.handleResize);
    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* ignore */
    }
  }

  setIdentity(welcome: SWelcome): void {
    this.youId = welcome.you.id;
    this.oppId = welcome.opponent.id;
    this.obstacles = welcome.obstacles ?? [];
    this.drawObstacles();
  }

  /** Returns canvas-space position of you player (for aim). */
  getYouCanvasPos(): { x: number; y: number } | null {
    const p = this.players.get(this.youId);
    if (!p) return null;
    const t = this.world.worldTransform;
    return { x: p.curX * t.a + t.tx, y: p.curY * t.d + t.ty };
  }

  applySnapshot(snap: SSnapshot): void {
    this.snapTime = performance.now();

    const seen = new Set<number>();
    for (const p of snap.players) {
      seen.add(p.id);
      this.upsertPlayer(p);
    }
    for (const [id, view] of this.players) {
      if (!seen.has(id)) {
        view.gfx.destroy();
        view.label.destroy();
        this.players.delete(id);
      }
    }

    const seenB = new Set<number>();
    for (const b of snap.bullets) {
      seenB.add(b.id);
      this.upsertBullet(b);
    }
    for (const [id, view] of this.bullets) {
      if (!seenB.has(id)) {
        view.gfx.destroy();
        this.bullets.delete(id);
      }
    }

    for (const ev of snap.events) {
      this.handleEvent(ev);
      this.onEvent?.(ev as Parameters<FxCallback>[0]);
    }
  }

  private handleEvent(ev: SnapshotEvent): void {
    if (ev.kind === 'shoot') {
      const x = Number(ev.x ?? 0);
      const y = Number(ev.y ?? 0);
      this.spawnMuzzleFlash(x, y, Number(ev.who) === this.youId);
    } else if (ev.kind === 'hit') {
      const x = Number(ev.x ?? 0);
      const y = Number(ev.y ?? 0);
      const isObstacle = Boolean(ev.obstacle);
      this.spawnSparks(x, y, isObstacle ? 0xc9a06a : 0xffd166, isObstacle ? 6 : 12);
    } else if (ev.kind === 'death') {
      const who = Number(ev.who);
      const view = this.players.get(who);
      if (view) {
        this.spawnSparks(view.curX, view.curY, who === this.youId ? COLOR_YOU : COLOR_OPP, 32);
      }
    } else if (ev.kind === 'ability') {
      const who = Number(ev.who);
      const view = this.players.get(who);
      if (view) this.spawnDashTrail(view.curX, view.curY, who === this.youId ? COLOR_YOU : COLOR_OPP);
    }
  }

  private upsertPlayer(p: SnapshotPlayer): void {
    const isYou = p.id === this.youId;
    const isOpp = p.id === this.oppId;
    let view = this.players.get(p.id);
    if (!view) {
      const gfx = new Graphics();
      this.world.addChild(gfx);
      const label = new Text({
        text: '',
        style: { fill: 0xffffff, fontSize: 14, fontFamily: 'monospace', stroke: { color: 0x000000, width: 3 } },
      });
      label.anchor.set(0.5, 1);
      this.world.addChild(label);
      view = {
        gfx,
        label,
        prevX: p.x,
        prevY: p.y,
        curX: p.x,
        curY: p.y,
        prevAngle: p.angle,
        curAngle: p.angle,
        hp: p.hp,
        isYou,
        isOpponent: isOpp,
      };
      this.players.set(p.id, view);
    } else {
      view.prevX = view.curX;
      view.prevY = view.curY;
      view.prevAngle = view.curAngle;
      view.curX = p.x;
      view.curY = p.y;
      view.curAngle = p.angle;
      view.hp = p.hp;
    }
    this.redrawPlayer(view, p);
  }

  private redrawPlayer(view: PlayerView, p: SnapshotPlayer): void {
    const color = view.isYou ? COLOR_YOU : COLOR_OPP;
    const dark = view.isYou ? 0x2d8c66 : 0x9b3d4a;
    const dashing = (p.buffs ?? []).includes('dash');
    const g = view.gfx;
    g.clear();
    // shadow
    g.ellipse(0, PLAYER_RADIUS - 2, PLAYER_RADIUS, PLAYER_RADIUS * 0.4).fill({ color: 0x000000, alpha: 0.35 });
    // body
    g.circle(0, 0, PLAYER_RADIUS).fill({ color, alpha: p.hp > 0 ? 1 : 0.3 }).stroke({ color: dark, width: 2, alignment: 1 });
    // inner highlight
    g.circle(-PLAYER_RADIUS * 0.3, -PLAYER_RADIUS * 0.3, PLAYER_RADIUS * 0.35).fill({ color: 0xffffff, alpha: 0.18 });
    // facing weapon (triangle)
    const cos = Math.cos(view.curAngle);
    const sin = Math.sin(view.curAngle);
    const tipX = cos * (PLAYER_RADIUS + 14);
    const tipY = sin * (PLAYER_RADIUS + 14);
    const px = -sin * 6;
    const py = cos * 6;
    g.poly([
      tipX, tipY,
      cos * PLAYER_RADIUS + px, sin * PLAYER_RADIUS + py,
      cos * PLAYER_RADIUS - px, sin * PLAYER_RADIUS - py,
    ]).fill({ color: 0xffffff, alpha: 0.95 });
    // dash aura
    if (dashing) {
      g.circle(0, 0, PLAYER_RADIUS + 8).stroke({ color: 0xffffff, alpha: 0.5, width: 2 });
    }
    // HP bar
    const w = 50;
    g.rect(-w / 2, -PLAYER_RADIUS - 14, w, 5).fill({ color: 0x000000, alpha: 0.5 });
    g.rect(-w / 2, -PLAYER_RADIUS - 14, (w * Math.max(0, p.hp)) / 100, 5).fill({
      color: p.hp > 50 ? 0x4ad29a : p.hp > 25 ? 0xf5c518 : 0xe06c75,
    });

    view.label.text = view.isYou ? 'YOU' : 'OPP';
    view.label.x = view.curX;
    view.label.y = view.curY - PLAYER_RADIUS - 22;
  }

  private upsertBullet(b: SnapshotBullet): void {
    let view = this.bullets.get(b.id);
    if (!view) {
      const gfx = new Graphics();
      this.world.addChild(gfx);
      view = { gfx };
      this.bullets.set(b.id, view);
    }
    const color = b.owner === this.youId ? COLOR_BULLET_YOU : COLOR_BULLET_OPP;
    view.gfx
      .clear()
      .circle(0, 0, BULLET_RADIUS + 2)
      .fill({ color, alpha: 0.35 })
      .circle(0, 0, BULLET_RADIUS)
      .fill({ color: 0xffffff });
    view.gfx.x = b.x;
    view.gfx.y = b.y;
  }

  // ───── FX ─────
  private spawnMuzzleFlash(x: number, y: number, isYou: boolean): void {
    const g = new Graphics();
    g.circle(0, 0, 14).fill({ color: isYou ? 0xb6ffe0 : 0xffd2d2, alpha: 0.9 });
    g.x = x;
    g.y = y;
    this.fxLayer.addChild(g);
    this.particles.push({ gfx: g, vx: 0, vy: 0, ttl: 80, maxTtl: 80, fade: true });
  }

  private spawnSparks(x: number, y: number, color: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 220;
      const g = new Graphics();
      const sz = 1.5 + Math.random() * 2.5;
      g.circle(0, 0, sz).fill({ color });
      g.x = x;
      g.y = y;
      this.fxLayer.addChild(g);
      const ttl = 250 + Math.random() * 350;
      this.particles.push({
        gfx: g,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        ttl,
        maxTtl: ttl,
        fade: true,
      });
    }
  }

  private spawnDashTrail(x: number, y: number, color: number): void {
    const g = new Graphics();
    g.circle(0, 0, PLAYER_RADIUS + 6).stroke({ color, alpha: 0.7, width: 3 });
    g.x = x;
    g.y = y;
    this.fxLayer.addChild(g);
    this.particles.push({ gfx: g, vx: 0, vy: 0, ttl: 280, maxTtl: 280, fade: true });
  }

  private tick(dtMs: number): void {
    const since = performance.now() - this.snapTime;
    const t = Math.max(0, Math.min(1, since / 33));
    for (const v of this.players.values()) {
      const x = v.prevX + (v.curX - v.prevX) * t;
      const y = v.prevY + (v.curY - v.prevY) * t;
      v.gfx.x = x;
      v.gfx.y = y;
    }
    const dt = dtMs;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.ttl -= dt;
      if (p.ttl <= 0) {
        p.gfx.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      p.gfx.x += (p.vx * dt) / 1000;
      p.gfx.y += (p.vy * dt) / 1000;
      p.vx *= 0.92;
      p.vy *= 0.92;
      if (p.fade) p.gfx.alpha = p.ttl / p.maxTtl;
    }
    this.updateCamera();
  }

  private updateCamera(): void {
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    const s = this.cameraScale;
    this.world.x = (W - MAP_WIDTH * s) / 2;
    this.world.y = (H - MAP_HEIGHT * s) / 2;
  }

  private handleResize = (): void => {
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    this.cameraScale = Math.min(W / MAP_WIDTH, H / MAP_HEIGHT);
    this.world.scale.set(this.cameraScale);
    this.updateCamera();
  };

  private drawArena(): void {
    const bg = new Graphics();
    bg.rect(0, 0, MAP_WIDTH, MAP_HEIGHT).fill({ color: 0x161b22 }).stroke({ color: 0x30363d, width: 4 });
    bg.circle(MAP_WIDTH / 2, MAP_HEIGHT / 2, 60).stroke({ color: 0x21262d, width: 2 });
    bg.circle(MAP_WIDTH / 2, MAP_HEIGHT / 2, 20).stroke({ color: 0x21262d, width: 2 });
    for (let x = 0; x <= MAP_WIDTH; x += 80) {
      bg.moveTo(x, 0).lineTo(x, MAP_HEIGHT).stroke({ color: 0x21262d, width: 1 });
    }
    for (let y = 0; y <= MAP_HEIGHT; y += 80) {
      bg.moveTo(0, y).lineTo(MAP_WIDTH, y).stroke({ color: 0x21262d, width: 1 });
    }
    this.world.addChildAt(bg, 0);
  }

  private drawObstacles(): void {
    if (this.obstaclesLayer) {
      this.obstaclesLayer.destroy({ children: true });
    }
    const layer = new Container();
    this.obstaclesLayer = layer;
    this.world.addChildAt(layer, 1);
    for (const ob of this.obstacles) {
      const g = new Graphics();
      drawObstacle(g, ob);
      g.x = ob.x;
      g.y = ob.y;
      layer.addChild(g);
    }
  }
}

function drawObstacle(g: Graphics, ob: Obstacle): void {
  const { w, h } = ob;
  if (ob.kind === 'barrel') {
    g.rect(2, 4, w - 4, h - 6).fill({ color: 0x4a6bc4 }).stroke({ color: 0x2a3a78, width: 2 });
    g.rect(2, 4, w - 4, 6).fill({ color: 0x6a8bdc });
    g.rect(2, h - 16, w - 4, 4).fill({ color: 0x2a3a78, alpha: 0.6 });
    g.rect(2, h - 8, w - 4, 4).fill({ color: 0x2a3a78, alpha: 0.6 });
  } else if (ob.kind === 'wall') {
    g.rect(1, 1, w - 2, h - 2).fill({ color: 0x4a4f57 }).stroke({ color: 0x21262d, width: 2 });
    for (let y = 8; y < h - 4; y += 16) {
      const off = (y / 16) % 2 === 0 ? 0 : w / 2 - 8;
      g.moveTo(off + 4, y).lineTo(w - 4, y).stroke({ color: 0x21262d, width: 1, alpha: 0.6 });
    }
    g.moveTo(w / 2, 4).lineTo(w / 2, h - 4).stroke({ color: 0x21262d, width: 1, alpha: 0.4 });
  } else {
    g.rect(2, 2, w - 4, h - 4).fill({ color: 0x8a5a2b }).stroke({ color: 0x4a2f17, width: 2 });
    g.rect(6, 6, w - 12, h - 12).stroke({ color: 0xb37b3e, alpha: 0.6, width: 2 });
    g.moveTo(8, 8).lineTo(w - 8, h - 8).stroke({ color: 0x4a2f17, width: 2, alpha: 0.8 });
    g.moveTo(w - 8, 8).lineTo(8, h - 8).stroke({ color: 0x4a2f17, width: 2, alpha: 0.8 });
  }
}
