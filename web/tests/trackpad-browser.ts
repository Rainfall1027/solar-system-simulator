import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { bindTrackpadInput, dispatchOrbitZoom, type NavigationMode } from '../src/trackpad-input.ts';
import { rotateTrackpadCamera, panTrackpadCamera } from '../src/trackpad-camera.ts';

const stage = document.querySelector<HTMLElement>('#stage')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
let passed = 0;
let failed = 0;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function close(actual: number, expected: number, message: string, tolerance = 1e-8): void {
  check(Math.abs(actual - expected) <= tolerance, `${message}：实际 ${actual}，预期 ${expected}`);
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function createHarness() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 400;
  stage.append(canvas);
  const camera = new THREE.PerspectiveCamera(45, 640 / 400, 0.01, 1000);
  camera.position.set(0, 0, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.zoomSpeed = 0.72;
  controls.target.set(0, 0, 0);
  controls.update();
  const abort = new AbortController();
  let mode: NavigationMode = 'overview';
  let groundZoom = 0;
  let zoomCalls = 0;
  let panCalls = 0;
  bindTrackpadInput(canvas, {
    mode: () => mode,
    zoom: (delta, source) => {
      zoomCalls++;
      if (mode === 'ground') groundZoom += delta;
      else dispatchOrbitZoom(canvas, delta, source);
    },
    rotate: (dx, dy) => rotateTrackpadCamera(camera, controls, dx, dy, canvas.clientHeight),
    pan: (dx, dy) => {
      panCalls++;
      panTrackpadCamera(camera, controls, dx, dy, canvas.clientHeight);
    },
  }, abort.signal);
  return {
    canvas, camera, controls, abort,
    get mode() { return mode; },
    set mode(value: NavigationMode) { mode = value; },
    get groundZoom() { return groundZoom; },
    get zoomCalls() { return zoomCalls; },
    get panCalls() { return panCalls; },
    distance: () => camera.position.distanceTo(controls.target),
    dispose: () => { abort.abort(); controls.dispose(); canvas.remove(); },
  };
}

type Harness = ReturnType<typeof createHarness>;

function wheel(target: EventTarget, deltaX: number, deltaY: number, options: WheelEventInit = {}): WheelEvent {
  const event = new WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

function gesture(target: EventTarget, type: string, scale: number): Event {
  const event = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(event, 'scale', { value: scale });
  target.dispatchEvent(event);
  return event;
}

async function run(name: string, body: (h: Harness) => void | Promise<void>): Promise<void> {
  const h = createHarness();
  const item = document.createElement('li');
  const eventErrors: string[] = [];
  const onError = (event: ErrorEvent) => { eventErrors.push(event.message); };
  window.addEventListener('error', onError);
  try {
    await body(h);
    check(eventErrors.length === 0, `事件处理器异常：${eventErrors.join('；')}`);
    item.className = 'pass';
    item.textContent = `通过：${name}`;
    passed++;
  } catch (error) {
    item.className = 'fail';
    item.textContent = `失败：${name}\n${error instanceof Error ? error.stack ?? error.message : String(error)}`;
    failed++;
  } finally {
    window.removeEventListener('error', onError);
    h.dispose();
    results.append(item);
  }
}

const orbitFactor = (delta: number) => Math.pow(0.95, -0.72 * delta / 100);

await run('纵向滚动仅缩放一次，幅度与 OrbitControls 一致', h => {
  const before = h.distance();
  const event = wheel(h.canvas, 0, 80);
  check(event.defaultPrevented, '画布滚动未阻止页面默认行为');
  check(h.zoomCalls === 1, `缩放回调次数为 ${h.zoomCalls}`);
  close(h.distance() / before, orbitFactor(80), '缩放倍率');
});

await run('浏览器 Ctrl 捏合按十倍增益缩放一次', h => {
  const before = h.distance();
  wheel(h.canvas, 0, -5, { ctrlKey: true });
  check(h.zoomCalls === 1, `捏合回调次数为 ${h.zoomCalls}`);
  close(h.distance() / before, orbitFactor(-50), '捏合倍率');
});

await run('真实 Ctrl 按键不触发捏合增益', h => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', bubbles: true }));
  const before = h.distance();
  wheel(h.canvas, 0, -5, { ctrlKey: true });
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }));
  close(h.distance() / before, orbitFactor(-5), '真实 Ctrl 的缩放倍率');
});

await run('横向滚动只旋转，相机目标和距离不变', h => {
  const before = h.distance();
  const target = h.controls.target.clone();
  wheel(h.canvas, 24, 2);
  check(Math.abs(h.camera.position.x) > 0.01, '相机没有旋转');
  close(h.distance(), before, '旋转后的距离');
  check(h.controls.target.distanceTo(target) < 1e-8, '旋转改变了目标');
  check(h.zoomCalls === 0, '横向滚动触发了缩放');
});

