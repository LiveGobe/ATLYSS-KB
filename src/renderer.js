import './index.css';
import $ from "jquery";
import parsers from "./parsers.json";

const version = require('../package.json').version;
const githubAddress = "LiveGobe/ATLYSS-KB";

// get current version from package.json on github
$.getJSON(`https://raw.githubusercontent.com/${githubAddress}/master/package.json`, async function (data) {
    const projectPath = await api.getAppPath();

    async function switchToMainMenu() {
        const [config, gameVersion, availableUploads] = await Promise.all([api.getConfig(), api.getGameVersion(), api.getAvailableUploads()]);

        $(".pre-message").remove();
        $("#main-menu").show();
        $("#game-data-version").html(`Ver. ${gameVersion}`);
        $("#game-data-path").html(`Location: ${config.gameSourceFolder}`);
        $("#scripts-selection").html(parsers.map(parser => `<button type="button" class="script-select active" data-parser="${parser.parser}">${parser.name}</button>`).join(""));
        $("#uploads-selection").html(parsers.map(parser => `<button type="button" class="upload-select" disabled data-parser="${parser.parser}">${parser.name}</button>`).join(""));

        $(".upload-select").each((i, el) => {
            const parser = $(el).data("parser");
            if (availableUploads.find(u => u.parser === parser).available) $(el).prop("disabled", false).addClass("active");
        });

        $("#username").val(config.username);
        $("#password").val(config.password);
        $("#export-json-checkbox").prop("checked", config.exportJSON);

        if (config.raw) {
            $("#state span").text("RAW DATA PARSED");
            $("#parse-raw").text("Parse Raw Data Again");
            $("#parse-data-menu").show();

            if (config.parsed) {
                $("#state span").text("DATA PARSED");
                $("#parse-data").prop("disabled", false);
            }
        }

        $(".tab").on("click", function () {
            $(".tab").removeClass("active");
            const tab = $(this).data("tab");
            $(this).addClass("active");
            $(`#menu-${tab}`).show().siblings().hide();

            if (tab == "logs") {
                const $textarea = $("#logs");
                $textarea.scrollTop($textarea[0].scrollHeight - $textarea.height());
            }
        });

        $("#parse-raw").on("click", (e) => {
            e.preventDefault();
            $(e.target).prop("disabled", true);
            api.parseRawData();
        });

        $("#parse-data").on("click", (e) => {
            e.preventDefault();
            // Count amount of buttons with class "active"
            const p = [];
            $(".script-select.active").each((i, el) => p.push($(el).data("parser")));
            if (p.length === 0) return alert("Please select at least one script to parse.");

            $(e.target).prop("disabled", true);
            $("#upload-data").prop("disabled", true); // Disable upload button
            $("#clear-cache").prop("disabled", true); // Disable clear cache button

            api.parseData(p);
        });

        $(".script-select").on("click", function (e) {
            e.preventDefault();
            $(this).toggleClass("active");
        });

        $(".upload-select").on("click", async function (e) {
            e.preventDefault();
            if ($(this).prop("disabled")) return;

            $(this).toggleClass("active");
        });

        $("#upload-data").on("click", async (e) => {
            e.preventDefault();
            const p = [];
            $(".upload-select.active").each((i, el) => p.push($(el).data("parser")));
            if (p.length === 0) return alert("Please select at least one data table to upload.");

            $(e.target).prop("disabled", true);

            const uploads = p.map(parser => availableUploads.find(u => u.parser === parser));
            await api.uploadData(uploads);

            $(e.target).prop("disabled", false);
        });

        $("#clear-logs").on("click", (e) => {
            e.preventDefault();
            $("#logs").text("");
        });

        $("#save-settings").on("click", async (e) => {
            e.preventDefault();
            await api.setConfig({
                username: $("#username").val(),
                password: $("#password").val(),
                exportJSON: $("#export-json-checkbox").prop("checked")
            });

            alert("Settings saved.");
        });

        $("#clear-cache").on("click", async (e) => {
            e.preventDefault();
            await api.clearCache();
            alert("Cache cleared.");
        });

        api.onRecieveFilesCount((filesCount, totalFiles) => {
            $("#files-count span").text(`${filesCount}/${totalFiles}`);
        });

        api.onStateChange(async (state) => {
            $("#state span").text(state);
            if (state == "PARSING" || state == "UPLOADING") {
                $("#status span").text("BUSY");
                $("#upload-data").prop("disabled", true); // Disable upload button
                $("#clear-cache").prop("disabled", true); // Disable clear cache button
            } else if (state == "RAW DATA PARSED") {
                $("#status span").text("IDLE");
                $("#parse-raw").prop("disabled", false).text("Parse Raw Data Again");
                $("#parse-data-menu").show();
                $("#upload-data").prop("disabled", false); // Enable upload button
                $("#clear-cache").prop("disabled", false); // Enable clear cache button
            } else if (state == "DATA PARSED") {
                $("#status span").text("IDLE");
                $("#parse-data").prop("disabled", false);
                $("#upload-data").prop("disabled", false); // Enable upload button
                $("#clear-cache").prop("disabled", false); // Enable clear cache button
                // Update available uploads
                const availableUploads = await api.getAvailableUploads();
                $(".upload-select").each((i, el) => {
                    const parser = $(el).data("parser");
                    if (availableUploads.find(u => u.parser === parser).available) $(el).prop("disabled", false).addClass("active");
                    else $(el).prop("disabled", true).removeClass("active");
                });
                config.parsed = true;
            } else if (state == "DATA UPLOADED") {
                $("#status span").text("IDLE");
                $("#upload-data").prop("disabled", false);
                $("#clear-cache").prop("disabled", false); // Enable clear cache button
            }
        });

        api.onLogMessage((message) => {
            const $textarea = $("#logs");
            const scrollThreshold = 50; // Set a threshold for scrolling
            const isAtBottom = $textarea[0].scrollHeight - $textarea.scrollTop() - $textarea.height() <= scrollThreshold;
            $textarea.text($textarea.text() + message + "\n");
            if (isAtBottom) {
                $textarea.scrollTop($textarea[0].scrollHeight - $textarea.height());
            }
        });

        $("#game-data-path").on("click", async (e) => {
            e.preventDefault();
            alert("This will delete all parsed data. Proceed with caution.");
            await api.selectGameSourceFolder();
        });
    }

    if (data.version !== version) {
        $("#version").html("Version: " + version + " <span style='color: red;'>[OUTDATED]</span>");
        $(".pre-message").html(`<p>A new version is available. Please download the latest version from <a href="https://github.com/${githubAddress}" target="_blank">here</a>.</p>`);
    } else {
        $("#version").text(`Version: ${data.version}`);
        $(".pre-message").html(`<p>Checking contents...</p>`);

        const gameVersion = await api.getGameVersion();

        if (gameVersion) {
            $(".pre-message").html(`<p>Found game data for version ${gameVersion}.</p>`);
            switchToMainMenu();
        } else {
            const config = await api.getConfig();
            if (config.gameSourceFolder) return switchToMainMenu();

            const $button = $("<button id=\"select-folder\" type=\"button\">Select Folder</button>");
            const onClick = async function () {
                const result = await api.selectGameSourceFolder();

                if (result?.error) {
                    $(".pre-message").html(`<p>${result.error}</p>`);
                    $(".pre-message").append($button.on("click", onClick));
                } else if (result?.value) {
                    $(".pre-message").html(`<p>Found game data for version ${result.value}.</p>`);
                    switchToMainMenu();
                }
            }

            $button.on("click", onClick);

            $(".pre-message").html(`<p>No game data found. Please select the game data folder.</p>`).append($button);
        }
    }
});