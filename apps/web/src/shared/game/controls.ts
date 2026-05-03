/**
 * Player input controller — keyboard + mouse + touch joystick.
 * Stateful object polled at frame rate.
 */

export interface InputState {
  dx: number;
  dy: number;
  angle: number;
  fire: boolean;
  ability: boolean;
}

interface JoystickState {
  active: boolean;
  cx: number;
  cy: number;
  dx: number;
  dy: number;
}

export class Controls {
  private keys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private mouseDown = false;
  private abilityHeld = false;
  private joystick: JoystickState = { active: false, cx: 0, cy: 0, dx: 0, dy: 0 };
  private fireTouch = false;
  private abilityTouch = false;

  /** Player position in canvas (CSS) pixels — used to compute aim angle. */
  playerCanvasX = 0;
  playerCanvasY = 0;

  attach(canvas: HTMLElement, joystickEl: HTMLElement, fireBtn: HTMLElement, abilityBtn: HTMLElement): () => void {
    const onKeyDown = (e: KeyboardEvent) => {
      this.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
      }
      if (e.code === 'KeyQ' || e.code === 'ShiftLeft') {
        this.abilityHeld = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyQ' || e.code === 'ShiftLeft') {
        this.abilityHeld = false;
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = false;
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    // Joystick
    const joyTouchStart = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!t) return;
      const rect = joystickEl.getBoundingClientRect();
      this.joystick.active = true;
      this.joystick.cx = rect.left + rect.width / 2;
      this.joystick.cy = rect.top + rect.height / 2;
      this.joystick.dx = 0;
      this.joystick.dy = 0;
      e.preventDefault();
    };
    const joyTouchMove = (e: TouchEvent) => {
      if (!this.joystick.active) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - this.joystick.cx;
      const dy = t.clientY - this.joystick.cy;
      const max = 60;
      const m = Math.hypot(dx, dy);
      const k = m > max ? max / m : 1;
      this.joystick.dx = (dx * k) / max;
      this.joystick.dy = (dy * k) / max;
      e.preventDefault();
    };
    const joyTouchEnd = (e: TouchEvent) => {
      this.joystick.active = false;
      this.joystick.dx = 0;
      this.joystick.dy = 0;
      e.preventDefault();
    };
    joystickEl.addEventListener('touchstart', joyTouchStart, { passive: false });
    joystickEl.addEventListener('touchmove', joyTouchMove, { passive: false });
    joystickEl.addEventListener('touchend', joyTouchEnd, { passive: false });
    joystickEl.addEventListener('touchcancel', joyTouchEnd, { passive: false });

    const fireDown = (e: Event) => {
      this.fireTouch = true;
      e.preventDefault();
    };
    const fireUp = (e: Event) => {
      this.fireTouch = false;
      e.preventDefault();
    };
    fireBtn.addEventListener('touchstart', fireDown, { passive: false });
    fireBtn.addEventListener('touchend', fireUp, { passive: false });
    fireBtn.addEventListener('mousedown', fireDown);
    fireBtn.addEventListener('mouseup', fireUp);

    const abilityDown = (e: Event) => {
      this.abilityTouch = true;
      e.preventDefault();
    };
    const abilityUp = (e: Event) => {
      this.abilityTouch = false;
      e.preventDefault();
    };
    abilityBtn.addEventListener('touchstart', abilityDown, { passive: false });
    abilityBtn.addEventListener('touchend', abilityUp, { passive: false });
    abilityBtn.addEventListener('mousedown', abilityDown);
    abilityBtn.addEventListener('mouseup', abilityUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }

  /** Compute current input. `viewScale` = world units per CSS pixel. */
  read(viewScale: number, canvasW: number, canvasH: number): InputState {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dy += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    if (this.joystick.active) {
      dx = this.joystick.dx;
      dy = this.joystick.dy;
    }
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }

    // Aim — mouse direction relative to player; on touch devices we aim toward joystick or movement.
    let angle = 0;
    if (this.mouseX || this.mouseY) {
      const ax = this.mouseX - this.playerCanvasX;
      const ay = this.mouseY - this.playerCanvasY;
      angle = Math.atan2(ay, ax);
    } else if (m > 0) {
      angle = Math.atan2(dy, dx);
    }

    const fire = this.mouseDown || this.keys.has('Space') || this.fireTouch;
    const ability = this.abilityHeld || this.abilityTouch;

    // Use viewScale/canvas to silence unused warnings — needed if we add zoom later
    void viewScale;
    void canvasW;
    void canvasH;

    return { dx, dy, angle, fire, ability };
  }
}
