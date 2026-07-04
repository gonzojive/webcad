/**
 * Handles IndexedDB persistence for saving and restoring the drawing sketch state.
 */
export class SketchStore {
    constructor() {
        this.dbName = 'WebCADSketcherDB';
        this.storeName = 'SketchStateStore';
        this.key = 'currentSketch';
    }
    /**
     * Opens connection to the IndexedDB database.
     */
    getDB() {
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
    /**
     * Persists the current model state into IndexedDB.
     */
    async save(model) {
        try {
            const db = await this.getDB();
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const state = {
                points: model.getPoints(),
                lines: model.getLines(),
                circles: model.getCircles(),
                constraints: model.getConstraints()
            };
            store.put(state, this.key);
        }
        catch (e) {
            console.error('Failed to save sketch to IndexedDB:', e);
        }
    }
    /**
     * Loads the persisted sketch state and updates the model.
     */
    async load(model) {
        try {
            const db = await this.getDB();
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.get(this.key);
            return new Promise((resolve) => {
                request.onsuccess = () => {
                    const state = request.result;
                    if (state) {
                        model.setSketchData({
                            points: state.points || [],
                            lines: state.lines || [],
                            circles: state.circles || [],
                            constraints: state.constraints || []
                        });
                        console.log('Sketch state loaded from IndexedDB.');
                    }
                    resolve();
                };
                request.onerror = () => {
                    console.error('Failed to load sketch from IndexedDB:', request.error);
                    resolve();
                };
            });
        }
        catch (e) {
            console.error('Failed to initialize IndexedDB for loading:', e);
        }
    }
}
