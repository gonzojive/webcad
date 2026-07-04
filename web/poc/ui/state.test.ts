import assert from 'node:assert';
import test from 'node:test';
import { GCSapi } from '../gcsapi/gcsapi.js';

test('GCSapi solve works', () => {
    const gcs = new GCSapi();
    assert.strictEqual(gcs.solve(), 'solved');
});
