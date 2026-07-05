import assert from 'node:assert';
import test from 'node:test';
import { parseLength, formatLength } from './units.js';
import { parse, evaluate } from './expression.js';

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

test('expression parser produces correct AST', () => {
  assert.deepStrictEqual(parse('1ft + 3in'), [
    '+',
    ['*', { const: 1 }, { symbol: 'ft' }],
    ['*', { const: 3 }, { symbol: 'in' }],
  ]);

  assert.deepStrictEqual(parse('1ft 3in'), [
    '+',
    ['*', { const: 1 }, { symbol: 'ft' }],
    ['*', { const: 3 }, { symbol: 'in' }],
  ]);

  assert.deepStrictEqual(parse('1ft - 3in'), [
    '-',
    ['*', { const: 1 }, { symbol: 'ft' }],
    ['*', { const: 3 }, { symbol: 'in' }],
  ]);

  assert.deepStrictEqual(parse('1ft * 3'), [
    '*',
    ['*', { const: 1 }, { symbol: 'ft' }],
    { const: 3 },
  ]);

  assert.deepStrictEqual(parse('1ft / 3'), [
    '/',
    ['*', { const: 1 }, { symbol: 'ft' }],
    { const: 3 },
  ]);

  assert.deepStrictEqual(parse('-1ft'), [
    '-',
    { const: 0 },
    ['*', { const: 1 }, { symbol: 'ft' }],
  ]);

  assert.deepStrictEqual(parse('(1ft + 3in) * 2'), [
    '*',
    [
      '+',
      ['*', { const: 1 }, { symbol: 'ft' }],
      ['*', { const: 3 }, { symbol: 'in' }],
    ],
    { const: 2 },
  ]);
});

test('expression evaluator handles dimensions and values', () => {
  const context = { ft: 304.8, in: 25.4, mm: 1.0 };
  const defaultUnitVal = 1.0; // mm

  // 1ft + 3in = 304.8 + 76.2 = 381
  const res1 = evaluate(parse('1ft + 3in'), context, defaultUnitVal);
  assertCloseTo(res1.value, 381, 0.0001);
  assert.strictEqual(res1.dim, 1);

  // 1ft * 3 = 914.4
  const res2 = evaluate(parse('1ft * 3'), context, defaultUnitVal);
  assertCloseTo(res2.value, 914.4, 0.0001);
  assert.strictEqual(res2.dim, 1);

  // 1ft / 3 = 101.6
  const res3 = evaluate(parse('1ft / 3'), context, defaultUnitVal);
  assertCloseTo(res3.value, 101.6, 0.0001);
  assert.strictEqual(res3.dim, 1);

  // 1ft * 3in = 304.8 * 76.2 = 23225.76 (dim 2)
  const res4 = evaluate(parse('1ft * 3in'), context, defaultUnitVal);
  assertCloseTo(res4.value, 23225.76, 0.0001);
  assert.strictEqual(res4.dim, 2);

  // 1ft / 3in = 4 (dim 0)
  const res5 = evaluate(parse('1ft / 3in'), context, defaultUnitVal);
  assertCloseTo(res5.value, 4, 0.0001);
  assert.strictEqual(res5.dim, 0);

  // Dimension mismatch: 1ft + (2 * 3) -> length + scalar
  assert.throws(() => evaluate(parse('1ft + (2 * 3)'), context, defaultUnitVal));
});

test('parseLength supports new expression features', () => {
  // Multiplication by scalar
  assertCloseTo(parseLength('1ft * 3'), 914.4, 0.0001);
  assertCloseTo(parseLength('3 * 1ft'), 914.4, 0.0001);
  
  // Division by scalar
  assertCloseTo(parseLength('1ft / 3'), 101.6, 0.0001);

  // Complex expression: (1ft + 3in) * 2 = 15in * 2 = 30in = 762mm
  assertCloseTo(parseLength('(1ft + 3in) * 2'), 762, 0.0001);

  // Invalid dimension: 1ft * 3in (area)
  assert.throws(() => parseLength('1ft * 3in'));

  // Invalid dimension: 1ft / 3in (scalar)
  assert.throws(() => parseLength('1ft / 3in'));
});


