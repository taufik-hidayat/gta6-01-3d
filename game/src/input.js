// Keyboard and pointer input for the 3D game. Held keys give a movement vector each frame;
// one-shot presses (interact, punch, pause, confirm) are queued as bit flags and taken once
// by the loop, so a press between two frames is never lost and never counted twice. Dragging
// with the mouse orbits the camera, and a click fires the pistol.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_INTERACT = 4;
export const ACTION_PUNCH = 8;
export const ACTION_MUTE = 16;
export const ACTION_RETRY = 32;
export const ACTION_SHOOT = 64;

const FORWARD = new Set(['ArrowUp', 'KeyW']);
const BACK = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const INTERACT = new Set(['KeyE']);
const PUNCH = new Set(['KeyF']);
const MUTE = new Set(['KeyM']);
const RETRY = new Set(['KeyR']);

export function createInput(target) {
  const held = new Set();
  let actions = 0;
  let cameraOrbit = 0;
  let dragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let cameraPitch = 0;

  window.addEventListener('keydown', (event) => {
    if (FORWARD.has(event.code) || BACK.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code)
      || RUN.has(event.code)) {
      held.add(event.code);
    } else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (INTERACT.has(event.code)) {
      held.add(event.code);
      if (!event.repeat) actions |= ACTION_INTERACT;
    } else if (PUNCH.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PUNCH;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else if (RETRY.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RETRY;
    } else {
      return;
    }
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.clear();
  });

  target.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  });
  window.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    cameraOrbit -= (event.clientX - lastPointerX) * 0.005;
    cameraPitch = Math.max(-0.15, Math.min(0.35, cameraPitch + (event.clientY - lastPointerY) * 0.002));
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  });
  window.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    dragging = false;
    // A click without a drag is a shot, not a camera move.
    if (Math.abs(event.clientX - lastPointerX) < 4 && Math.abs(event.clientY - lastPointerY) < 4) {
      actions |= ACTION_SHOOT;
    }
  });

  function hasAny(codes) {
    for (const code of codes) if (held.has(code)) return true;
    return false;
  }

  return {
    /** Forward/back: +1 forward (W), -1 back (S). */
    fwd() {
      return (hasAny(FORWARD) ? 1 : 0) - (hasAny(BACK) ? 1 : 0);
    },
    /** Left/right: +1 right (D), -1 left (A). On foot this strafes, in a car it steers. */
    strafe() {
      return (hasAny(RIGHT) ? 1 : 0) - (hasAny(LEFT) ? 1 : 0);
    },
    run() {
      return hasAny(RUN);
    },
    interactHeld() {
      return hasAny(INTERACT);
    },
    /** One-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Camera orbit the player dragged with the mouse, in radians. */
    takeOrbit() {
      const orbit = cameraOrbit;
      cameraOrbit = 0;
      return orbit;
    },
    cameraPitch() {
      return cameraPitch;
    },
  };
}
