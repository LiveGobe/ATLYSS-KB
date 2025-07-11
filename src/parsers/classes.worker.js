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
const noviceSkillsDir = path.join(skillDir, "01_novice");
const skillScrollDir = path.join(skillDir, "00_skillscroll_skills");

let classes = {};

async function getRankDescription(skill) {
    const playerStats = { attackPower: 1, magicPower: 1, dexPower: 1 };
    let skpValue = 0;
    const params = skill._skillRankParams;
    switch (skill._skillDamageType) {
        case 0:
            skpValue = Math.floor(
                params._baseSkillPower * 1 + playerStats.attackPower * 0.62
            );
            break;
        case 1:
            skpValue = Math.floor(
                params._baseSkillPower * 1 + playerStats.dexPower * 0.62
            );
            break;
        case 2:
            skpValue = Math.floor(
                params._baseSkillPower * 1 + playerStats.magicPower * 0.62
            );
            break;
    }
    let rankDescriptor = skill._skillDescription || "";

    return rankDescriptor.replace("$SKP", `<color=yellow>${skpValue}</color>`)
        .replace("$CASTTIME", params._baseCastTime > 0.12
            ? `<color=yellow>${params._baseCastTime.toFixed(2)} sec cast time.</color>`
            : "<color=yellow>instant cast time.</color>")
        .replace("$COOLDWN", `${params._baseCooldown} sec Cooldown`);
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
    if (!fs.existsSync(skillFolderPath)) {
        parentPort.postMessage({ message: `Skill folder ${skillFolderPath} does not exist. Skipping.` });
        return;
    }
    // Recursively collect all skill_*.json files
    function collectSkillFiles(dir) {
        let skillFiles = [];
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            const entryPath = path.join(dir, entry);
            if (fs.statSync(entryPath).isDirectory()) {
                skillFiles = skillFiles.concat(collectSkillFiles(entryPath));
            } else if (/^skill_.*\.json$/i.test(entry)) {
                skillFiles.push(entryPath);
            }
        }
        return skillFiles;
    }
    const skillFiles = collectSkillFiles(skillFolderPath);
    if (skillFiles.length === 0) {
        parentPort.postMessage({ message: `No skill files found in folder ${skillFolderPath}` });
        return;
    }
    for (const filePath of skillFiles) {
        const skillData = JSON.parse(fs.readFileSync(filePath, "utf-8"))[0]?.MonoBehaviour;
        if (!skillData) {
            parentPort.postMessage({ message: `File ${filePath} doesn't contain any MonoBehaviour` });
            continue;
        }
        if (!classes[className].skills) {
            classes[className].skills = [];
        }
        classes[className].skills.push({
            name: skillData._skillName,
            description: skillData._skillDescription.replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`),
            damageType: damageTypes[skillData._skillDamageType],
            type: determineSkillType(filePath),
            ranks: [
                {
                    rankTag: null,
                    description: (await getRankDescription(skillData)).replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`),
                    level: skillData._skillRankParams._levelRequirement,
                    castTime: skillData._skillRankParams._baseCastTime,
                    cooldown: skillData._skillRankParams._baseCooldown,
                    itemCost: skillData._skillRankParams._baseRequiredItem?.guid ? "x" + skillData._skillRankParams._basedItemCost + " " + (await findAssetById(skillData._skillRankParams._baseRequiredItem.guid, workerData.projectPath)).data._itemName : "",
                    manaCost: skillData._skillRankParams._manaCost,
                    healthCost: skillData._skillRankParams._healthCost,
                    staminaCost: skillData._skillRankParams._staminaCost
                }
            ]
        });
        parentPort.postMessage({ message: `Added Skill [${skillData._skillName}] to Class [${className}].` });
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
        const seenSkillGuids = new Set();

        // Helper to add a skill if not already added
        async function addSkill(skillRef, tierName = null) {
            if (!skillRef?.guid || seenSkillGuids.has(skillRef.guid)) return;
            seenSkillGuids.add(skillRef.guid);
            const skillAsset = await findAssetById(skillRef.guid, workerData.projectPath);
            const skillData = skillAsset.data;
            parentPort.postMessage({ message: skillAsset.message });
            if (!skillData) return;
            const skillFilePath = locateSkillFile(skillRef.guid, skillDir);
            if (!skillFilePath) {
                parentPort.postMessage({ message: `Skill file for GUID ${skillRef.guid} not found.` });
                return;
            }
            if (!skillData._skillRankParams) {
                parentPort.postMessage({ message: `Skill [${skillData._skillName}] is missing _skillRankParams. Skipping.` });
                return;
            }
            const params = skillData._skillRankParams;
            const skillObj = {
                name: skillData._skillName,
                description: skillData._skillDescription.replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`),
                damageType: damageTypes[skillData._skillDamageType],
                type: determineSkillType(skillFilePath),
                ranks: [
                    {
                        rankTag: null,
                        description: (await getRankDescription(skillData)).replaceAll("\n", "\\n").replaceAll("</color>", "</span>").replace(/\<color=(\w*)\>/g, `<span style=\\"color: $1;\\">`),
                        level: params._levelRequirement,
                        castTime: params._baseCastTime,
                        cooldown: params._baseCooldown,
                        itemCost: params._baseRequiredItem?.guid ? "x" + params._basedItemCost + " " + (await findAssetById(params._baseRequiredItem.guid, workerData.projectPath)).data._itemName : "",
                        manaCost: params._manaCost,
                        healthCost: params._healthCost,
                        staminaCost: params._staminaCost
                    }
                ]
            };
            if (tierName) skillObj.tier = tierName;
            classes[className].skills.push(skillObj);
            parentPort.postMessage({ message: `Added Skill [${skillData._skillName}] to Class [${className}]${tierName ? ` (Tier: ${tierName})` : ''}.` });
        }

        // Add base class skills
        if (Array.isArray(data._classSkills)) {
            for (const skill of data._classSkills) {
                await addSkill(skill);
            }
        }
        // Add tier skills
        if (Array.isArray(data._playerClassTiers)) {
            for (const tier of data._playerClassTiers) {
                if (Array.isArray(tier._classTierSkills)) {
                    for (const skill of tier._classTierSkills) {
                        await addSkill(skill, tier._classTierName);
                    }
                }
            }
        }
        parentPort.postMessage({ message: `Added Class [${className}] with skills.` });
    }

    classes["Novice"] = { name: "Novice", skills: [] };
    await processSkillFolder(noviceSkillsDir, "Novice");
    await processSkillFolder(skillScrollDir, "Novice");
}

processClassSkills().then(() => {
    const luaTable = jsonToLua(classes);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${workerData.parser}.lua`), luaTable);
    if (exportJSON) fs.writeFileSync(path.join(outputDir, `${workerData.parser}.json`), JSON.stringify(classes, null, 4));
    parentPort.postMessage({ finished: true, message: "Finished parsing Classes." });
});