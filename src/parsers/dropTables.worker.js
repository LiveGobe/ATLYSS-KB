const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("worker_threads");
const findAssetById = require("../bin/findAssetById");
const jsonToLua = require("../bin/jsonToLua");

const inputDirs = [
    path.join(workerData.rawDataPath, "_item", "00_chest_loot_table"),
    path.join(workerData.rawDataPath, "_prefab", "_entity", "_npc"),
    path.join(workerData.rawDataPath, "_prefab", "_entity", "_creep", "_creepdirectory")
];
const outputDir = path.join(workerData.projectPath, "data", "parsed", workerData.parser);
const exportJSON = workerData.config.exportJSON ?? false;

let luaTable = {
    Chest: {},
    Breakable: {},
    Creep: {},
    Gambling: {}
};

async function readDirectory(inputFolder) {
    const fList = fs.readdirSync(inputFolder);

    for (const file of fList) {
        const filePath = path.join(inputFolder, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            // If the item is a directory, recursively read it
            await readDirectory(filePath);
        } else {
            // Process the file if it's not a directory
            await processFile(filePath);
        }
    }
}

function getType(fileName) {
    if (fileName.includes("Chest")) return "Chest";
    else if (fileName.includes("Breakbox")) return "Breakable";
    else if (fileName.includes("CREEP")) return "Creep";
    else if (fileName.includes("Cost_tier")) return "Gambling";

    return "";
}

async function processFile(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))[0]?.MonoBehaviour;

    if (!data || !data._itemDrops || !Array.isArray(data._itemDrops) || data._itemDrops.length === 0) {
        parentPort.postMessage({ message: `File ${path.basename(filePath)} doesn't contain valid _itemDrops.` });
        return;
    }

    const type = getType(data.m_Name);
    if (!luaTable[type] && !filePath.includes("_npc")) return;

    const entryName = data._creepName ?? data.m_Name.replace("lootTable_", "")
        .split("Chest")
        .map(v => v.charAt(0).toUpperCase() + v.slice(1))
        .join(" Chest")
        .replace(/\(|\)/g, "")
        .replace("ChestBoss", "Boss Chest")
        .replace("Breakbox", " Pot")
        .replace("Catcombs", "Catacombs")
        .replace("Catacombs", "Sanctum Catacombs")
        .replace("Crescentkeep", "Crescent Keep")
        .replace("Grove", "Crescent Grove")
        .replace("Chest ", "")
        .replace(" Chest", "")
        .replace(/_(\d+).*tier(\d+)/, (match, p1, p2) => {
            const num1 = parseInt(p1, 10); // Convert the first match to an integer
            const num2 = parseInt(p2, 10); // Convert the second match to an integer
            return ` Cost ${num1} Tier ${num2}`;
        });

    if (!luaTable[type][entryName]) {
        luaTable[type][entryName] = [];
    }

    for (const drop of data._itemDrops) {
        const dropData = await findAssetById(drop._item.guid, workerData.projectPath);
        parentPort.postMessage({ message: dropData?.message || "Failed to find asset." });

        if (!dropData?.data) continue;

        luaTable[type][entryName].push(dropData.data._itemName);
        parentPort.postMessage({ message: `Added ${type} drop for ${entryName}: ${dropData.data._itemName}` });
    }
}

// Read directories and process files
async function processDirectories() {
    for (const dir of inputDirs) {
        await readDirectory(dir);
    }

    // Convert luaTable to a Lua string
    const luaTableString = jsonToLua(luaTable);

    // Write to output file
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${workerData.parser}.lua`), luaTableString);
    if (exportJSON) fs.writeFileSync(path.join(outputDir, `${workerData.parser}.json`), JSON.stringify(luaTable, null, 4));
    parentPort.postMessage({ finished: true, message: "Finished parsing Drop Tables." });
}

processDirectories();
