import test from 'node:test';
import assert from 'node:assert/strict';
import { openNativeDatePicker } from './date-picker';

test('date selection area opens the attached native picker when showPicker is supported', () => {
  let opened = 0;
  const input = { focus() {}, click() {}, showPicker() { opened++; } };
  assert.equal(openNativeDatePicker(input), true);
  assert.equal(opened, 1);
});

test('date selection area falls back to focus and click without recursing through the input click event', () => {
  let focused = 0;
  let clicked = 0;
  let input: { focus(): void; click(): void };
  input = { focus() { focused++; }, click() { clicked++; openNativeDatePicker(input); } };
  assert.equal(openNativeDatePicker(input), true);
  assert.equal(focused, 2);
  assert.equal(clicked, 1);
});

test('date picker gracefully handles a missing input ref', () => {
  assert.equal(openNativeDatePicker(null), false);
});
