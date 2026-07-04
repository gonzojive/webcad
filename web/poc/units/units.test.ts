import assert from 'node:assert';
import test from 'node:test';
import { parseLength, formatLength } from './units.js';

function assertCloseTo(actual: number, expected: number, delta: number) {
  assert.ok(Math.abs(actual - expected) <= delta, `Expected ${actual} to be close to ${expected} within ${delta}`);
}

test('parseLength parses basic numbers and default unit', () => {
  assert.strictEqual(parseLength('10'), 10);
  assert.strictEqual(parseLength('10.5'), 10.5);
  assert.strictEqual(parseLength(' 10.5 '), 10.5);
  assertCloseTo(parseLength('.5'), 0.5, 0.0001);
  assertCloseTo(parseLength('-.25'), -0.25, 0.0001);
});

test('parseLength parses metric units', () => {
  assert.strictEqual(parseLength('10mm'), 10);
  assert.strictEqual(parseLength('5cm'), 50);
  assert.strictEqual(parseLength('1.5m'), 1500);
});

test('parseLength parses imperial units', () => {
  assertCloseTo(parseLength('1in'), 25.4, 0.0001);
  assertCloseTo(parseLength('2inch'), 50.8, 0.0001);
  assertCloseTo(parseLength('3inches'), 76.2, 0.0001);
  assertCloseTo(parseLength('1ft'), 304.8, 0.0001);
  assertCloseTo(parseLength('1foot'), 304.8, 0.0001);
  assertCloseTo(parseLength('2feet'), 609.6, 0.0001);
  assertCloseTo(parseLength('1\''), 304.8, 0.0001);
  assertCloseTo(parseLength('1"'), 25.4, 0.0001);
  assertCloseTo(parseLength('.5in'), 12.7, 0.0001);
});

test('parseLength parses case-insensitively', () => {
  assert.strictEqual(parseLength('10MM'), 10);
  assertCloseTo(parseLength('1IN'), 25.4, 0.0001);
  assertCloseTo(parseLength('1Ft'), 304.8, 0.0001);
});

test('parseLength parses expressions with addition/subtraction', () => {
  assertCloseTo(parseLength('1ft + 3in'), 304.8 + 76.2, 0.0001);
  assertCloseTo(parseLength('1ft 3in'), 304.8 + 76.2, 0.0001);
  assertCloseTo(parseLength('1\' 3"'), 304.8 + 76.2, 0.0001);
  assertCloseTo(parseLength('10mm - 2mm'), 8, 0.0001);
  assertCloseTo(parseLength('10mm+-2mm'), 8, 0.0001);
});

test('parseLength respects default unit, including ft-in mapping', () => {
  assert.strictEqual(parseLength('10', 'mm'), 10);
  assertCloseTo(parseLength('1', 'ft-in'), 25.4, 0.0001); // ft-in defaults to inches
});

test('parseLength throws on invalid input', () => {
  assert.throws(() => parseLength(''));
  assert.throws(() => parseLength('  '));
  assert.throws(() => parseLength('10abc'));
  assert.throws(() => parseLength('1ft + 3xyz'));
  assert.throws(() => parseLength('1ft foo 3in')); // non-consecutive invalid characters
  assert.throws(() => parseLength('1ft * 3in'));
});

test('formatLength formats units correctly', () => {
  assert.strictEqual(formatLength(10, 'mm'), '10.00mm');
  assert.strictEqual(formatLength(50, 'cm'), '5.00cm');
  assert.strictEqual(formatLength(25.4, 'in'), '1.00in');
  assert.strictEqual(formatLength(304.8, 'ft'), '1.00ft');
  assert.strictEqual(formatLength(330.2, 'ft-in'), '1ft 1.00in');
  assert.strictEqual(formatLength(-330.2, 'ft-in'), '-1ft 1.00in');
  assert.strictEqual(formatLength(-12.7, 'ft-in'), '-0.50in');
});

