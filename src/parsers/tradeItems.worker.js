const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("worker_threads");
const itemRarities = require("../bin/itemRarities");
const jsonToLua = require("../bin/jsonToLua");

const inputDir = path.join(workerData.rawDataPath, "_item", "03_trade");
const outputDir = path.join(workerData.projectPath, "data", "parsed", workerData.parser);
const exportJSON = workerData.config.exportJSON ?? false;

const filesList = fs.readdirSync(inputDir);

let tradeItems = {};
async function processFiles() {
    for (const file of filesList) {
        const data = JSON.parse(fs.readFileSync(path.join(inputDir, file), "utf-8"))[0]?.MonoBehaviour;

        if (!data) {
            parentPort.postMessage({ message: `File ${path.basename(file)} doesn't contain any MonoBehaviour.` });
            continue;
        }

        const description = data._itemDescription.replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`);

        tradeItems[data._itemName] = {
            name: data._itemName,
            description: description,
            rarity: itemRarities[data._itemRarity],
            maxStack: data._maxStackAmount,
            price: data._vendorCost
        };

        parentPort.postMessage({ message: `Added Trade Item [${data._itemName}].` });
    }

    const luaTable = jsonToLua(tradeItems);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${workerData.parser}.lua`), luaTable);
    if (exportJSON) fs.writeFileSync(path.join(outputDir, `${workerData.parser}.json`), JSON.stringify(tradeItems, null, 4));
    parentPort.postMessage({ finished: true, message: "Finished parsing Trade Items." });
}

processFiles();