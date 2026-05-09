/**
 * PixiJS renderer for match. Receives server snapshots, lerps player + bullet positions,
 * renders obstacles and FX. Loads admin-uploaded sprites by slot from /api/sprites; falls
 * back to procedural Graphics when a slot is empty or fails to load.
 */
import { Application, Graphics, Container, Text, Sprite, Texture, Assets, TilingSprite } from 'pixi.js';
import { AnimatedGIF } from '@pixi/gif';
import type {
  SSnapshot,
  SnapshotPlayer,
  SnapshotBullet,
  SWelcome,
  SnapshotEvent,
  Obstacle,
} from '@arena/protocol';
import { MAP_WIDTH, MAP_HEIGHT, PLAYER_RADIUS, BULLET_RADIUS } from '@arena/shared';

type SpriteSlot =
  | 'player_you'
  | 'player_opp'
  | 'weapon'
  | 'bullet'
  | 'crate'
  | 'barrel'
  | 'wall'
  | 'bg_tile';

interface SpriteRegistryRow {
  url: string;
  width: number;
  height: number;
}

interface PlayerView {
  root: Container;
  bodyG: Graphics; // procedural body (also used as sprite tint mask)
  bodySprite: Sprite | null;
  weaponG: Graphics;
  weaponSprite: Sprite | null;
  hpG: Graphics;
  label: Text;
  prevX: number;
  prevY: number;
  curX: number;
  curY: number;
  prevAngle: number;
  curAngle: number;
  hp: number;
  isYou: boolean;
}

interface BulletView {
  display: Sprite | Graphics;
}

interface Particle {
  gfx: Graphics;
  vx: number;
  vy: number;
  ttl: number;
  maxTtl: number;
  fade: boolean;
  /** Scale growth per second (for expanding rings). */
  expand?: number;
}

const COLOR_YOU = 0x4ad29a;
const COLOR_OPP = 0xe06c75;
const COLOR_BULLET_YOU = 0x9be7c4;
const COLOR_BULLET_OPP = 0xff8a8a;

export type FxCallback = (ev: { kind: string; x?: number; y?: number; who?: number; victim?: number; obstacle?: boolean }) => void;

export class PixiRenderer {
  private app: Application;
  private world: Container;
  private bgLayer: Container;
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
  private textures: Partial<Record<SpriteSlot, Texture>> = {};
  private gifBuffers: Partial<Record<SpriteSlot, ArrayBuffer>> = {};
  private playerCharTex = new Map<number, Texture>();
  private playerCharGif = new Map<number, AnimatedGIF>();
  private playerWeaponTex = new Map<number, Texture>();
  private playerBulletTex = new Map<number, Texture>();
  /** Ability sound audio elements per player id. */
  private playerAbilitySound = new Map<number, HTMLAudioElement>();
  /** Ability icon texture per player id. */
  private playerAbilityIconTex = new Map<number, Texture>();
  /** Screen shake remaining ms and amplitude. */
  private shakeMs = 0;
  private shakeAmp = 0;
  /** Whether audio has been unlocked by a user gesture. */
  private audioUnlocked = false;
  private readonly unlockAudio = (): void => {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    for (const snd of this.playerAbilitySound.values()) {
      snd.muted = true;
      void snd.play().then(() => { snd.pause(); snd.muted = false; snd.currentTime = 0; }).catch(() => undefined);
    }
    document.removeEventListener('pointerdown', this.unlockAudio);
    document.removeEventListener('keydown', this.unlockAudio);
  };
  private flipY = false;
  private flipDecided = false;
  onEvent: FxCallback | null = null;

  constructor(private readonly host: HTMLElement) {
    this.app = new Application();
    this.world = new Container();
    this.bgLayer = new Container();
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
    this.world.addChild(this.bgLayer);
    this.world.addChild(this.fxLayer);
    // Sprite assets are loaded in the background. Players are drawn with
    // fallback Graphics shapes until their textures arrive — this prevents
    // the renderer from blocking startup on slow asset downloads, which would
    // make the player stare at a blank background while snapshots are dropped.
    void this.loadSprites().catch(() => undefined);
    this.drawArena();
    this.app.ticker.add(() => this.tick(this.app.ticker!.deltaMS));
    window.addEventListener('resize', this.handleResize);
    // Unlock audio on first user interaction (required by browsers).
    document.addEventListener('pointerdown', this.unlockAudio);
    document.addEventListener('keydown', this.unlockAudio);
    this.handleResize();
  }

