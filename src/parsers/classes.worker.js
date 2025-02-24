const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("worker_threads");
const damageTypes = require("../bin/damageTypes");
const jsonToLua = require("../bin/jsonToLua");
const findAssetById = require("../bin/findAssetById");

const inputDir = path.join(workerData.rawDataPath, "_class");
const outputDir = path.join(workerData.projectPath, "data", "parsed", workerData.parser);
const exportJSON = workerData.config.exportJSON ?? false;

const skillDir = path.join(workerData.rawDataPath, "_skill");
const noviceSkillsDir = path.join(skillDir, "_noviceskills");
const skillScrollDir = path.join(skillDir, "00_skillscroll_skills");
const excludedSkills = ["Geyser", "Flak", "Talus"];

let classes = {};

async function getRankDescription(skill, rank) {
    const playerStats = { attackPower: 1, magicPower: 1, dexPower: 1 };

    let skpValue = 0;
    switch (skill._skillDamageType) {
        case 0:
            skpValue = Math.floor(
                skill._baseSkillPower * skill._skillRanks[rank]._skillPowerPercent +
                playerStats.attackPower * 0.62
            );
            break;
        case 1:
            skpValue = Math.floor(
                skill._baseSkillPower * skill._skillRanks[rank]._skillPowerPercent +
                playerStats.dexPower * 0.62
            );
            break;
        case 2:
            skpValue = Math.floor(
                skill._baseSkillPower * skill._skillRanks[rank]._skillPowerPercent +
                playerStats.magicPower * 0.62
            );
            break;
    }

    let rankDescriptor = skill._skillRanks[rank]?._rankDescriptor || "";

    if (rankDescriptor.includes("$SKP")) {
        if (skill._skillRanks[rank]._skillObjectOutput._skillObjectCondition._scriptableCondition.guid) {
            const conditionAsset = await findAssetById(skill._skillRanks[rank]._skillObjectOutput._skillObjectCondition._scriptableCondition.guid, workerData.projectPath);
            const conditionData = conditionAsset.data;
            parentPort.postMessage({ message: conditionAsset.message });
            const basePowerValue = conditionData?._basePowerValue || 0;
            const attackPowerMod = Math.max(1, Math.floor((playerStats.attackPower + basePowerValue) * conditionData._attackPowerMod) - 1);
            const magicPowerMod = Math.max(1, Math.floor((playerStats.magicPower + basePowerValue) * conditionData._magicPowerMod) - 1);
            const rangePowerMod = Math.max(1, Math.floor((playerStats.dexPower + basePowerValue) * conditionData._rangePowerMod) - 1);

            rankDescriptor = rankDescriptor
                .replace("$SKP", `<color=yellow>${skpValue}</color>`)
                .replace("$ATP", `<color=yellow>${attackPowerMod}</color>`)
                .replace("$MKP", `<color=yellow>${magicPowerMod}</color>`)
                .replace("$RAP", `<color=yellow>${rangePowerMod}</color>`);
        }
    }

    if (skill._skillRanks[rank]._selfConditionOutput.guid) {
        const selfConditionAsset = await findAssetById(skill._skillRanks[rank]._selfConditionOutput.guid, workerData.projectPath);
        const selfConditionData = selfConditionAsset.data;
        parentPort.postMessage({ message: selfConditionAsset.message });
        if (selfConditionData) {
            rankDescriptor += selfConditionData._conditionDescription;

            if (selfConditionData._cancelOnHit) {
                rankDescriptor += " <color=yellow>Cancels if hit.</color>";
            }
            if (selfConditionData._isPermanent) {
                rankDescriptor += " <color=yellow>Permanent.</color>";
            } else if (selfConditionData._duration > 0) {
                rankDescriptor += ` <color=yellow>Lasts for ${selfConditionData._duration} seconds.</color>`;
            }
            if (selfConditionData._isStackable) {
                rankDescriptor += " <color=yellow>Stackable.</color>";
            }
            if (selfConditionData._isRefreshable) {
                rankDescriptor += " <color=yellow>Refreshes when re-applied.</color>";
            }
        }
    }

    return rankDescriptor.replace("$SKP", `<color=yellow>${skpValue}</color>`)
                          .replace("$CASTTIME", skill._skillRanks[rank]._castTime > 0.12
                              ? `<color=yellow>${skill._skillRanks[rank]._castTime.toFixed(2)} sec cast time.</color>`
                              : "<color=yellow>instant cast time.</color>")
                          .replace("$COOLDWN", `${skill._skillRanks[rank]._coolDown} sec Cooldown`);
}

function determineSkillType(skillPath) {
    const folderName = path.dirname(skillPath).toLowerCase();
    if (folderName.includes("passive") || folderName.includes("masteries")) {
        return "Passive";
    }
    return "Active";
}

