const fs = require("node:fs");
const path = require("node:path");
const sqlite3 = require("sqlite3").verbose();

module.exports = function(guid, projectDir) {
    if (!guid) return;

    const inputDir = path.join(projectDir, "data", "output");
    const dbPath = path.join(projectDir, "data", "cache.db");

    // Initialize SQLite database
    const db = new sqlite3.Database(dbPath);
    db.serialize(() => {
        db.run("CREATE TABLE IF NOT EXISTS cache (guid TEXT PRIMARY KEY, data TEXT)");
    });

    // Check if the GUID is already in the cache
    return new Promise((resolve, reject) => {
        const retryDelay = 200; // milliseconds
        const maxRetries = Infinity;
        let attempts = 0;

        function queryCache() {
            db.get("SELECT data FROM cache WHERE guid = ?", [guid], (err, row) => {
                if (err) {
                    if (err.code === 'SQLITE_BUSY' && attempts < maxRetries) {
                        attempts++;
                        return setTimeout(queryCache, retryDelay);
                    }
                    db.close();
                    return reject(err);
                }

                if (row) {
                    db.close();
                    return resolve({ message: `GUID: ${guid} found in cache.`, data: JSON.parse(row.data) });
                }

                function findFileByGuid(dir) {
                    const items = fs.readdirSync(dir);

                    for (const item of items) {
                        const itemPath = path.join(dir, item);
                        const stats = fs.statSync(itemPath);

                        if (stats.isDirectory()) {
                            const found = findFileByGuid(itemPath);
                            if (found) {
                                return found;
                            }
                        } else if (stats.isFile()) {
                            const fileContent = fs.readFileSync(itemPath, "utf-8");
                            try {
                                const data = JSON.parse(fileContent)[0];
                                if (data.guid === guid) {
                                    return data.MonoBehaviour;
                                }
                            } catch (error) {}
                        }
                    }

                    return null;
                }

                // Find GUID in the file system
                const foundData = findFileByGuid(inputDir);

                if (foundData) {
                    // Store the found GUID and its data in the cache
                    db.run("INSERT INTO cache (guid, data) VALUES (?, ?)", [guid, JSON.stringify(foundData)], (err) => {
                        db.close();
                        if (err) {
                            return resolve({ message: `[WARN] Failed to store GUID: ${guid} in cache. Retried ${attempts} times.`, data: foundData });
                        }
                        return resolve({ message: `GUID: ${guid} found and stored in cache.`, data: foundData });
                    });
                } else {
                    db.close();
                    return resolve({ message: `GUID: ${guid} not found.`, data: null });
                }
            });
        }

        queryCache();
    });
};