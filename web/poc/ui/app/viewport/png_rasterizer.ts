import { initWasm, Resvg } from '@resvg/resvg-wasm';

let wasmInitialized = false;

/**
 * Initializes the @resvg/resvg-wasm module.
 *
 * Automatically detects whether it is running in a Node.js (JSDOM test) environment
 * or a web browser, and loads the WebAssembly binary accordingly.
 */
export async function initializeResvgWasm(): Promise<void> {
    if (wasmInitialized) {
        return;
    }

    const isNode = typeof globalThis !== 'undefined' && !!(globalThis as any).process?.versions?.node;

    if (isNode) {
        // Node.js environment (JSDOM testing under Bazel)
        // Use variable names to prevent esbuild from statically analyzing and bundling Node modules
        const fsName = 'node:fs';
        const urlName = 'node:url';
        const fs = await import(fsName);
        const url = await import(urlName);
        
        const wasmUrl = (import.meta as any).resolve('@resvg/resvg-wasm/index_bg.wasm');
        const wasmPath = url.fileURLToPath(wasmUrl);
        const wasmBuffer = fs.readFileSync(wasmPath);
        await initWasm(wasmBuffer);
    } else {
        // Browser environment
        await initWasm('/ui/resvg_index_bg.wasm');
    }

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
