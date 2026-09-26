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
  const labelLayer = document.createElement('div');
  const label = document.createElement('button');
  const labelText = document.createElement('span');
  labelText.textContent = '地球';
  label.append(labelText);
  labelLayer.append(label);
  stage.append(labelLayer);
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
  const groundDrag: number[][] = [];
  bindTrackpadInput(canvas, {
    mode: () => mode,
    zoom: (delta, source) => {
      zoomCalls++;
      if (mode === 'ground') groundZoom += delta;
      else dispatchOrbitZoom(canvas, delta, source);
    },
    rotate: (dx, dy) => {
      if (mode === 'ground') groundDrag.push([dx, dy]);
      else rotateTrackpadCamera(camera, controls, dx, dy, canvas.clientHeight);
    },
    pan: (dx, dy) => {
      panCalls++;
      panTrackpadCamera(camera, controls, dx, dy, canvas.clientHeight);
    },
  }, abort.signal, [labelLayer]);
  return {
    canvas, camera, controls, abort, label, labelText,
    get mode() { return mode; },
    set mode(value: NavigationMode) { mode = value; },
    get groundZoom() { return groundZoom; },
    get zoomCalls() { return zoomCalls; },
    get panCalls() { return panCalls; },
    groundDrag,
    distance: () => camera.position.distanceTo(controls.target),
    dispose: () => { abort.abort(); controls.dispose(); canvas.remove(); labelLayer.remove(); },
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

await run('纵向双指拖移只旋转，距离和目标保持不变', h => {
  const before = h.distance();
  const position = h.camera.position.clone();
  const target = h.controls.target.clone();
  const event = wheel(h.canvas, 0, 30);
  check(event.defaultPrevented, '画布滚动未阻止页面默认行为');
  check(h.zoomCalls === 0, '纵向拖移不应调用缩放');
  check(h.camera.position.distanceTo(position) > 0.01, '纵向拖移没有旋转');
  check(h.controls.target.distanceTo(target) < 1e-8, '旋转改变了目标');
  close(h.distance(), before, '纵向旋转距离');
});

await run('浏览器 Ctrl 捏合按十倍增益缩放一次', h => {
  const before = h.distance();
  wheel(h.canvas, 0, -5, { ctrlKey: true });
  check(h.zoomCalls === 1, `捏合回调次数为 ${h.zoomCalls}`);
  close(h.distance() / before, orbitFactor(-50), '捏合倍率');
});

await run('真实 Ctrl 按键不会把双指拖移当成捏合', h => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', bubbles: true }));
  const before = h.distance();
  wheel(h.canvas, 0, -5, { ctrlKey: true });
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }));
  check(h.zoomCalls === 0, '真实 Ctrl 不应识别为捏合');
  close(h.distance(), before, '真实 Ctrl 拖移后的距离');
});

await run('斜向双指拖移同时旋转两个方向，相机目标和距离不变', h => {
  const before = h.distance();
  const target = h.controls.target.clone();
  wheel(h.canvas, 24, 2);
  check(Math.abs(h.camera.position.x) > 0.01, '相机没有水平旋转');
  check(Math.abs(h.camera.position.y) > 0.01, '相机没有垂直旋转');
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

await run('天空视角双指拖移调整方向，只有捏合缩放', h => {
  h.mode = 'ground';
  const before = h.distance();
  wheel(h.canvas, 0, 2, { deltaMode: 1 });
  check(h.groundZoom === 0, '天空纵向拖移不应缩放');
  check(h.groundDrag.length === 1 && h.groundDrag[0][1] === 32, '天空纵向拖移未归一化');
  wheel(h.canvas, 0, 2, { deltaMode: 1, ctrlKey: true });
  check(Number(h.groundZoom) === 300, '天空捏合缩放未按增益和限幅处理');
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

await run('光标经过标签及其子元素时，二维旋转保持连续且不触发点击', h => {
  const target = h.controls.target.clone();
  const distance = h.distance();
  let clicks = 0;
  h.label.addEventListener('click', () => { clicks++; });
  for (const surface of [h.canvas, h.label, h.labelText, h.canvas]) {
    const before = h.camera.position.clone();
    const event = wheel(surface, 12, 7);
    check(event.defaultPrevented, '标签上的手势未被处理');
    check(h.camera.position.distanceTo(before) > 0.01, '经过标签后旋转中断');
    close(h.distance(), distance, '标签旋转不应改变距离');
    check(h.controls.target.distanceTo(target) < 1e-8, '标签旋转改变了中心');
  }
  check(h.zoomCalls === 0 && clicks === 0, '标签拖移误触发缩放或点击');
  h.label.click();
  check(Number(clicks) === 1, '标签点击功能被拦截');
});

await run('标签上的捏合与 Shift 平移沿用画布逻辑', h => {
  const distance = h.distance();
  wheel(h.labelText, 0, -5, { ctrlKey: true });
  check(h.zoomCalls === 1, '标签捏合未处理或重复缩放');
  close(h.distance() / distance, orbitFactor(-50), '标签捏合倍率');
  wheel(h.label, 10, 8, { shiftKey: true });
  check(h.panCalls === 1, '标签上的 Shift 平移被阻断');
  h.mode = 'blocked';
  const before = h.camera.position.clone();
  check(wheel(h.label, 5, 5).defaultPrevented, '转场时标签未阻止默认手势');
  check(h.camera.position.distanceTo(before) < 1e-8, '标签绕过了转场输入限制');
});

await run('Safari 捏合跨越画布和标签时共享去重状态', h => {
  const distance = h.distance();
  gesture(h.canvas, 'gesturestart', 1);
  gesture(h.labelText, 'gesturechange', 1.05);
  wheel(h.label, 0, -2, { ctrlKey: true });
  check(h.zoomCalls === 1, '标签的 Safari 捏合被漏掉或重复处理');
  gesture(h.canvas, 'gesturechange', 1.1025);
  close(h.distance() / distance, 1 / 1.1025, '跨标签捏合倍率', 1e-6);
  gesture(h.label, 'gestureend', 1.1025);
  const before = h.camera.position.clone();
  wheel(h.canvas, 10, 0);
  check(h.camera.position.distanceTo(before) > 0.01, '标签上结束捏合后旋转仍被阻塞');
});

await run('Abort 同时移除标签层的输入监听', h => {
  h.abort.abort();
  check(!wheel(h.labelText, 10, 5).defaultPrevented, '标签层的监听没有清理');
  check(h.zoomCalls === 0 && h.panCalls === 0, '清理后仍处理标签手势');
});

summary.textContent = `${passed} 项通过，${failed} 项失败`;
document.title = `触控板浏览器测试 · ${passed} 通过 / ${failed} 失败`;
document.body.dataset.testStatus = failed === 0 ? 'passed' : 'failed';