  destroy(): void {
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('pointerdown', this.unlockAudio);
    document.removeEventListener('keydown', this.unlockAudio);
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
    // Per-player sprites (admin-uploaded, sent via welcome).
    for (const wp of [welcome.you, welcome.opponent]) {
      if (wp.characterSpriteUrl) {
        if (wp.characterSpriteUrl.toLowerCase().endsWith('.gif')) {
          AnimatedGIF.fromURL(wp.characterSpriteUrl)
            .then((gif) => {
              gif.loop = true;
              gif.play();
              this.playerCharGif.set(wp.id, gif);
              this.swapInPlayerSprites(wp.id);
            })
            .catch(() => undefined);
        } else {
          Assets.load<Texture>(wp.characterSpriteUrl)
            .then((tex) => {
              this.playerCharTex.set(wp.id, tex);
              this.swapInPlayerSprites(wp.id);
            })
            .catch(() => undefined);
        }
      }
      if (wp.weaponSpriteUrl) {
        Assets.load<Texture>(wp.weaponSpriteUrl)
          .then((tex) => {
            this.playerWeaponTex.set(wp.id, tex);
            this.swapInPlayerSprites(wp.id);
          })
          .catch(() => undefined);
      }
      if (wp.bulletSpriteUrl) {
        Assets.load<Texture>(wp.bulletSpriteUrl)
          .then((tex) => { this.playerBulletTex.set(wp.id, tex); })
          .catch(() => undefined);
      }
      if (wp.ability?.soundUrl) {
        const audio = new Audio(wp.ability.soundUrl);
        audio.preload = 'auto';
        this.playerAbilitySound.set(wp.id, audio);
      }
      if (wp.ability?.iconUrl) {
        Assets.load<Texture>(wp.ability.iconUrl)
          .then((tex) => { this.playerAbilityIconTex.set(wp.id, tex); })
          .catch(() => undefined);
      }
    }
  }

  /** Replace body/weapon sprites of an existing player view with per-player textures. */
  private swapInPlayerSprites(playerId: number): void {
    const view = this.players.get(playerId);
    if (!view) return;
    const charGif = this.playerCharGif.get(playerId);
    const charTex = this.playerCharTex.get(playerId);
    if (charGif || charTex) {
      if (view.bodySprite) {
        try { view.bodySprite.destroy(); } catch { /* ignore */ }
      }
      let sp: Sprite;
      if (charGif) {
        sp = charGif;
        const scale = (PLAYER_RADIUS * 2.2) / Math.max(charGif.width || 1, charGif.height || 1);
        sp.scale.set(scale);
      } else {
        sp = new Sprite(charTex!);
        const scale = (PLAYER_RADIUS * 2.2) / Math.max(charTex!.width, charTex!.height);
        sp.scale.set(scale);
      }
      sp.anchor.set(0.5);
      view.root.addChildAt(sp, 1); // above bodyG (index 0)
      view.bodySprite = sp;
    }
    const weapTex = this.playerWeaponTex.get(playerId);
    if (weapTex) {
      if (view.weaponSprite) {
        try { view.weaponSprite.destroy(); } catch { /* ignore */ }
      }
      const sp = new Sprite(weapTex);
      sp.anchor.set(0.2, 0.5);
      const wscale = (PLAYER_RADIUS * 1.4) / Math.max(weapTex.height, 1);
      sp.scale.set(wscale);
      view.root.addChild(sp);
      view.weaponSprite = sp;
    }
  }

  getYouCanvasPos(): { x: number; y: number } | null {
    const p = this.players.get(this.youId);
    if (!p) return null;
    const t = this.world.worldTransform;
    return { x: p.curX * t.a + t.tx, y: p.curY * t.d + t.ty };
  }

  getOppCanvasPos(): { x: number; y: number } | null {
    for (const [id, p] of this.players) {
      if (id !== this.youId) {
        const t = this.world.worldTransform;
        return { x: p.curX * t.a + t.tx, y: p.curY * t.d + t.ty };
      }
    }
    return null;
  }

  /** True when the camera mirrors the world by Y so YOU is always at the bottom. */
  isFlipped(): boolean {
    return this.flipY;
  }

