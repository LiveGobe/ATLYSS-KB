import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import started from 'electron-squirrel-startup';
import * as path from 'path';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { Worker } from 'worker_threads';
import mw from './bin/nodemw/bot';
import parsers from "./parsers.json";
import compareVersions from './compareVersions';
import { execFile } from 'child_process';
import axios from 'axios'; // Add this import for fetching the script content

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: true,
    },
    autoHideMenuBar: app.isPackaged, // Make menu bar invisible in production
  });

  // load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  if (app.isPackaged) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools(); // Lock devtools in production
    });

    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F5' || (input.control && (input.key === 'R' || input.key === 'r'))) {
        event.preventDefault(); // Lock page reload in production
      }
    });
  }

  // prevent external links from opening in the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  // Change CSP to allow external links and stylesheets
  mainWindow.webContents.session.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: https: http: blob:",
          "style-src 'self' 'unsafe-inline' https: http:",
          "frame-src 'self' blob: atlyss.wiki.gg"
        ]
      }
    });
  });

  function getProjectPath() {
    if (!app.isPackaged) {
      return path.resolve(__dirname, '..', "..");
    } else {
      return process.resourcesPath;
    }
  }

  function getConfig() {
    const projectPath = getProjectPath();
    const configFilePath = path.join(projectPath, 'data', 'config.json');

    if (fs.existsSync(configFilePath)) return JSON.parse(fs.readFileSync(configFilePath, { encoding: 'utf-8' }));

    return {};
  }

  function setConfig(value) {
    const projectPath = getProjectPath();
    const configFilePath = path.join(projectPath, 'data', 'config.json');

    let config = { ...getConfig(), ...value };

    fs.mkdirSync(path.join(projectPath, 'data'), { recursive: true });
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), { encoding: 'utf-8' });
  }

  function countFiles(dir) {
    return fs.readdirSync(dir).reduce((acc, file) => {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        return acc + countFiles(filePath);
      } else if (file.endsWith('.prefab') || file.endsWith('.asset') || file.endsWith('.unity') || file.endsWith('.anim')) {
        return acc + 1;
      } else {
        return acc;
      }
    }, 0);
  }

  function parseRawFiles(folderPath, filesTotal, callback) {
    const projectPath = getProjectPath();
    let processedFiles = 0;
    let fileQueue = [];
    let activeTasks = 0;
    const MAX_CONCURRENT_TASKS = 5; // Controls how many files are processed at a time

    function processNextFile() {
      if (fileQueue.length === 0 || activeTasks >= MAX_CONCURRENT_TASKS) return;

      activeTasks++;
      const filePath = fileQueue.shift(); // Get next file

      // Start a worker to process the file
      const worker = new Worker(new URL("./yamlParser.worker.js", import.meta.url), {
        workerData: { filePath, folderPath, projectPath }
      });

      worker.on('message', (parsedData) => {
        processedFiles++;
        mainWindow.webContents.send("receiveFilesCount", processedFiles, filesTotal);
        activeTasks--;
        mainWindow.webContents.send("logMessage", `Parsed file ${path.basename(filePath)}. Progress: ${processedFiles}/${filesTotal}`);
        setImmediate(processNextFile); // Continue processing

        if (processedFiles === filesTotal) {
          callback(); // All files have been processed
        }
      });

      worker.on('error', (err) => {
        mainWindow.webContents.send("logMessage", `[ERROR] Couldn't process file: ${path.basename(filePath)}. Error message: ${err}`);
        console.error("Worker error processing file:", filePath, err);
        activeTasks--;
        setImmediate(processNextFile);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          mainWindow.webContents.send("logMessage", `[ERROR] Couldn't process file: ${path.basename(filePath)}. Error code: ${code}`);
          console.error(`Worker stopped with exit code ${code}`);
        }
      });

      setImmediate(processNextFile);
    }

    function readFilesRecursively(dir) {
      fs.readdir(dir, (err, files) => {
        if (err) {
          console.error("Error reading directory:", err);
          return;
        }

        let pending = files.length;
        if (!pending) return;

        files.forEach((file) => {
          const filePath = path.join(dir, file);
          fs.stat(filePath, (err, stat) => {
            if (err) {
              console.error("Error reading file stats:", err);
              return;
            }

            if (stat.isDirectory()) {
              readFilesRecursively(filePath);
            } else if (file.endsWith('.prefab') || file.endsWith('.asset') || file.endsWith(".unity") || file.endsWith(".anim")) {
              fileQueue.push(filePath);
            }

            if (!--pending) {
              setImmediate(processNextFile); // Start processing once all files are queued
            }
          });
        });
      });
    }

    // Start by removing the old output directory and reading files recursively
    if (!folderPath.endsWith("Scenes")) fs.rm(path.join(projectPath, "data", "output"), { recursive: true }, () => {
      readFilesRecursively(folderPath);
    });
    else readFilesRecursively(folderPath);
  }

  // Handle IPC
  ipcMain.handle('getAppPath', () => getProjectPath());

  ipcMain.handle('getGameVersion', () => {
    const projectPath = getProjectPath();
    const gameVersionFilePath = path.join(projectPath, 'data', 'gameVersion.txt');

    if (fs.existsSync(gameVersionFilePath)) return fs.readFileSync(gameVersionFilePath, { encoding: 'utf-8' });
  });

  ipcMain.handle('selectGameSourceFolder', async () => {
    const projectPath = getProjectPath();
    const config = getConfig();
    const defaultPath = config.gameSourceFolder || undefined;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      defaultPath
    });

    if (!result.canceled) {
      const gameProjectPath = path.resolve(result.filePaths[0], "ExportedProject");

      if (!fs.existsSync(path.join(gameProjectPath, "ProjectSettings", "ProjectSettings.asset"))) return { error: "Invalid game data folder" };
      const gameVersion = YAML.parseDocument(fs.readFileSync(path.join(gameProjectPath, "ProjectSettings", "ProjectSettings.asset"), { encoding: 'utf-8' })).get('PlayerSettings').get("bundleVersion");

      setConfig({ gameSourceFolder: result.filePaths[0], exportJSON: false, raw: false, parsed: false });
      fs.rmSync(path.join(projectPath, 'data', 'output'), { recursive: true, force: true });
      fs.rmSync(path.join(projectPath, 'data', 'parsed'), { recursive: true, force: true });
      fs.rmSync(path.join(projectPath, 'data', 'cache.json'), { force: true });
      fs.writeFileSync(path.join(projectPath, 'data', 'gameVersion.txt'), gameVersion, { encoding: 'utf-8' });

      if (defaultPath != undefined && defaultPath !== result.filePaths[0]) {
        app.relaunch();
        app.exit();
      }

      return { error: null, value: gameVersion };
    }
  });

  ipcMain.handle("getConfig", () => { return getConfig() });
  ipcMain.handle("setConfig", (_, value) => setConfig(value));

  ipcMain.handle("parseRawData", async () => {
    const config = getConfig();
    const gameProjectPath = path.resolve(config.gameSourceFolder, "ExportedProject");
    const resourcesPath = path.join(gameProjectPath, "Assets", "Resources");
    const scenesPath = path.join(gameProjectPath, "Assets", "Scenes");

    mainWindow.webContents.send("logMessage", "Counting total number of raw resource files...");
    const filesTotal = countFiles(resourcesPath);
    mainWindow.webContents.send("receiveFilesCount", 0, filesTotal);
    mainWindow.webContents.send("logMessage", `Total amount found: ${filesTotal}, starting to parse...`);
    mainWindow.webContents.send("stateChange", "PARSING");

    parseRawFiles(resourcesPath, filesTotal, () => {
      mainWindow.webContents.send("logMessage", "Parsed raw game data, counting scenes files...");
      const scenesTotal = countFiles(scenesPath);
      mainWindow.webContents.send("receiveFilesCount", 0, scenesTotal);
      mainWindow.webContents.send("logMessage", `Total amount found: ${scenesTotal}, starting to parse...`);
      parseRawFiles(scenesPath, scenesTotal, () => {
        setConfig({ raw: true });
        mainWindow.webContents.send("logMessage", "Parsed raw game data successfully!");
        mainWindow.webContents.send("stateChange", "RAW DATA PARSED");
      });
    });
  });

  ipcMain.handle("parseData", async (_, p) => {
    const projectPath = getProjectPath();
    const config = getConfig();
    const rawDataPath = path.join(projectPath, 'data', 'output');

    // Delete the "data/parsed" folder before starting the parsing process
    const parsedDataPath = path.join(projectPath, 'data', 'parsed');
    if (fs.existsSync(parsedDataPath)) {
      fs.rmSync(parsedDataPath, { recursive: true, force: true });
      setConfig({ parsed: false });
    }

    mainWindow.webContents.send("logMessage", `Starting to parse data using ${p.length} parsers...`);
    mainWindow.webContents.send("stateChange", "PARSING");

    let parsersDone = 0;

    for (let parser of p) {
      let worker;
      switch (parser) {
        case "classes":
          worker = new Worker(new URL("./parsers/classes.worker.js", import.meta.url), { workerData: { parser, rawDataPath, projectPath, config } });
          break;
        case "consumableItems":
          worker = new Worker(new URL("./parsers/consumableItems.worker.js", import.meta.url), { workerData: { parser, rawDataPath, projectPath, config } });
          break;
        case "creeps":
          worker = new Worker(new URL("./parsers/creeps.worker.js", import.meta.url), { workerData: { parser, rawDataPath, projectPath, config } });
          break;
        case "dropTables":
          worker = new Worker(new URL("./parsers/dropTables.worker.js", import.meta.url), { workerData: { parser, rawDataPath, projectPath, config } });
          break;
        case "equipmentItems":
          worker = new Worker(new URL("./parsers/equipmentItems.worker.js", import.meta.url), { workerData: { parser, rawDataPath, projectPath, config } });
          break;
        case "locations":
          worker = new Worker(new URL("./parsers/locations.worker.js", import.meta.url), { workerData: { parser, rawDataPath, projectPath, config } });
          break;
        case "npcs":
          worker = new Worker(new URL("./parsers/npcs.worker.js", import.meta.url), { workerData: { parser, rawDataPath, projectPath, config } });
          break;
        case "tradeItems":
          worker = new Worker(new URL("./parsers/tradeItems.worker.js", import.meta.url), { workerData: { parser, rawDataPath, projectPath, config } });
          break;
      }

      worker.on('message', (data) => {
        if (data.error) {
          mainWindow.webContents.send("logMessage", `[ERROR] Couldn't process parser: ${parser}. Error message: ${data.error}`);
          console.error("Worker error processing parser:", parser, data.error);
        } else if (data.finished) {
          mainWindow.webContents.send("logMessage", `Finished parsing ${parser}`);
          parsersDone++;

          if (parsersDone === p.length) {
            mainWindow.webContents.send("logMessage", "Finished parsing all data!");
            mainWindow.webContents.send("stateChange", "DATA PARSED");
            setConfig({ parsed: true });
          }
        } else {
          mainWindow.webContents.send("logMessage", `[${parser}] ${data.message}`);
        }
      });

      worker.on('error', (err) => {
        mainWindow.webContents.send("logMessage", `[ERROR] Couldn't process parser: ${parser}. Error message: ${err}`);
        console.error("Worker error processing parser:", parser, err);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          mainWindow.webContents.send("logMessage", `[ERROR] Couldn't process parser: ${parser}. Error code: ${code}`);
          console.error(`Worker stopped with exit code ${code}`);
        }
      });
    }
  });

  ipcMain.handle("getAvailableUploads", async () => {
    const projectPath = getProjectPath();

    const availableParsers = parsers.map(parser => {
      return {
        parser: parser.parser,
        name: parser.name,
        pageTitle: parser.pageTitle,
        available: fs.existsSync(path.join(projectPath, 'data', 'parsed', parser.parser))
      };
    });

    mainWindow.webContents.send("logMessage", `Found ${availableParsers.length} available parsed data files.`);
    return availableParsers;
  });

  ipcMain.handle("uploadData", async (_, p) => {
    const projectPath = getProjectPath();
    const config = getConfig();
    const versionName = fs.readFileSync(path.join(projectPath, 'data', 'gameVersion.txt'), 'utf8');

    async function updateWikiData(upload) {
      try {
        const client = new mw({
          protocol: "https",
          server: "atlyss.wiki.gg",
          path: "",
          username: config.username,
          password: config.password,
          debug: app.isPackaged ? false : true
        });


        const getArticle = (title) => {
          return new Promise((resolve, reject) => {
            client.getArticle(title, (err, data) => {
              if (err && err.code !== 'missingtitle') return reject(err);
              resolve(data);
            });
          });
        };

        const editArticle = (title, content, summary) => {
          return new Promise((resolve, reject) => {
            client.edit(title, content, summary, (err) => {
              if (err) return reject(err);
              resolve();
            });
          });
        };

        const logIn = () => {
          return new Promise((resolve, reject) => {
            client.logIn((err) => {
              if (err) return reject(err);
              resolve();
            });
          });
        };

        try {
          // const data = await getArticle(`${upload.pageTitle}/version.json`);
          // const remoteVersionData = data ? JSON.parse(data) : {};
          // if (remoteVersionData.version && compareVersions(remoteVersionData.version, versionName) !== -1) {
          //   return { error: "Remote version is newer. Skipping edit." };
          // }
          await logIn();

          const articleData = await getArticle(upload.pageTitle);

          const filePath = path.join(projectPath, 'data', 'parsed', upload.parser, `${upload.parser}.lua`);
          const newContent = fs.readFileSync(filePath, "utf8");

          if (articleData && articleData.trim() === newContent.trim()) {
            return { error: "No changes detected. Skipping edit." };
          }

          await editArticle(upload.pageTitle, newContent, `(Automated Update Using ATLYSS-KB) Updated data for version ${versionName}`);
          return { success: true };
        } catch (error) {
          return { error: error.message };
        }
      } catch (error) {
        return { error: error.message };
      }
    }

    const availableParsers = p.filter(parser => {
      const filePath = path.join(projectPath, 'data', 'parsed', parser.parser, `${parser.parser}.lua`);
      return fs.existsSync(filePath);
    });

    for (const upload of availableParsers) {
      try {
        const result = await updateWikiData(upload);
        if (result.error) {
          mainWindow.webContents.send("logMessage", `[ERROR] Couldn't upload data for ${upload.parser}. Error message: ${result.error}`);
        } else {
          mainWindow.webContents.send("logMessage", `Uploaded data for ${upload.parser} successfully!`);
        }
      } catch (error) {
        mainWindow.webContents.send("logMessage", `[ERROR] Couldn't upload data for ${upload.parser}. Error message: ${error.error}`);
      }
    }

    return { success: true };
  });

  ipcMain.handle("mergeData", async (_, p) => {
    const projectPath = getProjectPath();
    const config = getConfig();
    const versionName = fs.readFileSync(path.join(projectPath, 'data', 'gameVersion.txt'), 'utf8');


    function getProdPageTitle(devPageTitle) {
      // Remove trailing '/dev' from the pageTitle
      if (devPageTitle.endsWith('/dev')) {
        return devPageTitle.slice(0, -4);
      }
      return devPageTitle;
    }

    async function mergeWikiData(upload) {
      try {
        const client = new mw({
          protocol: "https",
          server: "atlyss.wiki.gg",
          path: "",
          username: config.username,
          password: config.password,
          debug: app.isPackaged ? false : true
        });

        const devPageTitle = upload.pageTitle;
        const prodPageTitle = getProdPageTitle(devPageTitle);

        // Login first
        await new Promise((resolve, reject) => client.logIn(err => err ? reject(err) : resolve()));

        // Get dev content
        const devContent = await new Promise((resolve, reject) => {
          client.getArticle(devPageTitle, (err, data) => {
            if (err) return reject(err);
            resolve(data);
          });
        });

        if (!devContent) {
          return { error: "No dev data found to promote." };
        }

        // Promote to prod
        await new Promise((resolve, reject) => {
          client.edit(prodPageTitle, devContent, `(ATLYSS-KB) Promoted dev data to prod for version ${versionName}`,
            err => {
              if (err) return reject(err);
              resolve();
            });
        });

        // Optionally, promote version.json as well
        const devVersionContent = await new Promise((resolve, reject) => {
          client.getArticle(`${devPageTitle}/version.json`, (err, data) => {
            if (err) return resolve(null); // ignore if missing
            resolve(data);
          });
        });

        if (devVersionContent) {
          await new Promise((resolve, reject) => {
            client.edit(`${prodPageTitle}/version.json`, devVersionContent, `(ATLYSS-KB) Promoted dev version.json to prod`, err => {
              if (err) return reject(err);
              resolve();
            });
          });
        }

        // Also promote Lua version module
        const luaVersionModule = `return {\n\tversion = function() \n\t\treturn \"${versionName.trim()}\"\n\tend\n}`;
        await new Promise((resolve, reject) => {
          client.edit(`${prodPageTitle}/version`, luaVersionModule, `(ATLYSS-KB) Promoted dev version module to prod`, err => {
            if (err) return reject(err);
            resolve();
          });
        });

        return { success: true };
      } catch (error) {
        return { error: error.message };
      }
    }

    // p is expected to be an array of upload objects (like uploadData)
    for (const upload of p) {
      try {
        const result = await mergeWikiData(upload);
        if (result.error) {
          mainWindow.webContents.send("logMessage", `[ERROR] Couldn't promote dev data for ${upload.parser}. Error message: ${result.error}`);
        } else {
          mainWindow.webContents.send("logMessage", `Promoted dev data for ${upload.parser} to prod successfully!`);
        }
      } catch (error) {
        mainWindow.webContents.send("logMessage", `[ERROR] Couldn't promote dev data for ${upload.parser}. Error message: ${error.error}`);
      }
    }

    return { success: true };
  });


  ipcMain.handle("clearCache", async () => {
    const projectPath = getProjectPath();
    const cacheFilePath = path.join(projectPath, 'data', 'cache.db');

    if (fs.existsSync(cacheFilePath)) {
      fs.rmSync(cacheFilePath, { force: true });
      mainWindow.webContents.send("logMessage", "Cache cleared successfully.");
      return { success: true };
    } else {
      mainWindow.webContents.send("logMessage", "No cache file found.");
      return { success: false, error: "No cache file found." };
    }
  });

  let cachedJQuery = null; // Variable to store cached jQuery

  async function getJQueryInline() {
    if (cachedJQuery) return cachedJQuery; // Return cached version if available

    try {
      const response = await axios.get('https://code.jquery.com/jquery-3.7.1.min.js');
      cachedJQuery = response.data; // Store jQuery script in cache
      return cachedJQuery;
    } catch (error) {
      console.error("Failed to load jQuery:", error);
      throw error;
    }
  }

  const pageCommonCache = {
    commonJS: null,
    commonCSS: null,
  };

  ipcMain.handle("getPage", async (_, title) => {
    const client = new mw({
      protocol: "https",
      server: "atlyss.wiki.gg",
      path: "",
      debug: app.isPackaged ? false : true
    });

    return new Promise(async (resolve, reject) => {
      try {
        // Get parsed page content
        client.api.call(
          { action: "parse", page: title, prop: "text|headhtml|modules|jsconfigvars", redirects: true },
          async (err, info, next, data) => {
            if (err) return reject(err);

            // Fetch common.js and common.css only if they haven't been cached
            if (!pageCommonCache.commonJS) {
              client.getArticle("MediaWiki:Common.js", async (error, common) => {
                if (error) return reject(error);

                // Cache common.js content
                pageCommonCache.commonJS = common;

                // Fetch common.css only if it hasn't been cached
                if (!pageCommonCache.commonCSS) {
                  client.getArticle("MediaWiki:Common.css", async (error, commonCSS) => {
                    if (error) return reject(error);

                    // Cache common.css content
                    pageCommonCache.commonCSS = commonCSS;

                    // Process the parsed content
                    processParsedContent(data, pageCommonCache, resolve, reject);
                  });
                } else {
                  // Use the cached common.css
                  processParsedContent(data, pageCommonCache, resolve, reject);
                }
              });
            } else {
              // Use the cached common.js
              if (!pageCommonCache.commonCSS) {
                client.getArticle("MediaWiki:Common.css", async (error, commonCSS) => {
                  if (error) return reject(error);

                  // Cache common.css content
                  pageCommonCache.commonCSS = commonCSS;

                  // Process the parsed content
                  processParsedContent(data, pageCommonCache, resolve, reject);
                });
              } else {
                // Use the cached common.css
                processParsedContent(data, pageCommonCache, resolve, reject);
              }
            }
          }
        );
      } catch (error) {
        reject(error);
      }
    });

    async function processParsedContent(data, pageCommonCache, resolve, reject) {
      const body = data.parse.text['*']
        .replace(/\<span class\=\"mw\-editsection\"\>.*\<\/span\>/g, "");

      // Fetch the startup script
      const startupScript = (await axios.get("https://atlyss.wiki.gg/load.php?lang=en&modules=startup&only=scripts&raw=1&skin=vector")).data.replace(`"local":"/load.php"`, `"local":"https://atlyss.wiki.gg/load.php"`);

      // Inject custom jQuery script
      const jQuery = `<script>${await getJQueryInline()}</script>`;

      // Resolve the srcdoc content with all necessary scripts
      resolve(`
          ${data.parse.headhtml["*"]
          .replace(
            "<head>",
            `<head><base href="https://atlyss.wiki.gg/"><style>.mw-parser-output { color: #ededed; background-color: rgba(49, 52, 49, 0.9); border: 1px solid #767476; margin-right: 1em; padding: 0.5em 0.8em; } a { text-decoration: none; }</style>`
          )
          .replace(
            `<script async="" src="/load.php?lang=en&amp;modules=startup&amp;only=scripts&amp;raw=1&amp;skin=vector"></script>`,
            () => `<script>${startupScript}</script>${jQuery}<script>${pageCommonCache.commonJS}</script><style>${pageCommonCache.commonCSS}</style>`
          )}
          ${body}
      </body></html>
      `);
    }
  });

  ipcMain.handle('ripAssets', async () => {
    const projectPath = getProjectPath();
    const executableName = 'AssetRipper.CLI.exe';
    const executablePath = path.join(projectPath, executableName);

    dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      title: 'Asset Ripper',
      message: 'AssetRipper.CLI is a fork of AssetRipper that works in command line mode. it\'s optional and not required to run the application.',
      detail: 'If you want to use it, please make sure to have the executable in the "resources" folder of the application. The executable is included with the application download.',
      buttons: ['OK']
    });

    if (!fs.existsSync(executablePath)) {
      const errorMessage = `Required plugin executable ${executableName} not found in application resources. Please download the ATLYSS-KB with the plugin included or from AssetRipper.CLI fork.`;
      mainWindow.webContents.send("logMessage", `[ERROR] ${errorMessage}`);
      dialog.showErrorBox("Missing Plugin", errorMessage);
      return { error: errorMessage };
    }

    const gameExecutableResult = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'ATLYSS.exe', extensions: ['exe'] }],
      message: "Select game executable"
    });

    if (gameExecutableResult.canceled || gameExecutableResult.filePaths.length === 0) {
      const errorMessage = 'No game executable selected. Please select ATLYSS.exe!';
      mainWindow.webContents.send("logMessage", `[ERROR] ${errorMessage}`);
      dialog.showErrorBox("No Game Executable Selected", errorMessage);
      return { error: errorMessage };
    }

    const gameExecutablePath = gameExecutableResult.filePaths[0];

    if (path.basename(gameExecutablePath) !== 'ATLYSS.exe') {
      const errorMessage = 'Invalid executable name. Expected "ATLYSS.exe".';
      mainWindow.webContents.send("logMessage", `[ERROR] ${errorMessage}`);
      dialog.showErrorBox("Invalid Executable", errorMessage);
      return { error: errorMessage };
    }

    const exportFolderResult = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      message: "Select a folder for data output"
    });

    if (exportFolderResult.canceled || exportFolderResult.filePaths.length === 0) {
      const errorMessage = 'No export folder selected.';
      mainWindow.webContents.send("logMessage", `[ERROR] ${errorMessage}`);
      dialog.showErrorBox("No Export Folder Selected", errorMessage);
      return { error: errorMessage };
    }

    const exportFolderPath = exportFolderResult.filePaths[0];

    return new Promise((resolve, reject) => {
      execFile(executablePath, [gameExecutablePath, exportFolderPath], (error, stdout, stderr) => {
        if (error) {
          mainWindow.webContents.send("logMessage", `[ERROR] Couldn't execute file: ${executableName}. Error message: ${error.message}`);
          dialog.showMessageBox(mainWindow, { message: `Couldn't execute file: ${executableName}. Error message: ${error.message}`, buttons: ["OK"] });
          return reject({ error: error.message });
        }
        if (stderr) {
          mainWindow.webContents.send("logMessage", `[ERROR] Execution error: ${stderr}`);
          dialog.showMessageBox(mainWindow, { message: `Execution error: ${stderr}`, buttons: ["OK"] });
          return reject({ error: stderr });
        }
        mainWindow.webContents.send("logMessage", `Executed file: ${executableName} successfully! Output: ${stdout}`);
        dialog.showMessageBox(mainWindow, { message: `Successfully ripped game's files! Ready to parse.`, buttons: ["OK"] });
        resolve({ success: true, output: stdout });
      });
    });
  });

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {


  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
