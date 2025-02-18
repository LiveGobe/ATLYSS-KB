const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("worker_threads");
const itemRarities = require("../bin/itemRarities");
const jsonToLua = require("../bin/jsonToLua");

const inputDir = path.join(workerData.rawDataPath, "_item", "02_consumable");
const outputDir = path.join(workerData.projectPath, "data", "parsed", workerData.parser);
const exportJSON = workerData.config.exportJSON ?? false;

let consumableItems = {};

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

function getType(itemName) {
    if (itemName.includes("CLASSTOME")) return "Class Tome";
    else if (itemName.includes("DYE")) return "Dye";
    else if (itemName.includes("SKILLSCROLL")) return "Skill Scroll";
    else if (itemName.includes("STATUSCONSUMABLE")) return "Status";
    
    return "";
}

function processFile(filePath) {
    const data = require(filePath)[0]?.MonoBehaviour;

    if (!data || !data._itemName) {
        parentPort.postMessage({ message: `File ${path.basename(filePath)} doesn't contain any MonoBehaviour.` });
        return;
    }

    const description = data._itemDescription.replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`);

    consumableItems[data._itemName] = {
        type: getType(data.m_Name),
        name: data._itemName,
        description: description,
        rarity: itemRarities[data._itemRarity],
        maxStack: data._maxStackAmount,
        price: data._vendorCost,
        cooldown: data._consumableCooldown,
        health: data._healthApply ?? 0,
        mana: data._manaApply ?? 0,
        stamina: data._staminaApply ?? 0,
        experience: data._expGain ?? 0
    };

    parentPort.postMessage({ message: `Added Consumable Item [${data._itemName}].` });
}

readDirectory(inputDir);

const luaTable = jsonToLua(consumableItems);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, `${workerData.parser}.lua`), luaTable);
if (exportJSON) fs.writeFileSync(path.join(outputDir, `${workerData.parser}.json`), JSON.stringify(consumableItems, null, 4));
parentPort.postMessage({ finished: true, message: "Finished parsing Consumable Items." });