  applySnapshot(snap: SSnapshot): void {
    this.snapTime = performance.now();

    // First snapshot: decide camera flip so YOU are always at the bottom.
    if (!this.flipDecided) {
      const you = snap.players.find((p) => p.id === this.youId);
      if (you) {
        this.flipY = you.y < MAP_HEIGHT / 2;
        this.flipDecided = true;
        // Re-emit obstacles so they get the correct mapped Y.
        this.drawObstacles();
      }
    }

    const seen = new Set<number>();
    for (const p of snap.players) {
      seen.add(p.id);
      this.upsertPlayer(this.mapPlayer(p));
    }
    for (const [id, view] of this.players) {
      if (!seen.has(id)) {
        view.root.destroy({ children: true });
        this.players.delete(id);
      }
    }

    const seenB = new Set<number>();
    for (const b of snap.bullets) {
      seenB.add(b.id);
      this.upsertBullet(this.mapBullet(b));
    }
    for (const [id, view] of this.bullets) {
      if (!seenB.has(id)) {
        view.display.destroy();
        this.bullets.delete(id);
      }
    }

    for (const ev of snap.events) {
      const mapped = this.mapEvent(ev);
      this.handleEvent(mapped);
      this.onEvent?.(mapped as Parameters<FxCallback>[0]);
    }
  }

  private mapY(y: number): number {
    return this.flipY ? MAP_HEIGHT - y : y;
  }
  private mapAngle(a: number): number {
    return this.flipY ? -a : a;
  }
  private mapPlayer(p: SnapshotPlayer): SnapshotPlayer {
    if (!this.flipY) return p;
    return { ...p, y: MAP_HEIGHT - p.y, angle: -p.angle };
  }
  private mapBullet(b: SnapshotBullet): SnapshotBullet {
    if (!this.flipY) return b;
    return { ...b, y: MAP_HEIGHT - b.y, vy: -b.vy };
  }
  private mapEvent(ev: SnapshotEvent): SnapshotEvent {
    if (!this.flipY || ev.y === undefined) return ev;
    return { ...ev, y: MAP_HEIGHT - Number(ev.y) };
  }

  private async loadSprites(): Promise<void> {
    let registry: Record<string, SpriteRegistryRow> = {};
    try {
      const res = await fetch('/api/sprites', { credentials: 'include', cache: 'no-store' });
      if (res.ok) registry = (await res.json()) as Record<string, SpriteRegistryRow>;
      // eslint-disable-next-line no-console
      console.info('[renderer] /api/sprites →', Object.keys(registry));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[renderer] failed to fetch /api/sprites', e);
    }
    const tasks: Array<Promise<void>> = [];
    for (const slot of Object.keys(registry) as SpriteSlot[]) {
      const row = registry[slot];
      if (!row) continue;
      const isGif = row.url.split('?')[0].toLowerCase().endsWith('.gif');
      if (isGif) {
        tasks.push(
          fetch(row.url)
            .then((r) => r.arrayBuffer())
            .then((buf) => {
              this.gifBuffers[slot] = buf;
              // eslint-disable-next-line no-console
              console.info('[renderer] loaded GIF buffer', slot, 'from', row.url);
            })
            .catch((err) => {
              // eslint-disable-next-line no-console
              console.warn('[renderer] FAILED to load GIF', slot, row.url, err);
            }),
        );
      } else {
        tasks.push(
          Assets.load<Texture>(row.url)
            .then((tex) => {
              this.textures[slot] = tex;
              // eslint-disable-next-line no-console
              console.info('[renderer] loaded', slot, '=', tex.width, '×', tex.height, 'from', row.url);
            })
            .catch((err) => {
              // eslint-disable-next-line no-console
              console.warn('[renderer] FAILED to load', slot, row.url, err);
            }),
        );
      }
    }
    await Promise.all(tasks);
  }

