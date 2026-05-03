/**
 * PixiJS renderer for match. Receives server snapshots and lerps player + bullet positions.
 */
import { Application, Graphics, Container, Text } from 'pixi.js';
import type { SSnapshot, SnapshotPlayer, SnapshotBullet, SWelcome } from '@arena/protocol';
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

const COLOR_YOU = 0x4ad29a;
const COLOR_OPP = 0xe06c75;
const COLOR_BULLET_YOU = 0x9be7c4;
const COLOR_BULLET_OPP = 0xff8a8a;

export class PixiRenderer {
  private app: Application;
  private world: Container;
  private players = new Map<number, PlayerView>();
  private bullets = new Map<number, BulletView>();
  private youId = 0;
  private oppId = 0;
  private snapTime = 0;
  private cameraScale = 1;

  constructor(private readonly host: HTMLElement) {
    this.app = new Application();
    this.world = new Container();
  }

  async init(): Promise<void> {
    await this.app.init({
      background: 0x0e1117,
      antialias: true,
      resizeTo: this.host,
    });
    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
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

    // Players
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

    // Bullets
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
    view.gfx
      .clear()
      .circle(0, 0, PLAYER_RADIUS)
      .fill({ color, alpha: p.hp > 0 ? 0.95 : 0.3 })
      .stroke({ color: 0xffffff, alpha: 0.4, width: 2 });
    // facing line
    view.gfx
      .moveTo(0, 0)
      .lineTo(Math.cos(view.curAngle) * (PLAYER_RADIUS + 8), Math.sin(view.curAngle) * (PLAYER_RADIUS + 8))
      .stroke({ color: 0xffffff, alpha: 0.85, width: 3 });
    // HP bar
    const w = 50;
    view.gfx
      .rect(-w / 2, -PLAYER_RADIUS - 14, w, 5)
      .fill({ color: 0x000000, alpha: 0.5 });
    view.gfx
      .rect(-w / 2, -PLAYER_RADIUS - 14, (w * Math.max(0, p.hp)) / 100, 5)
      .fill({ color: p.hp > 50 ? 0x4ad29a : p.hp > 25 ? 0xf5c518 : 0xe06c75 });

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
    view.gfx.clear().circle(0, 0, BULLET_RADIUS).fill({ color });
    view.gfx.x = b.x;
    view.gfx.y = b.y;
  }

  private tick(_dtMs: number): void {
    // Smooth player positions (linear interp ~33ms snapshot).
    const since = performance.now() - this.snapTime;
    const t = Math.max(0, Math.min(1, since / 33));
    for (const v of this.players.values()) {
      const x = v.prevX + (v.curX - v.prevX) * t;
      const y = v.prevY + (v.curY - v.prevY) * t;
      v.gfx.x = x;
      v.gfx.y = y;
    }
    this.updateCamera();
  }

  private updateCamera(): void {
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    const s = this.cameraScale;
    // Center the whole arena (9:16 portrait fits in any viewport).
    this.world.x = (W - MAP_WIDTH * s) / 2;
    this.world.y = (H - MAP_HEIGHT * s) / 2;
  }

  private handleResize = (): void => {
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    // Portrait 9:16 map — always fit so the whole arena is visible.
    this.cameraScale = Math.min(W / MAP_WIDTH, H / MAP_HEIGHT);
    this.world.scale.set(this.cameraScale);
    this.updateCamera();
  };

  private drawArena(): void {
    const bg = new Graphics();
    bg.rect(0, 0, MAP_WIDTH, MAP_HEIGHT).fill({ color: 0x161b22 }).stroke({ color: 0x30363d, width: 4 });
    // Grid
    for (let x = 0; x <= MAP_WIDTH; x += 80) {
      bg.moveTo(x, 0).lineTo(x, MAP_HEIGHT).stroke({ color: 0x21262d, width: 1 });
    }
    for (let y = 0; y <= MAP_HEIGHT; y += 80) {
      bg.moveTo(0, y).lineTo(MAP_WIDTH, y).stroke({ color: 0x21262d, width: 1 });
    }
    this.world.addChild(bg);
  }
}
