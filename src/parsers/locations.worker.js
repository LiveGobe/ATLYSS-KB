const fsPromise = require("node:fs").promises;
const fs = require("node:fs");
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
    const fList = await fsPromise.readdir(inputFolder);

    for (const file of fList) {
        const filePath = path.join(inputFolder, file);
        const stat = await fsPromise.stat(filePath);

        if (stat.isDirectory()) {
            await readDirectory(filePath);
        } else {
            await processFile(filePath);
        }
    }
}

async function findSceneFileByMapName(mapName) {
    const fList = await fsPromise.readdir(inputDir);
    for (const file of fList) {
        const filePath = path.join(inputDir, file);
        if (file.endsWith(".json")) {
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            const mapData = data.find(v => v.MonoBehaviour?._mapName === mapName);
            if (mapData) return filePath;
        }
    }
    return null;
}

async function processFile(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath), "utf-8");
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

    const scenePortalsData = data.filter(v => v.MonoBehaviour?._scenePortal);

    if (getType(mapData[0]?.MonoBehaviour._zoneType) == "Dungeon" && scenePortalsData[0]?.MonoBehaviour?._scenePortal?._portalCaptionTitle) {
        const linkedMapName = scenePortalsData[0].MonoBehaviour._scenePortal._portalCaptionTitle;
        const linkedFilePath = await findSceneFileByMapName(linkedMapName);

        if (linkedFilePath) {
            const linkedData = JSON.parse(fs.readFileSync(linkedFilePath, "utf-8"));
            const linkedPortal = linkedData.find(v => v.MonoBehaviour?._scenePortal && v.MonoBehaviour._scenePortal._portalCaptionTitle === mapName);

            if (linkedPortal) {
                for (let difficulty of Object.entries(locations[mapName].difficulties)) {
                    difficulty = difficulty[0];
                    locations[mapName].difficulties[difficulty].levels = {};

                    // Extracting min and max levels based on the difficulty
                    if (difficulty === "EASY") {
                        locations[mapName].difficulties[difficulty].levels.min = linkedPortal.MonoBehaviour._scenePortal._easyLevelRequirement;
                        locations[mapName].difficulties[difficulty].levels.max = linkedPortal.MonoBehaviour._scenePortal._maxEasyLevel;
                    } else if (difficulty === "NORMAL") {
                        locations[mapName].difficulties[difficulty].levels.min = linkedPortal.MonoBehaviour._scenePortal._normalLevelRequirement;
                        locations[mapName].difficulties[difficulty].levels.max = linkedPortal.MonoBehaviour._scenePortal._maxNormalLevel;
                    } else if (difficulty === "HARD") {
                        locations[mapName].difficulties[difficulty].levels.min = linkedPortal.MonoBehaviour._scenePortal._hardLevelRequirement;
                        locations[mapName].difficulties[difficulty].levels.max = linkedPortal.MonoBehaviour._scenePortal._maxHardLevel;
                    }
                }
            }
        }
    }

    parentPort.postMessage({ message: `Added Location [${mapName}] to locations.` });
}

(async () => {
    await readDirectory(inputDir);

    const luaTable = jsonToLua(locations);

    await fsPromise.mkdir(outputDir, { recursive: true });
    await fsPromise.writeFile(path.join(outputDir, `${workerData.parser}.lua`), luaTable);
    if (exportJSON) await fsPromise.writeFile(path.join(outputDir, `${workerData.parser}.json`), JSON.stringify(locations, null, 4));
    parentPort.postMessage({ finished: true, message: "Finished parsing Locations." });
})();