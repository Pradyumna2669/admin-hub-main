export type StickState = {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
};

export const TOUCH_STICK_RADIUS = 58;
export const EMPTY_STICK: StickState = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  x: 0,
  y: 0,
};

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const beginStick = (pointerId: number, x: number, y: number): StickState => ({
  active: true,
  pointerId,
  startX: x,
  startY: y,
  x,
  y,
});

export const moveStick = (stick: StickState, x: number, y: number) => {
  const dx = x - stick.startX;
  const dy = y - stick.startY;
  const distance = Math.hypot(dx, dy);
  const ratio = distance > TOUCH_STICK_RADIUS ? TOUCH_STICK_RADIUS / distance : 1;

  return {
    next: {
      ...stick,
      x: stick.startX + dx * ratio,
      y: stick.startY + dy * ratio,
    },
    normalized: {
      x: (dx * ratio) / TOUCH_STICK_RADIUS,
      y: (dy * ratio) / TOUCH_STICK_RADIUS,
    },
  };
};
