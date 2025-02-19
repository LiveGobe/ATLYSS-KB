const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("worker_threads");
const findAssetById = require("../bin/findAssetById");
const jsonToLua = require("../bin/jsonToLua");

const inputDir = path.join(workerData.rawDataPath, "_prefab", "_entity", "_creep", "_creepdirectory");
const outputDir = path.join(workerData.projectPath, "data", "parsed", workerData.parser);
const exportJSON = workerData.config.exportJSON ?? false;

let creeps = {};

function readDirectory(inputFolder) {
    const fList = fs.readdirSync(inputFolder);

    fList.forEach(file => {
        const filePath = path.join(inputFolder, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            // If the item is a directory, recursively read it
            readDirectory(filePath);
        } else {
            // Process the file if it's not a directory
            processFile(filePath);
        }
    });
}

function processFile(filePath) {
    const data = require(filePath)[0]?.MonoBehaviour;

    if (!data || !data._creepName) {
        parentPort.postMessage({ message: `File ${path.basename(filePath)} doesn't contain any MonoBehaviour.` });
        return;
    }

    let element = "Normal";
    if (data._combatElement?.guid) {
        const asset = findAssetById(data._combatElement.guid, workerData.projectPath);
        parentPort.postMessage({ message: asset.message });
        element = asset.data?._elementName;
    }

    let type = "Normal";
    if (data._currencyDropBonus > 0 && !data._itemDrops.length) {
        type = "Boss";
    }

    creeps[data._creepName] = {
        name: data._creepName,
        level: data._creepLevel,
        type: type,
        element: element,
        damage: data._baseDamage,
        stats: {
            maxHealth: data._creepStatStruct._maxHealth,
            maxMana: data._creepStatStruct._maxMana,
            maxStamina: data._creepStatStruct._maxStamina,
            experience: data._creepStatStruct._experience,
            attackPower: data._creepStatStruct._attackPower,
            dexPower: data._creepStatStruct._dexPower,
            magicPower: data._creepStatStruct._magicPower,
            criticalRate: data._creepStatStruct._criticalRate,
            magicCriticalRate: data._creepStatStruct._magicCriticalRate,
            defense: data._creepStatStruct._defense,
            magicDefense: data._creepStatStruct._magicDefense,
            evasion: data._creepStatStruct._evasion
        }
    };

    parentPort.postMessage({ message: `Added Creep [${data._creepName}].` });
}

readDirectory(inputDir);

const luaTable = jsonToLua(creeps);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, `${workerData.parser}.lua`), luaTable);
if (exportJSON) fs.writeFileSync(path.join(outputDir, `${workerData.parser}.json`), JSON.stringify(creeps, null, 4));
parentPort.postMessage({ finished: true, message: "Finished parsing Creeps." });
