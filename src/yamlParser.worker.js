const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const yaml = require("js-yaml");
const readline = require("readline");
const { parentPort, workerData } = require('worker_threads');

function parseScene(filePath, folderPath, projectPath, callback) {
  fs.readFile(filePath + ".meta", "utf-8", (err, metaData) => {
    if (err) return callback(err);

    async function extractMonoBehaviours() {
      const inputStream = fs.createReadStream(filePath, { encoding: "utf-8" });
      const rl = readline.createInterface({
        input: inputStream,
        crlfDelay: Infinity,
      });

      let documentBuffer = '';
      const monoBehaviours = [];

      for await (const line of rl) {
        if (line.trim().startsWith('---')) {
          if (documentBuffer.trim().length > 0) {
            const doc = yaml.load(documentBuffer.replace("%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n", ""));
            if (doc && doc.MonoBehaviour) {
              monoBehaviours.push(doc);
            }
          }
          documentBuffer = '';
        } else {
          documentBuffer += `${line}\n`;
        }
      }

      if (documentBuffer.trim().length > 0) {
        const doc = yaml.load(documentBuffer);
        if (doc && doc.MonoBehaviour) {
          monoBehaviours.push(doc);
        }
      }

      return monoBehaviours;
    }

    extractMonoBehaviours().then((parsedData) => {
      parsedData[0].guid = metaData.split("\n")[1].slice(6);
      const relativePath = path.join("Scenes", filePath.replace(folderPath, ""));
      const outputFilePath = path.join(projectPath, "data", "output", relativePath.replace(/\.unity$/, ".json"));

      fs.mkdir(path.dirname(outputFilePath), { recursive: true }, (err) => {
        if (err) return callback(err);

        fs.writeFile(outputFilePath, JSON.stringify(parsedData, null, 2), callback);
      });
    }).catch(callback);
  });
}

function parseFile(filePath, folderPath, projectPath, callback) {
  if (folderPath.endsWith("Scenes")) {
    parseScene(filePath, folderPath, projectPath, callback);
    return;
  }

  fs.readFile(filePath, "utf-8", (err, fileData) => {
    if (err) return callback(err);

    fs.readFile(filePath + ".meta", "utf-8", (err, metaData) => {
      if (err) return callback(err);

      try {
        const parsedData = YAML.parseAllDocuments(fileData);
        parsedData[0].set("guid", metaData.split("\n")[1].slice(6));

        const relativePath = filePath.replace(folderPath, "");
        const outputFilePath = path.join(projectPath, "data", "output", relativePath.replace(/\.prefab$|\.asset|\.anim$/, ".json"));

        fs.mkdir(path.dirname(outputFilePath), { recursive: true }, (err) => {
          if (err) return callback(err);

          fs.writeFile(outputFilePath, JSON.stringify(parsedData, null, 2), callback);
        });
      } catch (parseError) {
        callback(parseError);
      }
    });
  });
}

parseFile(workerData.filePath, workerData.folderPath, workerData.projectPath, (err) => {
  if (err) {
    parentPort.postMessage({ error: err.message });
  } else {
    parentPort.postMessage({ success: true });
  }
});