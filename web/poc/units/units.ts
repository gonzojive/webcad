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

  // Regex to match value and unit groups. Supports signs, decimals (including leading dot).
  // Order of units matters! Longer prefixes must be placed first to prevent partial match (e.g., 'in' matching inside 'inch').
  const regex = /([+-]?\s*(?:\d+(?:\.\d+)?|\.\d+))\s*(mm|cm|m|inches|inch|in|feet|foot|ft|'|")?/gi;
  let totalMm = 0;
  let matchCount = 0;
  let lastIndex = 0;

  let match;
  while ((match = regex.exec(normalized)) !== null) {
    matchCount++;
    
    // Check gap between matches to ensure no invalid characters are skipped
    const gap = normalized.substring(lastIndex, match.index);
    if (/[^+\s]/.test(gap)) {
      throw new Error(`Invalid characters in expression: "${gap}"`);
    }

    const valueStr = match[1].replace(/\s+/g, ''); // strip spaces in case of "+ 3"
    const value = parseFloat(valueStr);
    const unit = match[2];

    const resolvedDefault = defaultUnit.toLowerCase() === 'ft-in' ? 'in' : defaultUnit.toLowerCase();
    const conversion = unit ? UNIT_TO_MM[unit.toLowerCase()] : UNIT_TO_MM[resolvedDefault];
    if (conversion === undefined) {
      throw new Error(`Unknown unit: ${unit}`);
    }

    totalMm += value * conversion;
    lastIndex = regex.lastIndex;
  }

  // If we couldn't parse anything, or there are dangling unparsed chars, throw error.
  if (matchCount === 0 || normalized.substring(lastIndex).trim() !== '') {
    throw new Error(`Invalid length expression: "${str}"`);
  }

  return totalMm;
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