  private handleEvent(ev: SnapshotEvent): void {
    if (ev.kind === 'shoot') {
      this.spawnMuzzleFlash(Number(ev.x ?? 0), Number(ev.y ?? 0), Number(ev.who) === this.youId);
    } else if (ev.kind === 'hit') {
      const isObstacle = Boolean(ev.obstacle);
      this.spawnSparks(Number(ev.x ?? 0), Number(ev.y ?? 0), isObstacle ? 0xc9a06a : 0xffd166, isObstacle ? 6 : 12);
    } else if (ev.kind === 'death') {
      const view = this.players.get(Number(ev.who));
      if (view) this.spawnSparks(view.curX, view.curY, view.isYou ? COLOR_YOU : COLOR_OPP, 32);
    } else if (ev.kind === 'ability') {
      const who = Number(ev.who);
      const type = String(ev.type ?? 'dash');
      const evX = Number(ev.x ?? 0);
      const evY = Number(ev.y ?? 0);
      const view = this.players.get(who);
      // Play sound for both players
      const snd = this.playerAbilitySound.get(who);
      if (snd) { snd.currentTime = 0; void snd.play().catch(() => undefined); }
      if (!view) return;
      const color = view.isYou ? COLOR_YOU : COLOR_OPP;
      if (type === 'dash') {
        this.spawnDashTrail(evX, evY, color);
      } else if (type === 'blink') {
        // Origin: dissolve sparks; Destination: arrival ring
        const fromX = Number(ev.fromX ?? view.curX);
        const fromY = Number(ev.fromY ?? view.curY);
        this.spawnSparks(fromX, fromY, 0xaa88ff, 18);
        this.spawnBlinkEntry(evX, evY);
      } else if (type === 'shield') {
        this.spawnShieldRing(evX, evY, color);
      } else if (type === 'slow') {
        // Slow wave from caster
        this.spawnSlowField(evX, evY);
        // Debuff effect on victim
        const victimView = this.players.get(Number(ev.victim ?? -1));
        if (victimView) this.spawnSlowDebuff(victimView.curX, victimView.curY);
      } else if (type === 'triple_shot') {
        this.spawnSparks(evX, evY, 0xffdd44, 10);
      } else if (type === 'bomb') {
        this.spawnBombWave(evX, evY, color);
        this.shakeMs = 320;
        this.shakeAmp = 10;
      } else if (type === 'heal') {
        this.spawnHealBurst(evX, evY);
        this.spawnHealParticles(evX, evY);
      }
    }
  }