await run('Shift 平移使相机与目标同步移动', h => {
  const camera = h.camera.position.clone();
  const target = h.controls.target.clone();
  const before = h.distance();
  wheel(h.canvas, 15, -10, { shiftKey: true });
  check(h.panCalls === 1, '平移回调未执行一次');
  const cameraMove = h.camera.position.clone().sub(camera);
  const targetMove = h.controls.target.clone().sub(target);
  check(cameraMove.length() > 0.01, '相机没有平移');
  check(cameraMove.distanceTo(targetMove) < 1e-8, '相机和目标没有同步移动');
  close(h.distance(), before, '平移后的距离');
});

await run('近景禁止平移', h => {
  h.mode = 'focus';
  const before = h.camera.position.clone();
  wheel(h.canvas, 10, 20, { shiftKey: true });
  check(h.panCalls === 0, '近景调用了平移');
  check(h.camera.position.distanceTo(before) < 1e-8, '近景相机移动了');
});

await run('地面视角接收归一化滚动而不驱动 OrbitControls', h => {
  h.mode = 'ground';
  const before = h.distance();
  wheel(h.canvas, 0, 2, { deltaMode: 1 });
  check(h.groundZoom === 32, `地面视角收到 ${h.groundZoom}，预期 32`);
  close(h.distance(), before, '地面视角相机距离');
});

await run('过渡期间阻止默认滚动且不改变相机', h => {
  h.mode = 'blocked';
  const before = h.camera.position.clone();
  const event = wheel(h.canvas, 0, 70);
  check(event.defaultPrevented, '过渡期间未阻止默认滚动');
  check(h.zoomCalls === 0 && h.panCalls === 0, '过渡期间仍处理输入');
  check(h.camera.position.distanceTo(before) < 1e-8, '过渡期间相机移动了');
});

await run('Safari 累计 scale 只按每次增量缩放，且不重复处理 wheel', async h => {
  const before = h.distance();
  gesture(h.canvas, 'gesturestart', 1);
  gesture(h.canvas, 'gesturechange', 1.05);
  check(h.zoomCalls === 1, '首次手势变化未缩放一次');
  gesture(h.canvas, 'gesturechange', 1.05);
  check(h.zoomCalls === 1, '相同 scale 导致重复缩放');
  wheel(h.canvas, 0, -2, { ctrlKey: true });
  check(h.zoomCalls === 1, '同一 Safari 手势的 wheel 被重复处理');
  gesture(h.canvas, 'gesturechange', 1.1025);
  check(Number(h.zoomCalls) === 2, '第二次 scale 增量未执行');
  close(h.distance() / before, 1 / 1.1025, '累计手势倍率', 1e-6);
  gesture(h.canvas, 'gestureend', 1.1025);
  wheel(h.canvas, 0, -2, { ctrlKey: true });
  check(Number(h.zoomCalls) === 2, '手势结束后的重复 wheel 被处理');
  await nextFrame();
});

await run('触屏指针期间保留原生手势', h => {
  // 合成 pointerdown 不会创建浏览器的真实活动指针，不能要求其捕获指针。
  // 此用例只验证适配器不会接管触屏事件；触屏旋转仍由 OrbitControls 负责。
  h.controls.enabled = false;
  h.canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 81, pointerType: 'touch', isPrimary: true, bubbles: true }));
  const start = gesture(h.canvas, 'gesturestart', 1);
  const change = gesture(h.canvas, 'gesturechange', 1.2);
  check(!start.defaultPrevented && !change.defaultPrevented, '触屏原生手势被阻止');
  check(h.zoomCalls === 0, '触屏手势被当作触控板手势');
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 81, pointerType: 'touch', bubbles: true }));
});

await run('Abort 后不再处理触控板事件', h => {
  h.abort.abort();
  h.controls.enabled = false;
  const before = h.distance();
  const event = wheel(h.canvas, 0, 30);
  check(!event.defaultPrevented, 'Abort 后事件仍被拦截');
  check(h.zoomCalls === 0, 'Abort 后仍调用缩放回调');
  close(h.distance(), before, 'Abort 后相机距离');
});

await run('侧栏滚动不被画布监听器拦截', h => {
  const sidebar = document.createElement('div');
  document.body.append(sidebar);
  try {
    const event = wheel(sidebar, 0, 30);
    check(!event.defaultPrevented, '侧栏滚动被画布拦截');
    check(h.zoomCalls === 0, '侧栏滚动改变了画布');
  } finally {
    sidebar.remove();
  }
});

summary.textContent = `${passed} 项通过，${failed} 项失败`;
document.title = `触控板浏览器测试 · ${passed} 通过 / ${failed} 失败`;
document.body.dataset.testStatus = failed === 0 ? 'passed' : 'failed';
