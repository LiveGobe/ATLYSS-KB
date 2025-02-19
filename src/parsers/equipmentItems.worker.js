const fs = require("node:fs").promises;
const path = require("node:path");
const { parentPort, workerData } = require("worker_threads");
const itemRarities = require("../bin/itemRarities");
const jsonToLua = require("../bin/jsonToLua");
const findAssetById = require("../bin/findAssetById");

const inputDir = path.join(workerData.rawDataPath, "_item", "01_equipment");
const outputDir = path.join(workerData.projectPath, "data", "parsed", workerData.parser);
const exportJSON = workerData.config.exportJSON ?? false;

let equipmentItems = {};

async function readDirectory(inputFolder) {
    const fList = await fs.readdir(inputFolder);

    for (const file of fList) {
        const filePath = path.join(inputFolder, file);
        const stat = await fs.stat(filePath);

        if (stat.isDirectory()) {
            // If the item is a directory, recursively read it
            await readDirectory(filePath);
        } else {
            // Process the file if it's not a directory
            await processFile(filePath);
        }
    }
}

function getType(itemName) {
    if (itemName.includes("HELM")) return "Helm";
    else if (itemName.includes("CAPE")) return "Cape";
    else if (itemName.includes("CHESTPIECE")) return "Chestpiece";
    else if (itemName.includes("LEGGINGS")) return "Leggings";
    else if (itemName.includes("SHIELD")) return "Shield";
    else if (itemName.includes("RING")) return "Ring";
    else if (itemName.includes("Katars")) return "Katars";
    else if (itemName.includes("Ranged")) return "Ranged";
    else if (itemName.includes("Range Weapon")) return "Ranged";
    else if (itemName.includes("Heavy Melee")) return "Heavy Melee";
    else if (itemName.includes("Melee")) return "Melee";
    else if (itemName.includes("Polearm")) return "Polearm";
    else if (itemName.includes("Magic Scepter")) return "Scepter";
    else if (itemName.includes("Magic Bell")) return "Bell";

    return "";
}

async function processFile(filePath) {
    const data = require(filePath)[0]?.MonoBehaviour;

    if (!data || !data._itemName) {
        parentPort.postMessage({ message: `File ${path.basename(filePath)} doesn't contain any MonoBehaviour.` });
        return;
    }

    const description = data._itemDescription ? data._itemDescription.replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`) : "";

    let enchantmentItem = "";
    if (data._statModifierCost._scriptItem.guid) {
        const asset = await findAssetById(data._statModifierCost._scriptItem.guid, workerData.projectPath);
        parentPort.postMessage({ message: asset.message });
        enchantmentItem = asset.data?._itemName ?? "";
    }

    let classRequirement = "Any";
    if (data._classRequirement?.guid) {
        const asset = await findAssetById(data._classRequirement.guid, workerData.projectPath);
        parentPort.postMessage({ message: asset.message });
        classRequirement = asset.data?._className;
    }

    equipmentItems[data._itemName] = {
        type: getType(data.m_Name),
        name: data._itemName,
        description: description,
        level: data._equipmentLevel,
        class: classRequirement,
        stats: {
            maxHealth: data._statArray._maxHealth,
            maxMana: data._statArray._maxMana,
            maxStamina: data._statArray._maxStamina,
            experience: data._statArray._experience,
            attackPower: data._statArray._attackPower,
            dexPower: data._statArray._dexPower,
            magicPower: data._statArray._magicPower,
            criticalRate: data._statArray._criticalRate,
            magicCriticalRate: data._statArray._magicCriticalRate,
            defense: data._statArray._defense,
            magicDefense: data._statArray._magicDefense,
            evasion: data._statArray._evasion
        },
        enchantment: {
            item: enchantmentItem,
            amount: data._statModifierCost?._scriptItemQuantity ?? 0
        }
    };

    if (data._weaponDamage) {
        let element = "Normal";
        if (data._combatElement?.guid) {
            const asset = await findAssetById(data._combatElement.guid, workerData.projectPath);
            parentPort.postMessage({ message: asset.message });
            element = asset.data?._elementName;
        }

        equipmentItems[data._itemName].weapon = {
            element: element,
            minBase: Math.trunc(data._readonlyDamageRange.x),
            maxBase: Math.trunc(data._readonlyDamageRange.true)
        };
    } else if (data._blockDamageThreshold) {
        equipmentItems[data._itemName].blockDamage = data._blockDamageThreshold;
    }

    equipmentItems[data._itemName].rarity = itemRarities[data._itemRarity];
    equipmentItems[data._itemName].dye = data._canDyeArmor == 1;
    equipmentItems[data._itemName].maxStack = data._maxStackAmount;
    equipmentItems[data._itemName].price = data._vendorCost;

    parentPort.postMessage({ message: `Added Equipment Item [${data._itemName}].` });
}

(async () => {
    await readDirectory(inputDir);

    const luaTable = jsonToLua(equipmentItems);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, `${workerData.parser}.lua`), luaTable);
    if (exportJSON) await fs.writeFile(path.join(outputDir, `${workerData.parser}.json`), JSON.stringify(equipmentItems, null, 4));
    parentPort.postMessage({ finished: true, message: "Finished parsing Equipment Items." });
})();