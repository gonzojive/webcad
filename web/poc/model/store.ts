import { GCSSketchState } from '../../../ts/gcsapi/dist/index.js';
import { SketchModel } from './sketch.js';

export class SketchStore {
    private readonly dbName = 'WebCADSketcherDB';
    private readonly storeName = 'SketchStateStore';
    private readonly key = 'currentSketch';

    private getDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async save(sketch: SketchModel): Promise<void> {
        try {
            const db = await this.getDB();
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            store.put(sketch, this.key);
        } catch (e) {
            console.error('Failed to save sketch to IndexedDB:', e);
        }
    }

    async load(): Promise<SketchModel | null> {
        try {
            const db = await this.getDB();
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.get(this.key);
            
            return new Promise<SketchModel | null>((resolve) => {
                request.onsuccess = () => {
                    const saved = request.result as SketchModel | undefined;
                    if (saved) {
                        resolve({
                            points: saved.points || [],
                            lines: saved.lines || [],
                            circles: saved.circles || [],
                            constraints: saved.constraints || [],
                            revision: saved.revision !== undefined ? saved.revision : 0
                        });
                    } else {
                        resolve(null);
                    }
                };
                request.onerror = () => {
                    console.error('Failed to load sketch from IndexedDB:', request.error);
                    resolve(null);
                };
            });
        } catch (e) {
            console.error('Failed to initialize IndexedDB for loading:', e);
            return null;
        }
    }
}
