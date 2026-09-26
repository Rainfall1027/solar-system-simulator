/** 画布的输入归属由主视图决定。 */
export type NavigationMode = 'overview' | 'focus' | 'ground' | 'blocked';

export interface WheelInput {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type WheelAction = {
  kind: 'zoom' | 'rotate' | 'pan' | 'none';
  x: number;
  y: number;
};

type InputOptions = {
  mode: () => NavigationMode;
  zoom: (delta: number, source: WheelEvent) => void;
  rotate: (dx: number, dy: number) => void;
  pan: (dx: number, dy: number) => void;
};

const MAX_ZOOM_DELTA = 300;
const ORBIT_ZOOM_EXPONENT = -Math.log(0.95) * 0.72 / 100;
const syntheticWheelEvents = new WeakSet<WheelEvent>();

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampZoom(value: number): number {
  return Math.max(-MAX_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, finite(value)));
}

/** 与当前 OrbitControls 的行、页及触控板捏合换算保持一致。 */
export function normalizeWheel(input: WheelInput, controlPressed = false): { x: number; y: number; pinch: boolean } {
  const unit = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? 100 : 1;
  const pinch = Boolean(input.ctrlKey && !controlPressed);
  return {
    x: finite(input.deltaX * unit),
    y: finite(input.deltaY * unit * (pinch ? 10 : 1)),
    pinch,
  };
}

/** 捏合、修饰键和水平主导的手势按固定优先级分类。 */
export function classifyWheel(input: WheelInput, controlPressed = false): WheelAction {
  const { x, y } = normalizeWheel(input, controlPressed);
  if (input.ctrlKey) return y === 0 ? { kind: 'none', x: 0, y: 0 } : { kind: 'zoom', x: 0, y: clampZoom(y) };
  if (input.shiftKey) return x === 0 && y === 0 ? { kind: 'none', x: 0, y: 0 } : { kind: 'pan', x, y };
  if (input.altKey) return x === 0 && y === 0 ? { kind: 'none', x: 0, y: 0 } : { kind: 'rotate', x, y };
  if (Math.abs(x) > Math.abs(y) * 1.25) return { kind: 'rotate', x, y: 0 };
  return y === 0 ? { kind: 'none', x: 0, y: 0 } : { kind: 'zoom', x: 0, y: clampZoom(y) };
}

/** 将已归一化的缩放交给 OrbitControls，复用其中心、限距和阻尼逻辑。 */
export function dispatchOrbitZoom(element: HTMLElement, delta: number, source: WheelEvent): void {
  const wheel = new WheelEvent('wheel', {
    deltaY: clampZoom(delta),
    deltaMode: 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    clientX: source.clientX,
    clientY: source.clientY,
    bubbles: false,
    cancelable: true,
  });
  syntheticWheelEvents.add(wheel);
  try {
    element.dispatchEvent(wheel);
  } finally {
    syntheticWheelEvents.delete(wheel);
  }
}

type ScaleGesture = Event & { scale?: number; clientX?: number; clientY?: number };

/** 只接管指定画布上的滚轮和 Safari 手势；所有监听随 signal 一起移除。 */
export function bindTrackpadInput(element: HTMLElement, options: InputOptions, signal: AbortSignal): void {
  const pointers = new Map<number, string>();
  let controlPressed = false;
  let gestureScale: number | null = null;
  let gestureActive = false;
  let suppressPinchWheelUntil = 0;

  const sendZoom = (delta: number, source: WheelEvent): void => {
    const limited = clampZoom(delta);
    if (limited !== 0) options.zoom(limited, source);
  };

  const onWheel = (event: WheelEvent): void => {
    if (syntheticWheelEvents.has(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const mode = options.mode();
    if (mode === 'blocked' || pointers.size > 0 || gestureActive) return;
    if (event.ctrlKey && performance.now() < suppressPinchWheelUntil) return;
    const action = classifyWheel(event, controlPressed);
    switch (action.kind) {
      case 'zoom':
        sendZoom(action.y, event);
        break;
      case 'rotate':
        options.rotate(action.x, action.y);
        break;
      case 'pan':
        if (mode === 'overview' || mode === 'ground') options.pan(action.x, action.y);
        break;
    }
  };

  const hasTouchPointer = (): boolean => [...pointers.values()].includes('touch');
  const onGestureStart = (event: Event): void => {
    if (hasTouchPointer()) {
      gestureActive = false;
      gestureScale = null;
      return;
    }
    event.preventDefault();
    if (pointers.size > 0) return;
    const gesture = event as ScaleGesture;
    gestureScale = Number.isFinite(gesture.scale) && gesture.scale! > 0 ? gesture.scale! : null;
    gestureActive = true;
  };
  const onGestureChange = (event: Event): void => {
    if (hasTouchPointer()) return;
    event.preventDefault();
    if (pointers.size > 0) return;
    if (!gestureActive) onGestureStart(event);
    const gesture = event as ScaleGesture;
    const scale = gesture.scale;
    if (!Number.isFinite(scale) || scale === undefined || scale <= 0) {
      gestureScale = null;
      return;
    }
    if (gestureScale === null) {
      gestureScale = scale;
      return;
    }
    const ratio = scale / gestureScale;
    gestureScale = scale;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) return;
    const mode = options.mode();
    if (mode === 'blocked') return;
    const exponent = mode === 'ground' ? 0.0012 : ORBIT_ZOOM_EXPONENT;
    const delta = -Math.log(ratio) / exponent;
    const source = new WheelEvent('wheel', {
      clientX: finite(gesture.clientX ?? element.getBoundingClientRect().left + element.clientWidth / 2),
      clientY: finite(gesture.clientY ?? element.getBoundingClientRect().top + element.clientHeight / 2),
      deltaY: delta,
      deltaMode: 0,
      bubbles: false,
      cancelable: true,
    });
    sendZoom(delta, source);
  };
  const onGestureEnd = (event: Event): void => {
    const touchActive = hasTouchPointer();
    if (!touchActive) event.preventDefault();
    const wasActive = gestureActive;
    gestureActive = false;
    gestureScale = null;
    if (wasActive && !touchActive) suppressPinchWheelUntil = performance.now() + 80;
  };

  element.addEventListener('wheel', onWheel, { capture: true, passive: false, signal });
  element.addEventListener('gesturestart', onGestureStart, { capture: true, passive: false, signal });
  element.addEventListener('gesturechange', onGestureChange, { capture: true, passive: false, signal });
  element.addEventListener('gestureend', onGestureEnd, { capture: true, passive: false, signal });
  element.addEventListener('pointerdown', event => {
    pointers.set(event.pointerId, event.pointerType);
    gestureActive = false;
    gestureScale = null;
  }, { capture: true, signal });
  window.addEventListener('pointerup', event => pointers.delete(event.pointerId), { capture: true, signal });
  window.addEventListener('pointercancel', event => pointers.delete(event.pointerId), { capture: true, signal });
  element.addEventListener('lostpointercapture', event => pointers.delete(event.pointerId), { capture: true, signal });
  document.addEventListener('keydown', event => { if (event.key === 'Control') controlPressed = true; }, { capture: true, signal });
  document.addEventListener('keyup', event => { if (event.key === 'Control') controlPressed = false; }, { capture: true, signal });
  window.addEventListener('blur', () => {
    pointers.clear();
    controlPressed = false;
    gestureActive = false;
    gestureScale = null;
    suppressPinchWheelUntil = 0;
  }, { signal });
}
