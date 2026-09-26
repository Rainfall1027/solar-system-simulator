import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWheel, normalizeWheel, type WheelInput } from '../src/trackpad-input.ts';

const wheel = (overrides: Partial<WheelInput> = {}): WheelInput => ({
  deltaMode: 0,
  deltaX: 0,
  deltaY: 0,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

test('像素、行和页滚动换算成一致的位移', () => {
  const pixel = wheel({ deltaX: 32, deltaY: -48 });
  const line = wheel({ deltaMode: 1, deltaX: 2, deltaY: -3 });
  const page = wheel({ deltaMode: 2, deltaX: 0.32, deltaY: -0.48 });

  assert.deepEqual(normalizeWheel(pixel), { x: 32, y: -48, pinch: false });
  assert.deepEqual(normalizeWheel(line), normalizeWheel(pixel));
  assert.deepEqual(normalizeWheel(page), normalizeWheel(pixel));
  assert.deepEqual(classifyWheel(line), classifyWheel(pixel));
  assert.deepEqual(classifyWheel(page), classifyWheel(pixel));
});

test('连续的微小滚动仍保留方向与幅度', () => {
  const small = [0.04, 0.09, 0.18];
  for (const deltaY of small) {
    assert.deepEqual(classifyWheel(wheel({ deltaY })), { kind: 'zoom', x: 0, y: deltaY });
    assert.deepEqual(classifyWheel(wheel({ deltaY: -deltaY })), { kind: 'zoom', x: 0, y: -deltaY });
  }
  assert.deepEqual(classifyWheel(wheel()), { kind: 'none', x: 0, y: 0 });
});

test('横向滚动旋转，纵向滚动缩放；次轴噪声不改变意图', () => {
  assert.deepEqual(classifyWheel(wheel({ deltaX: 20, deltaY: 2 })), { kind: 'rotate', x: 20, y: 0 });
  assert.deepEqual(classifyWheel(wheel({ deltaX: -20, deltaY: -2 })), { kind: 'rotate', x: -20, y: 0 });
  assert.deepEqual(classifyWheel(wheel({ deltaX: 2, deltaY: 20 })), { kind: 'zoom', x: 0, y: 20 });
  assert.deepEqual(classifyWheel(wheel({ deltaX: -2, deltaY: -20 })), { kind: 'zoom', x: 0, y: -20 });
  assert.equal(classifyWheel(wheel({ deltaX: 12.5, deltaY: 10 })).kind, 'zoom');
  assert.equal(classifyWheel(wheel({ deltaX: 12.51, deltaY: 10 })).kind, 'rotate');
});

test('Shift 平移和 Alt 二维旋转覆盖主轴判断', () => {
  assert.deepEqual(classifyWheel(wheel({ deltaX: 3, deltaY: -12, shiftKey: true })),
    { kind: 'pan', x: 3, y: -12 });
  assert.deepEqual(classifyWheel(wheel({ deltaX: 3, deltaY: -12, altKey: true })),
    { kind: 'rotate', x: 3, y: -12 });
  assert.deepEqual(classifyWheel(wheel({ shiftKey: true })), { kind: 'none', x: 0, y: 0 });
});

test('浏览器捏合信号优先缩放，真实 Ctrl 按键不额外放大', () => {
  const input = wheel({ deltaX: 8, deltaY: -2, ctrlKey: true, shiftKey: true, altKey: true });
  assert.deepEqual(normalizeWheel(input), { x: 8, y: -20, pinch: true });
  assert.deepEqual(classifyWheel(input), { kind: 'zoom', x: 0, y: -20 });
  assert.deepEqual(normalizeWheel(input, true), { x: 8, y: -2, pinch: false });
  assert.deepEqual(classifyWheel(input, true), { kind: 'zoom', x: 0, y: -2 });
});

test('非法和极端滚动值不传入相机控制器', () => {
  assert.deepEqual(normalizeWheel(wheel({ deltaX: Number.NaN, deltaY: Number.POSITIVE_INFINITY })),
    { x: 0, y: 0, pinch: false });
  assert.deepEqual(classifyWheel(wheel({ deltaX: Number.NaN, deltaY: Number.POSITIVE_INFINITY })),
    { kind: 'none', x: 0, y: 0 });
  assert.deepEqual(normalizeWheel(wheel({ deltaX: 1000, deltaY: -1000 })),
    { x: 1000, y: -1000, pinch: false });
  assert.deepEqual(normalizeWheel(wheel({ deltaMode: 2, deltaY: 50, ctrlKey: true })),
    { x: 0, y: 50000, pinch: true });
  assert.deepEqual(classifyWheel(wheel({ deltaX: 400, deltaY: 1000 })),
    { kind: 'zoom', x: 0, y: 300 });
});
