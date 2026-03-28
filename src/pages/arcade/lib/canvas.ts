export const setupHiDPICanvas = (canvas: HTMLCanvasElement) => {
  const resize = (cssWidth: number, cssHeight: number) => {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, dpr };
  };

  return { resize };
};

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

export const isCoarsePointer = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;
