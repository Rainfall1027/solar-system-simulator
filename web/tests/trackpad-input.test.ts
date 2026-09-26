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
    assert.deepEqual(classifyWheel(wheel({ deltaY })), { kind: 'rotate', x: 0, y: deltaY });
    assert.deepEqual(classifyWheel(wheel({ deltaY: -deltaY })), { kind: 'rotate', x: 0, y: -deltaY });
  }
  assert.deepEqual(classifyWheel(wheel()), { kind: 'none', x: 0, y: 0 });
});

test('横向、纵向、斜向拖移均旋转，保留两个方向且不缩放', () => {
  for (const [x, y] of [[20, 0], [0, 20], [20, 2], [-20, -2], [2, 20], [-2, -20], [12.5, 10], [12.51, 10]]) {
    assert.deepEqual(classifyWheel(wheel({ deltaX: x, deltaY: y })), { kind: 'rotate', x, y });
  }
});

test('Shift 平移保持不变，旋转无需 Alt', () => {
  assert.deepEqual(classifyWheel(wheel({ deltaX: 3, deltaY: -12, shiftKey: true })),
    { kind: 'pan', x: 3, y: -12 });
  assert.deepEqual(classifyWheel(wheel({ deltaX: 3, deltaY: -12, altKey: true })),
    { kind: 'rotate', x: 3, y: -12 });
  assert.deepEqual(classifyWheel(wheel({ shiftKey: true })), { kind: 'none', x: 0, y: 0 });
});

test('仅浏览器捏合信号缩放，真实 Ctrl 按键仍按拖移处理', () => {
  const input = wheel({ deltaX: 8, deltaY: -2, ctrlKey: true, shiftKey: true, altKey: true });
  assert.deepEqual(normalizeWheel(input), { x: 8, y: -20, pinch: true });
  assert.deepEqual(classifyWheel(input), { kind: 'zoom', x: 0, y: -20 });
  assert.deepEqual(normalizeWheel(input, true), { x: 8, y: -2, pinch: false });
  assert.deepEqual(classifyWheel(input, true), { kind: 'pan', x: 8, y: -2 });
  assert.deepEqual(classifyWheel(wheel({ deltaY: 5, ctrlKey: true }), true), { kind: 'rotate', x: 0, y: 5 });
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
    { kind: 'rotate', x: 400, y: 1000 });
  assert.deepEqual(classifyWheel(wheel({ deltaY: 1000, ctrlKey: true })),
    { kind: 'zoom', x: 0, y: 300 });
});