  private upsertPlayer(p: SnapshotPlayer): void {
    const isYou = p.id === this.youId;
    let view = this.players.get(p.id);
    if (!view) {
      const root = new Container();
      this.world.addChild(root);
      const bodyG = new Graphics();
      const weaponG = new Graphics();
      const hpG = new Graphics();
      root.addChild(bodyG);
      // Optional sprite-based body — prefer per-player GIF, then per-player texture, then slot GIF/texture.
      const charGif = this.playerCharGif.get(p.id);
      const slotGifBuf = charGif ? null : this.gifBuffers[isYou ? 'player_you' : 'player_opp'];
      const bodyTex = (charGif || slotGifBuf) ? null : (this.playerCharTex.get(p.id) ?? this.textures[isYou ? 'player_you' : 'player_opp']);
      let bodySprite: Sprite | null = null;
      if (charGif) {
        charGif.anchor.set(0.5);
        const scale = (PLAYER_RADIUS * 2.2) / Math.max(charGif.width || 1, charGif.height || 1);
        charGif.scale.set(scale);
        root.addChild(charGif);
        bodySprite = charGif;
      } else if (slotGifBuf) {
        const gif = AnimatedGIF.fromBuffer(slotGifBuf);
        gif.loop = true;
        gif.play();
        gif.anchor.set(0.5);
        const scale = (PLAYER_RADIUS * 2.2) / Math.max(gif.width || 1, gif.height || 1);
        gif.scale.set(scale);
        root.addChild(gif);
        bodySprite = gif;
      } else if (bodyTex) {
        bodySprite = new Sprite(bodyTex);
        bodySprite.anchor.set(0.5);
        // Scale so longer side ≈ player diameter * 2
        const scale = (PLAYER_RADIUS * 2.2) / Math.max(bodyTex.width, bodyTex.height);
        bodySprite.scale.set(scale);
        root.addChild(bodySprite);
      }
      // Weapon
      root.addChild(weaponG);
      const weaponTex = this.playerWeaponTex.get(p.id) ?? this.textures.weapon;
      let weaponSprite: Sprite | null = null;
      if (weaponTex) {
        weaponSprite = new Sprite(weaponTex);
        weaponSprite.anchor.set(0.2, 0.5); // pivot near grip
        const wscale = (PLAYER_RADIUS * 1.4) / Math.max(weaponTex.height, 1);
        weaponSprite.scale.set(wscale);
        root.addChild(weaponSprite);
      }
      root.addChild(hpG);
      const label = new Text({
        text: '',
        style: { fill: 0xffffff, fontSize: 14, fontFamily: 'monospace', stroke: { color: 0x000000, width: 3 } },
      });
      label.anchor.set(0.5, 1);
      this.world.addChild(label);
      view = {
        root,
        bodyG,
        bodySprite,
        weaponG,
        weaponSprite,
        hpG,
        label,
        prevX: p.x,
        prevY: p.y,
        curX: p.x,
        curY: p.y,
        prevAngle: p.angle,
        curAngle: p.angle,
        hp: p.hp,
        isYou,
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

    view.bodyG.clear();
    view.weaponG.clear();
    view.hpG.clear();

    // Shadow always (gives sense of ground)
    view.bodyG.ellipse(0, PLAYER_RADIUS - 2, PLAYER_RADIUS, PLAYER_RADIUS * 0.4)
      .fill({ color: 0x000000, alpha: 0.35 });

    if (view.bodySprite) {
      // Sprite body — keep sprite visible, only add aura/shadow via graphics
      view.bodySprite.alpha = p.hp > 0 ? 1 : 0.3;
      view.bodySprite.rotation = view.curAngle; // sprite assumed facing right
    } else {
      // Procedural body
      view.bodyG.circle(0, 0, PLAYER_RADIUS)
        .fill({ color, alpha: p.hp > 0 ? 1 : 0.3 })
        .stroke({ color: dark, width: 2, alignment: 1 });
      view.bodyG.circle(-PLAYER_RADIUS * 0.3, -PLAYER_RADIUS * 0.3, PLAYER_RADIUS * 0.35)
        .fill({ color: 0xffffff, alpha: 0.18 });
    }

    if (view.weaponSprite) {
      view.weaponSprite.rotation = view.curAngle;
      view.weaponSprite.x = Math.cos(view.curAngle) * PLAYER_RADIUS * 0.6;
      view.weaponSprite.y = Math.sin(view.curAngle) * PLAYER_RADIUS * 0.6;
      view.weaponSprite.alpha = p.hp > 0 ? 1 : 0.3;
    } else if (!view.bodySprite) {
      // procedural facing triangle
      const cos = Math.cos(view.curAngle);
      const sin = Math.sin(view.curAngle);
      const tipX = cos * (PLAYER_RADIUS + 14);
      const tipY = sin * (PLAYER_RADIUS + 14);
      const px = -sin * 6;
      const py = cos * 6;
      view.weaponG.poly([
        tipX, tipY,
        cos * PLAYER_RADIUS + px, sin * PLAYER_RADIUS + py,
        cos * PLAYER_RADIUS - px, sin * PLAYER_RADIUS - py,
      ]).fill({ color: 0xffffff, alpha: 0.95 });
    } else {
      // Sprite body w/o weapon sprite — small triangle pointer
      const cos = Math.cos(view.curAngle);
      const sin = Math.sin(view.curAngle);
      view.weaponG
        .moveTo(cos * (PLAYER_RADIUS + 4), sin * (PLAYER_RADIUS + 4))
        .lineTo(cos * (PLAYER_RADIUS + 12), sin * (PLAYER_RADIUS + 12))
        .stroke({ color: 0xffffff, width: 3 });
    }

    if (dashing) {
      view.weaponG.circle(0, 0, PLAYER_RADIUS + 8).stroke({ color: 0xffffff, alpha: 0.5, width: 2 });
    }

    // Persistent buff rings (drawn every snapshot tick)
    const hasShield = (p.buffs ?? []).includes('shield');
    const isSlowed = (p.buffs ?? []).includes('slow_victim');
    if (hasShield) {
      // Pulsing blue-white ring — alpha varies with time so it "breathes"
      const pulse = 0.55 + Math.sin(Date.now() / 140) * 0.25;
      view.bodyG
        .circle(0, 0, PLAYER_RADIUS + 11).stroke({ color: 0x88ccff, alpha: pulse, width: 3 })
        .circle(0, 0, PLAYER_RADIUS + 6).stroke({ color: 0xffffff, alpha: pulse * 0.4, width: 1.5 });
    }
    if (isSlowed) {
      // Cyan chain ring — shows victim is slowed
      view.bodyG
        .circle(0, 0, PLAYER_RADIUS + 9).stroke({ color: 0x22ddff, alpha: 0.8, width: 2.5 })
        .circle(0, 0, PLAYER_RADIUS + 5).stroke({ color: 0x22ddff, alpha: 0.3, width: 1 });
    }

    // HP bar
    const w = 50;
    view.hpG.rect(-w / 2, -PLAYER_RADIUS - 14, w, 5).fill({ color: 0x000000, alpha: 0.5 });
    view.hpG.rect(-w / 2, -PLAYER_RADIUS - 14, (w * Math.max(0, p.hp)) / 100, 5).fill({
      color: p.hp > 50 ? 0x4ad29a : p.hp > 25 ? 0xf5c518 : 0xe06c75,
    });

    view.label.text = view.isYou ? 'YOU' : 'OPP';
    view.label.x = view.curX;
    view.label.y = view.curY - PLAYER_RADIUS - 22;
  }

  private upsertBullet(b: SnapshotBullet): void {
    let view = this.bullets.get(b.id);
    if (!view) {
      const perPlayerTex = this.playerBulletTex.get(b.owner);
      const tex = perPlayerTex ?? this.textures.bullet;
      let display: Sprite | Graphics;
      if (tex) {
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        const sc = (BULLET_RADIUS * 2.5) / Math.max(tex.width, tex.height);
        s.scale.set(sc);
        display = s;
      } else {
        const g = new Graphics();
        const color = b.owner === this.youId ? COLOR_BULLET_YOU : COLOR_BULLET_OPP;
        g.circle(0, 0, BULLET_RADIUS + 2).fill({ color, alpha: 0.35 })
          .circle(0, 0, BULLET_RADIUS).fill({ color: 0xffffff });
        display = g;
      }
      this.world.addChild(display);
      view = { display };
      this.bullets.set(b.id, view);
    }
    view.display.x = b.x;
    view.display.y = b.y;
    if ((b.vx !== 0 || b.vy !== 0) && view.display instanceof Sprite) {
      view.display.rotation = Math.atan2(b.vy, b.vx);
    }
  }

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
      g.circle(0, 0, 1.5 + Math.random() * 2.5).fill({ color });
      g.x = x;
      g.y = y;
      this.fxLayer.addChild(g);
      const ttl = 250 + Math.random() * 350;
      this.particles.push({ gfx: g, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl, maxTtl: ttl, fade: true });
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

  private spawnShieldRing(x: number, y: number, color: number): void {
    // Outer expanding ring
    const outer = new Graphics();
    outer.circle(0, 0, PLAYER_RADIUS + 14).stroke({ color: 0x88ccff, alpha: 0.9, width: 4 });
    outer.x = x;
    outer.y = y;
    this.fxLayer.addChild(outer);
    this.particles.push({ gfx: outer, vx: 0, vy: 0, ttl: 600, maxTtl: 600, fade: true, expand: 1.2 });
    // Inner solid glow
    const inner = new Graphics();
    inner.circle(0, 0, PLAYER_RADIUS + 8).fill({ color: 0x88ccff, alpha: 0.25 });
    inner.x = x;
    inner.y = y;
    this.fxLayer.addChild(inner);
    this.particles.push({ gfx: inner, vx: 0, vy: 0, ttl: 400, maxTtl: 400, fade: true });
    void color;
  }

  private spawnBombWave(x: number, y: number, color: number): void {
    // Center flash
    const flash = new Graphics();
    flash.circle(0, 0, PLAYER_RADIUS + 4).fill({ color: 0xff8800, alpha: 0.85 });
    flash.x = x;
    flash.y = y;
    this.fxLayer.addChild(flash);
    this.particles.push({ gfx: flash, vx: 0, vy: 0, ttl: 180, maxTtl: 180, fade: true });
    // Expanding shockwave rings
    for (let r = 1; r <= 3; r++) {
      const g = new Graphics();
      g.circle(0, 0, r * 30).stroke({ color: r === 1 ? 0xffcc44 : 0xff6600, alpha: 0.85, width: 3 });
      g.x = x;
      g.y = y;
      this.fxLayer.addChild(g);
      this.particles.push({ gfx: g, vx: 0, vy: 0, ttl: 350 + r * 100, maxTtl: 350 + r * 100, fade: true, expand: 1.5 + r * 0.5 });
    }
    // Debris sparks
    this.spawnSparks(x, y, 0xff8800, 20);
    void color;
  }

  private spawnHealBurst(x: number, y: number): void {
    // Expanding green ring
    const ring = new Graphics();
    ring.circle(0, 0, PLAYER_RADIUS + 6).stroke({ color: 0x44ff88, alpha: 0.9, width: 3 });
    ring.x = x;
    ring.y = y;
    this.fxLayer.addChild(ring);
    this.particles.push({ gfx: ring, vx: 0, vy: 0, ttl: 500, maxTtl: 500, fade: true, expand: 1.8 });
    // Solid glow
    const glow = new Graphics();
    glow.circle(0, 0, PLAYER_RADIUS + 10).fill({ color: 0x44ff88, alpha: 0.35 });
    glow.x = x;
    glow.y = y;
    this.fxLayer.addChild(glow);
    this.particles.push({ gfx: glow, vx: 0, vy: 0, ttl: 380, maxTtl: 380, fade: true });
  }

  private spawnHealParticles(x: number, y: number): void {
    // Green "+" cross particles flying upward
    for (let i = 0; i < 6; i++) {
      const g = new Graphics();
      g.rect(-1, -5, 2, 10).fill({ color: 0x44ff88 });
      g.rect(-5, -1, 10, 2).fill({ color: 0x44ff88 });
      g.x = x + (Math.random() - 0.5) * 30;
      g.y = y + (Math.random() - 0.5) * 20;
      this.fxLayer.addChild(g);
      const ttl = 600 + Math.random() * 400;
      this.particles.push({ gfx: g, vx: (Math.random() - 0.5) * 40, vy: -(60 + Math.random() * 80), ttl, maxTtl: ttl, fade: true });
    }
  }

  private spawnBlinkEntry(x: number, y: number): void {
    // Arrival ring burst
    const ring = new Graphics();
    ring.circle(0, 0, PLAYER_RADIUS + 4).stroke({ color: 0xcc88ff, alpha: 1, width: 3 });
    ring.x = x;
    ring.y = y;
    this.fxLayer.addChild(ring);
    this.particles.push({ gfx: ring, vx: 0, vy: 0, ttl: 350, maxTtl: 350, fade: true, expand: 1.5 });
    // Sparkle at destination
    this.spawnSparks(x, y, 0xcc88ff, 14);
  }

  private spawnSlowField(x: number, y: number): void {
    // Expanding cyan slow wave rings
    for (let r = 1; r <= 2; r++) {
      const g = new Graphics();
      g.circle(0, 0, r * 35).stroke({ color: 0x22ddff, alpha: 0.8, width: 2.5 });
      g.x = x;
      g.y = y;
      this.fxLayer.addChild(g);
      this.particles.push({ gfx: g, vx: 0, vy: 0, ttl: 500 + r * 150, maxTtl: 500 + r * 150, fade: true, expand: 1.0 + r * 0.4 });
    }
    this.spawnSparks(x, y, 0x22ddff, 10);
  }

  private spawnSlowDebuff(x: number, y: number): void {
    // Blue-cyan flash on victim
    const g = new Graphics();
    g.circle(0, 0, PLAYER_RADIUS + 8).fill({ color: 0x22ddff, alpha: 0.4 });
    g.x = x;
    g.y = y;
    this.fxLayer.addChild(g);
    this.particles.push({ gfx: g, vx: 0, vy: 0, ttl: 400, maxTtl: 400, fade: true });
    // Downward particles ("slowed" feeling)
    for (let i = 0; i < 5; i++) {
      const p = new Graphics();
      p.circle(0, 0, 2.5).fill({ color: 0x22ddff });
      p.x = x + (Math.random() - 0.5) * 24;
      p.y = y - PLAYER_RADIUS;
      this.fxLayer.addChild(p);
      const ttl = 400 + Math.random() * 300;
      this.particles.push({ gfx: p, vx: (Math.random() - 0.5) * 20, vy: 30 + Math.random() * 40, ttl, maxTtl: ttl, fade: true });
    }
  }

  private tick(dtMs: number): void {
    const since = performance.now() - this.snapTime;
    const t = Math.max(0, Math.min(1, since / 33));
    for (const v of this.players.values()) {
      const x = v.prevX + (v.curX - v.prevX) * t;
      const y = v.prevY + (v.curY - v.prevY) * t;
      v.root.x = x;
      v.root.y = y;
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
      if (p.expand) {
        p.gfx.scale.x += p.expand * dt / 1000;
        p.gfx.scale.y += p.expand * dt / 1000;
      }
      if (p.fade) p.gfx.alpha = p.ttl / p.maxTtl;
    }
    if (this.shakeMs > 0) this.shakeMs = Math.max(0, this.shakeMs - dt);
    this.updateCamera();
  }

  private updateCamera(): void {
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    const s = this.cameraScale;
    this.world.x = (W - MAP_WIDTH * s) / 2;
    this.world.y = (H - MAP_HEIGHT * s) / 2;
    if (this.shakeMs > 0) {
      const amp = (this.shakeMs / 300) * this.shakeAmp;
      this.world.x += (Math.random() - 0.5) * amp;
      this.world.y += (Math.random() - 0.5) * amp;
    }
  }

  private handleResize = (): void => {
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    this.cameraScale = Math.min(W / MAP_WIDTH, H / MAP_HEIGHT);
    this.world.scale.set(this.cameraScale);
    this.updateCamera();
  };

  private drawArena(): void {
    this.bgLayer.removeChildren();
    const tile = this.textures.bg_tile;
    if (tile) {
      const ts = new TilingSprite({ texture: tile, width: MAP_WIDTH, height: MAP_HEIGHT });
      this.bgLayer.addChild(ts);
    } else {
      const bg = new Graphics();
      bg.rect(0, 0, MAP_WIDTH, MAP_HEIGHT).fill({ color: 0x161b22 });
      bg.circle(MAP_WIDTH / 2, MAP_HEIGHT / 2, 60).stroke({ color: 0x21262d, width: 2 });
      bg.circle(MAP_WIDTH / 2, MAP_HEIGHT / 2, 20).stroke({ color: 0x21262d, width: 2 });
      for (let x = 0; x <= MAP_WIDTH; x += 80) {
        bg.moveTo(x, 0).lineTo(x, MAP_HEIGHT).stroke({ color: 0x21262d, width: 1 });
      }
      for (let y = 0; y <= MAP_HEIGHT; y += 80) {
        bg.moveTo(0, y).lineTo(MAP_WIDTH, y).stroke({ color: 0x21262d, width: 1 });
      }
      this.bgLayer.addChild(bg);
    }
    // Border
    const border = new Graphics();
    border.rect(0, 0, MAP_WIDTH, MAP_HEIGHT).stroke({ color: 0x30363d, width: 4 });
    this.bgLayer.addChild(border);
  }

  private drawObstacles(): void {
    if (this.obstaclesLayer) this.obstaclesLayer.destroy({ children: true });
    const layer = new Container();
    this.obstaclesLayer = layer;
    // place above bg (idx 1) but below players/fx
    this.world.addChildAt(layer, 1);
    for (const ob of this.obstacles) {
      const ox = ob.x;
      const oy = this.flipY ? MAP_HEIGHT - ob.y - ob.h : ob.y;
      const kind: SpriteSlot = ob.kind === 'barrel' ? 'barrel' : ob.kind === 'wall' ? 'wall' : 'crate';
      const gifBuf = this.gifBuffers[kind];
      const tex = this.textures[kind];
      if (gifBuf) {
        // Each obstacle needs its own AnimatedGIF instance — display objects can't have multiple parents.
        const gif = AnimatedGIF.fromBuffer(gifBuf);
        gif.loop = true;
        gif.play();
        gif.x = ox;
        gif.y = oy;
        gif.width = ob.w;
        gif.height = ob.h;
        layer.addChild(gif);
      } else if (tex) {
        const s = new Sprite(tex);
        s.x = ox;
        s.y = oy;
        s.width = ob.w;
        s.height = ob.h;
        layer.addChild(s);
      } else {
        const g = new Graphics();
        drawObstacleProcedural(g, ob);
        g.x = ox;
        g.y = oy;
        layer.addChild(g);
      }
    }
  }
}

function drawObstacleProcedural(g: Graphics, ob: Obstacle): void {
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