function locateSkillFile(guid, skillDir) {
    function searchDirectory(directory) {
        const entries = fs.readdirSync(directory);

        for (const entry of entries) {
            const entryPath = path.join(directory, entry);

            if (fs.statSync(entryPath).isDirectory()) {
                const result = searchDirectory(entryPath);
                if (result) {
                    return result;
                }
            } else if (fs.statSync(entryPath).isFile() && entry.endsWith(".json")) {
                const fileContent = fs.readFileSync(entryPath, "utf-8");
                try {
                    const jsonData = JSON.parse(fileContent);

                    if (jsonData && jsonData[0].guid === guid) {
                        return entryPath;
                    }
                } catch (err) {
                    console.error(`Error parsing JSON in file ${entryPath}:`, err);
                }
            }
        }

        return null;
    }

    return searchDirectory(skillDir);
}

async function processSkillFolder(skillFolderPath, className) {
    const folders = fs.readdirSync(skillFolderPath);

    for (const folder of folders) {
        const filesInFolder = fs.readdirSync(path.join(skillFolderPath, folder));

        const skillFiles = filesInFolder.filter(file => /^skill_.*\.json$/.test(file));

        if (skillFiles.length === 0) {
            parentPort.postMessage({ message: `No skill files found in folder ${folder}` });
            continue;
        }

        for (const file of skillFiles) {
            if (file.endsWith("_0.json")) continue;

            const skillData = JSON.parse(fs.readFileSync(path.join(skillFolderPath, folder, file), "utf-8"))[0]?.MonoBehaviour;

            if (!skillData || excludedSkills.includes(skillData._skillName)) {
                parentPort.postMessage({ message: `File ${file} doesn't contain any MonoBehaviour` });
                continue;
            }

            if (!classes[className].skills) {
                classes[className].skills = [];
            }

            classes[className].skills.push({
                name: skillData._skillName,
                description: skillData._skillDescription.replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`),
                damageType: damageTypes[skillData._skillDamageType],
                type: determineSkillType(path.join(skillFolderPath, folder, file)),
                ranks: await Promise.all(skillData._skillRanks.map(async (rank, rankNum) => ({
                    rankTag: rank._rankTag,
                    description: (await getRankDescription(skillData, rankNum)).replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`),
                    level: rank._levelRequirement,
                    castTime: rank._castTime,
                    cooldown: rank._coolDown,
                    itemCost: rank._requiredItem?.guid ? "x" + rank._requiredItemQuantity + " " + (await findAssetById(rank._requiredItem.guid, workerData.projectPath)).data._itemName : "",
                    manaCost: rank._manaCost,
                    healthCost: rank._healthCost,
                    staminaCost: rank._staminaCost
                })))
            });

            parentPort.postMessage({ message: `Added Skill [${skillData._skillName}] to Class [${className}].` });
        }
    }
}

async function processClassSkills() {
    const filesList = fs.readdirSync(inputDir);

    for (const file of filesList) {
        const data = JSON.parse(fs.readFileSync(path.join(inputDir, file), "utf-8"))[0]?.MonoBehaviour;

        if (!data) {
            parentPort.postMessage({ message: `File ${file} doesn't contain any MonoBehaviour` });
            continue;
        }

        const className = data._className;
        classes[className] = { name: className, skills: [] };

        for (const skill of data._classSkills) {
            const skillAsset = await findAssetById(skill.guid, workerData.projectPath);
            const skillData = skillAsset.data;
            parentPort.postMessage({ message: skillAsset.message });

            if (skillData) {
                const skillFilePath = locateSkillFile(skill.guid, skillDir);

                if (!skillFilePath) {
                    parentPort.postMessage({ message: `Skill file for GUID ${skill.guid} not found.` });
                    continue;
                }

                classes[className].skills.push({
                    name: skillData._skillName,
                    description: skillData._skillDescription.replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`),
                    damageType: damageTypes[skillData._skillDamageType],
                    type: determineSkillType(skillFilePath),
                    ranks: await Promise.all(skillData._skillRanks.map(async (rank, rankNum) => ({
                        rankTag: rank._rankTag,
                        description: (await getRankDescription(skillData, rankNum)).replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`),
                        level: rank._levelRequirement,
                        castTime: rank._castTime,
                        cooldown: rank._coolDown,
                        itemCost: rank._requiredItem?.guid ? "x" + rank._requiredItemQuantity + " " + (await findAssetById(rank._requiredItem.guid, workerData.projectPath)).data._itemName : "",
                        manaCost: rank._manaCost,
                        healthCost: rank._healthCost,
                        staminaCost: rank._staminaCost
                    })))
                });

                parentPort.postMessage({ message: `Added Skill [${skillData._skillName}] to Class [${className}].` });
            }
        }

        parentPort.postMessage({ message: `Added Class [${className}] with skills.` });
    }

    classes["Novice"] = { name: "Novice", skills: [] };
    await processSkillFolder(noviceSkillsDir, "Novice");
    await processSkillFolder(skillScrollDir, "Novice");
    await processSkillFolder(path.join(skillScrollDir, "00_masteries"), "Novice");
}

processClassSkills().then(() => {
    const luaTable = jsonToLua(classes);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${workerData.parser}.lua`), luaTable);
    if (exportJSON) fs.writeFileSync(path.join(outputDir, `${workerData.parser}.json`), JSON.stringify(classes, null, 4));
    parentPort.postMessage({ finished: true, message: "Finished parsing Classes." });
});