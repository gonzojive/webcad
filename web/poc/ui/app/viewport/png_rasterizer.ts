import { initWasm, Resvg } from '@resvg/resvg-wasm';

let wasmInitialized = false;

/**
 * Initializes the @resvg/resvg-wasm module.
 * 
 * In the browser, it defaults to fetching the WASM module from '/ui/resvg_index_bg.wasm'.
 * Headless or Node.js environments can pass a custom URL or pre-loaded Uint8Array buffer.
 *
 * @param wasmSource Optional custom URL or Uint8Array buffer containing the WASM binary.
 */
export async function initializeResvgWasm(wasmSource?: string | Uint8Array): Promise<void> {
    if (wasmInitialized) {
        return;
    }

    const source = wasmSource ?? '/ui/resvg_index_bg.wasm';
    await initWasm(source as any);
    wasmInitialized = true;
}

/**
 * Rasterizes an SVG XML string into a base64-encoded PNG data URL.
 *
 * Ensures the WebAssembly module is initialized before rendering.
 */
export async function rasterizeSVG(svgString: string): Promise<string> {
    await initializeResvgWasm();
    const resvg = new Resvg(svgString);
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    
    // Convert Uint8Array to base64 safely without node-Buffer dependency
    let binary = '';
    const len = pngBuffer.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(pngBuffer[i]);
    }
    const base64 = btoa(binary);
    return `data:image/png;base64,${base64}`;
}
