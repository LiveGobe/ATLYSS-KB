const fs = require("node:fs").promises;
const path = require("node:path");
const { parentPort, workerData } = require("worker_threads");
const findAssetById = require("../bin/findAssetById");
const jsonToLua = require("../bin/jsonToLua");

const inputDir = path.join(workerData.rawDataPath, "Scenes");
const outputDir = path.join(workerData.projectPath, "data", "parsed", workerData.parser);
const exportJSON = workerData.config.exportJSON ?? false;

let locations = {};

function getDifficulty(val) {
    if (val == 0) return "EASY";
    else if (val == 1) return "NORMAL";
    else if (val == 2) return "HARD";
    return "";
}

function getType(type) {
    if (type == 0) return "Safe";
    if (type == 1) return "Field";
    if (type == 2) return "Dungeon";
    if (type == 3) return "Arena";
    return "";
}

async function readDirectory(inputFolder) {
    const fList = await fs.readdir(inputFolder);

    for (const file of fList) {
        const filePath = path.join(inputFolder, file);
        const stat = await fs.stat(filePath);

        if (stat.isDirectory()) {
            await readDirectory(filePath);
        } else {
            await processFile(filePath);
        }
    }
}

async function processFile(filePath) {
    const data = require(filePath);
    const creepSpawnData = data.filter(v => v.MonoBehaviour?._creepToSpawn);
    const creepArenaData = data.filter(v => v.MonoBehaviour?._creepArenaSlots);
    const mapData = data.filter(v => v.MonoBehaviour?._mapName);

    if (!mapData.length) {
        parentPort.postMessage({ message: `File ${path.basename(filePath)} isn't a valid location` });
        return;
    }

    const mapName = mapData[0]?.MonoBehaviour?._mapName;
    locations[mapName] = {
        name: mapName,
        difficulties: {},
        type: getType(mapData[0]?.MonoBehaviour._zoneType),
        bosses: [],
        creeps: []
    };

    const creeps = {};
    for (const arenaData of creepArenaData) {
        const arena = arenaData?.MonoBehaviour?._creepArenaSlots;
        for (const arenaSlot of arena) {
            const difficulty = getDifficulty(arenaSlot._zoneDifficulty);
            if (!creeps[difficulty]) creeps[difficulty] = [];

            if (arenaSlot._arenaSlotTag && filePath.includes("map_dungeon")) {
                for (const wave of arenaSlot._creepArenaWaves) {
                    for (const creep of wave._creepPool) {
                        const guid = creep?.guid;
                        if (!guid) continue;
                        const asset = await findAssetById(guid, workerData.projectPath);
                        parentPort.postMessage({ message: asset.message });
                        creeps[difficulty].push(asset.data?._creepName);
                    }
                }
            }
        }
    }

    for (const [difficulty, creepList] of Object.entries(creeps)) {
        if (creepList.length) {
            locations[mapName].difficulties[difficulty] = { creeps: [...new Set(creepList)] };
        }
    }

    const addedCreeps = new Set();
    for (const creep of creepSpawnData) {
        const guid = creep?.MonoBehaviour?._creepToSpawn?.guid;
        if (!guid || addedCreeps.has(guid)) continue;
        const asset = await findAssetById(guid, workerData.projectPath);
        parentPort.postMessage({ message: asset.message });
        if (asset.data._currencyDropBonus > 0) {
            addedCreeps.add(guid);
            locations[mapName].bosses.push(asset.data._creepName);
        } else {
            locations[mapName].creeps.push(asset.data._creepName);
        }
    }

    parentPort.postMessage({ message: `Added Location [${mapName}] to locations.` });
}

(async () => {
    await readDirectory(inputDir);

    const luaTable = jsonToLua(locations);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, `${workerData.parser}.lua`), luaTable);
    if (exportJSON) await fs.writeFile(path.join(outputDir, `${workerData.parser}.json`), JSON.stringify(locations, null, 4));
    parentPort.postMessage({ finished: true, message: "Finished parsing Locations." });
})();
