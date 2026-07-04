import { GCSapi } from '@webcad/gcsapi';

const gcs = new GCSapi();
const result = gcs.solve();

const outputDiv = document.getElementById('output');
if (outputDiv) {
    outputDiv.innerText = `GCS Solver Result: ${result}`;
}
console.log(`GCS Solver Result: ${result}`);
