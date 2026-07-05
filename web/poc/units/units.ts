import { parse, evaluate } from './expression.js';

export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'ft-in';

const UNIT_TO_MM: { [key: string]: number } = {
  mm: 1.0,
  cm: 10.0,
  m: 1000.0,
  in: 25.4,
  inch: 25.4,
  inches: 25.4,
  '"': 25.4,
  ft: 304.8,
  foot: 304.8,
  feet: 304.8,
  "'": 304.8,
};

/**
 * Parses a unit string (e.g. "4mm", "2in", "1ft + 3in", "1ft 3in", ".5in") into a canonical value in millimeters.
 * If no unit is specified, the default unit is used.
 */
export function parseLength(str: string, defaultUnit: Unit = 'mm'): number {
  const normalized = str.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Empty input');
  }

  const resolvedDefault = defaultUnit.toLowerCase() === 'ft-in' ? 'in' : defaultUnit.toLowerCase();
  const defaultUnitValue = UNIT_TO_MM[resolvedDefault];
  if (defaultUnitValue === undefined) {
    throw new Error(`Unknown default unit: ${defaultUnit}`);
  }

  try {
    const ast = parse(normalized);
    const result = evaluate(ast, UNIT_TO_MM, defaultUnitValue);
    if (result.dim !== 1) {
      throw new Error(`Expression does not evaluate to a length (dimension ${result.dim})`);
    }
    return result.value;
  } catch (e: any) {
    throw new Error(`Invalid length expression: "${str}". Detail: ${e.message}`);
  }
}

/**
 * Formats a canonical millimeter value to a string using the preferred target unit.
 */
export function formatLength(mm: number, unit: Unit = 'mm'): string {
  const targetUnit = unit.toLowerCase();
  if (targetUnit === 'ft-in') {
    const isNegative = mm < 0;
    const absMm = Math.abs(mm);
    const totalInches = absMm / 25.4;
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    const sign = isNegative ? '-' : '';
    if (feet === 0) {
      return `${sign}${inches.toFixed(2)}in`;
    }
    return `${sign}${feet}ft ${inches.toFixed(2)}in`;
  }

  const conversion = UNIT_TO_MM[targetUnit];
  if (conversion === undefined) {
    throw new Error(`Unknown display unit: ${unit}`);
  }

  const converted = mm / conversion;
  return `${converted.toFixed(2)}${unit}`;
}

