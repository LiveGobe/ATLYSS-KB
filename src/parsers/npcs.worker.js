const fsPromise = require("node:fs").promises;
const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("worker_threads");
const findAssetById = require("../bin/findAssetById");
const calculateEXP = require("../bin/calculateEXP");
const jsonToLua = require("../bin/jsonToLua");

const inputDir = path.join(workerData.rawDataPath, "_prefab", "_entity", "_npc");
const outputDir = path.join(workerData.projectPath, "data", "parsed", workerData.parser);
const exportJSON = workerData.config.exportJSON ?? false;

let npcs = {};

async function readDirectory(inputFolder) {
    const fList = await fsPromise.readdir(inputFolder);

    for (const file of fList) {
        const filePath = path.join(inputFolder, file);
        const stat = await fsPromise.stat(filePath);

        if (stat.isDirectory()) {
            // If the item is a directory, recursively read it
            await readDirectory(filePath);
        } else {
            // Process the file if it's not a directory
            await processFile(filePath);
        }
    }
}

async function processFile(filePath) {
    if (!filePath.split("\\").at(-1).startsWith("_npc")) {
        parentPort.postMessage({ message: `File ${path.basename(filePath)} isn't an NPC file` });
        return;
    }
    // Read the prefab JSON as an array of objects
    const prefabArray = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    // Find the MonoBehaviour object with m_text
    const npcData = prefabArray.find(obj => obj.MonoBehaviour && obj.MonoBehaviour.m_text)?.MonoBehaviour;

    if (!npcData || !npcData.m_text) {
        parentPort.postMessage({ message: `File ${path.basename(filePath)} doesn't contain any MonoBehaviour` });
        return;
    }

    const npcFolder = path.dirname(filePath);
    const shopKeepFile = (await fsPromise.readdir(npcFolder)).find(file => file.startsWith("shopKeep"));
    let shopData;
    if (shopKeepFile) {
        // ShopKeep files may also be arrays of objects now
        const shopArray = JSON.parse(fs.readFileSync(path.join(npcFolder, shopKeepFile), "utf-8"));
        shopData = shopArray.find(obj => obj.MonoBehaviour)?.MonoBehaviour;
    }

    let questsData = [];
    try {
        // Collect quest files from both _quest subdirectory and npcFolder
        let questFiles = [];
        const questDir = path.join(npcFolder, "_quest");
        if (fs.existsSync(questDir)) {
            const subQuestFiles = await fsPromise.readdir(questDir);
            questFiles.push(...subQuestFiles.map(f => ({ file: f, dir: questDir })));
        }
        const npcFolderFiles = await fsPromise.readdir(npcFolder);
        for (const file of npcFolderFiles) {
            if (file.includes("QUEST") && fs.lstatSync(path.join(npcFolder, file)).isFile()) {
                questFiles.push({ file, dir: npcFolder });
            }
        }
        for (const { file, dir } of questFiles) {
            try {
                const questArray = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
                const questMono = Array.isArray(questArray)
                    ? questArray.find(obj => obj.MonoBehaviour)?.MonoBehaviour
                    : (questArray.MonoBehaviour ? questArray.MonoBehaviour : null);
                if (questMono) questsData.push(questMono);
            } catch (e) {
                parentPort.postMessage({ message: `Failed to parse quest file: ${file}` });
            }
        }
        if (questsData.length === 0) {
            parentPort.postMessage({ message: `No quest files were found for ${npcData.m_text.replaceAll("\n", "\\n").replaceAll("</color>", "").replace(/\<color=(\w*)\>/g, "")}` });
        }
    } catch (e) {
        parentPort.postMessage({ message: `Error while searching for quest files for ${npcData.m_text.replaceAll("\n", "\\n").replaceAll("</color>", "").replace(/\<color=(\w*)\>/g, "")}` });
    }

    const npcName = npcData.m_text.replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`);

    npcs[npcData.m_text.replaceAll("\n", "\\n").replaceAll("</color>", "").replace(/\<color=(\w*)\>/g, "")]
      = {
        name: npcName,
        shop: shopData ? {
            name: shopData._shopName,
            ...Object.fromEntries(await Promise.all(shopData._shopkeepItemTables.map(async (table, tier) => {
                const items = await Promise.all(table._shopkeepItems.map(async item => {
                    const itemData = await findAssetById(item._scriptItem.guid, workerData.projectPath);
                    if (itemData) {
                        parentPort.postMessage({ message: itemData.message });
                        let price, priceItem;
                        // Check for _specialStoreCost override
                        if (item._specialStoreCost && item._specialStoreCost._scriptItem && item._specialStoreCost._scriptItem.guid) {
                            // Find the item used as special store cost
                            const costItemData = await findAssetById(item._specialStoreCost._scriptItem.guid, workerData.projectPath);
                            price = item._specialStoreCost._scriptItemQuantity;
                            priceItem = costItemData.data._itemName;
                        } else {
                            price = item._useDedicatedItemValue ? item._dedicatedItemValue : itemData.data._vendorCost;
                            priceItem = null;
                        }
                        return itemData.data ? {
                            name: itemData.data._itemName,
                            price: price,
                            priceItem: priceItem
                        } : null;
                    }
                    return null;
                }));
                return [`Tier ${tier + 1}`, {
                    level: table._levelRequirement,
                    items: items.filter(Boolean)
                }];
            })))
        } : {},
        quests: await Promise.all(questsData.map(async quest => {
            const itemRewards = await Promise.all(quest._questItemRewards.map(async itemReward => {
                const itemData = await findAssetById(itemReward._scriptItem.guid, workerData.projectPath);
                if (itemData) {
                    parentPort.postMessage({ message: itemData.message });
                    return itemData.data ? {
                        name: itemData.data._itemName,
                        quantity: itemReward?._itemQuantity
                    } : null;
                }
                return null;
            }));
            const prerequisites = await Promise.all((quest._preQuestRequirements || []).map(async preReq => {
                const preReqData = await findAssetById(preReq.guid, workerData.projectPath);
                if (preReqData) {
                    parentPort.postMessage({ message: preReqData.message });
                    return preReqData.data ? { name: preReqData.data._questName } : null;
                }
                return null;
            }));
            const itemRequirements = await Promise.all((quest._questObjective?._questItemRequirements || []).map(async req => {
                const itemData = await findAssetById(req._questItem.guid, workerData.projectPath);
                if (itemData) {
                    parentPort.postMessage({ message: itemData.message });
                    return itemData.data ? {
                        item: itemData.data._itemName,
                        quantity: req._itemsNeeded
                    } : null;
                }
                return null;
            }));
            const creepRequirements = await Promise.all((quest._questObjective?._questCreepRequirements || []).map(async req => {
                const creepData = await findAssetById(req._questCreep.guid, workerData.projectPath);
                if (creepData) {
                    parentPort.postMessage({ message: creepData.message });
                    return creepData.data ? {
                        creep: creepData.data._creepName,
                        quantity: req._creepsKilled
                    } : null;
                }
                return null;
            }));
            return {
                name: quest._questName,
                description: quest._questDescription.replaceAll("\n", "\\n").replaceAll("\"", "\\\"").replaceAll("</color>", "").replace(/\<color=(\w*)\>/g, ""),
                level: quest._questLevel,
                expReward: Math.floor(Math.floor(calculateEXP(quest._questLevel)) * quest._questExperiencePercentage),
                currencyReward: quest._questCurrencyReward,
                itemRewards: itemRewards.filter(Boolean),
                type: quest._questType === 1 ? "Repeatable" : "Single",
                prerequisites: prerequisites.filter(Boolean),
                objectives: {
                    itemRequirements: itemRequirements.filter(Boolean),
                    creepRequirements: creepRequirements.filter(Boolean),
                    triggerRequirements: (quest._questObjective?._questTriggerRequirements || []).map(trigger => ({
                        tag: trigger._questTriggerTag,
                        prefix: trigger._prefix,
                        suffix: trigger._suffix,
                        emitsNeeded: trigger._triggerEmitsNeeded
                    }))
                }
            };
        }))
    };

    parentPort.postMessage({ message: `Added NPC [${npcData.m_text.replaceAll("\n", "\\n").replaceAll("</color>", "").replace(/\<color=(\w*)\>/g, "")}]` });
}

(async () => {
    await readDirectory(inputDir);

    const luaTable = jsonToLua(npcs);

    await fsPromise.mkdir(outputDir, { recursive: true });
    await fsPromise.writeFile(path.join(outputDir, `${workerData.parser}.lua`), luaTable);
    if (exportJSON) await fsPromise.writeFile(path.join(outputDir, `${workerData.parser}.json`), JSON.stringify(npcs, null, 4));
    parentPort.postMessage({ finished: true, message: "Finished parsing NPCs." });
})();
