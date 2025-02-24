import './index.css';
import $ from "jquery";
import parsers from "./parsers.json";

const version = require('../package.json').version;
const githubAddress = "LiveGobe/ATLYSS-KB";

// get current version from package.json on github
$.getJSON(`https://raw.githubusercontent.com/${githubAddress}/master/package.json`, async function (data) {
    const projectPath = await api.getAppPath();

    async function switchToMainMenu() {
        const [config, gameVersion, availableUploads, page] = await Promise.all([api.getConfig(), api.getGameVersion(), api.getAvailableUploads(), api.getPage("ATLYSS_Wiki")]);

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

        const $frame = $(`<iframe id="kb-frame" srcdoc="${page.replace(/"/g, '&quot;')}" sandbox="allow-scripts allow-same-origin" frameborder="0" style="width: 100%; height: calc(100% - 2.5rem);"></iframe>`);
        $("#menu-kb").append($frame);

        let historyStack = ["/wiki/ATLYSS_Wiki"];
        let historyIndex = 0;
        let pageCache = { "ATLYSS_Wiki": page };
        let isLoading = false;

        function loadPage(url) {
            if (isLoading) return;
            isLoading = true;
            updateNavigationButtons();
        
            const pageName = url.split('/wiki/')[1];
            if (pageCache[pageName]) {
                $frame.attr("srcdoc", pageCache[pageName]);
                // After updating srcdoc, check for hash and restore the scroll position
                const hash = window.location.hash;
                if (hash) {
                    $frame[0].contentWindow.location.hash = hash;
                }
                $frame[0].contentWindow.scrollTo(0, 0);
                isLoading = false;
                if (pageName == "ATLYSS_Wiki") {
                    $("#app h1").text("Atlyss Knowledge Base");
                } else {
                    $("#app h1").text(`Atlyss Knowledge Base - ${pageName}`);
                }
                updateNavigationButtons();
            } else {
                api.getPage(pageName).then(pageContent => {
                    pageCache[pageName] = pageContent;
                    $frame.attr("srcdoc", pageCache[pageName]);
                    const hash = window.location.hash;
                    if (hash) {
                        $frame[0].contentWindow.location.hash = hash;
                    }
                    $frame[0].contentWindow.scrollTo(0, 0);
                    isLoading = false;
                    $("#app h1").text(`Atlyss Knowledge Base - ${pageName}`);
                    updateNavigationButtons();
                }).catch(error => {
                    isLoading = false;
                    updateNavigationButtons();
                });
            }
        }

        window.addEventListener('message', function(event) {
            if (event.data.type === 'hashchange') {
                const { hash } = event.data;
                // Update the page or handle the hash change logic here
                console.log('Iframe hash changed:', hash);
                // If needed, you can adjust navigation, like scroll to the corresponding section.
            }
        });

        function navigateTo(url) {
            if (isLoading) return;

            const [baseUrl, anchor] = url.split('#');
            const currentBaseUrl = historyStack[historyIndex].split('#')[0];

            if (baseUrl === currentBaseUrl) {
                // Handle anchor link within the same page
                $frame[0].contentWindow.location.hash = anchor;
            } else {
                if (historyIndex < historyStack.length - 1) {
                    historyStack = historyStack.slice(0, historyIndex + 1);
                }
                historyStack.push(url);
                historyIndex++;
                loadPage(baseUrl);
            }
            updateNavigationButtons();
        }

        function goBack() {
            if (isLoading || historyIndex <= 0) return;
            historyIndex--;
            loadPage(historyStack[historyIndex]);
            updateNavigationButtons();
        }

        function goForward() {
            if (isLoading || historyIndex >= historyStack.length - 1) return;
            historyIndex++;
            loadPage(historyStack[historyIndex]);
            updateNavigationButtons();
        }

        const $backButton = $('<button id="back-button" class="nav-button" disabled>&larr;</button>');
        const $forwardButton = $('<button id="forward-button" class="nav-button" disabled>&rarr;</button>');
        $("#menu-kb").prepend($backButton, $forwardButton);

        function updateNavigationButtons() {
            $backButton.prop('disabled', isLoading || historyIndex <= 0);
            $forwardButton.prop('disabled', isLoading || historyIndex >= historyStack.length - 1);
        }

        $backButton.on('click', function () {
            goBack();
        });

        $forwardButton.on('click', function () {
            goForward();
        });

        $frame.on('load', function () {
            const iframeDocument = $frame[0].contentDocument || $frame[0].contentWindow.document;
            $(iframeDocument).on('click', 'a', function (e) {
                e.preventDefault();
                const url = $(this).attr('href');
                try {
                    if (url.startsWith('#')) {
                        // Handle anchor link within the same page
                        $frame[0].contentWindow.location.hash = url;
                    } else if (url.startsWith('/')) {
                        navigateTo(url);
                    } else {
                        window.open(url, '_blank');
                    }
                } catch (error) { }
            });

            // Add keyboard navigation inside iframe
            $(iframeDocument).on('keydown', function (e) {
                if (e.ctrlKey && (e.key === 'ArrowRight')) {
                    e.preventDefault();
                    goForward();
                } else if (e.ctrlKey && (e.key === 'ArrowLeft')) {
                    e.preventDefault();
                    goBack();
                }
            });
        });

        const $searchContainer = $('<div id="search-container"></div>');
        const $searchInput = $('<input type="text" id="search-input" placeholder="Search Knowledge Base">');
        const $searchDropdown = $('<div id="search-dropdown" class="dropdown-content"></div>').hide();

        $searchContainer.append($searchInput, $searchDropdown);
        $("#menu-kb").prepend($searchContainer);

        let searchTimeout;

        $searchInput.on("input", function () {
            clearTimeout(searchTimeout);
            const query = $searchInput.val();
            if (query) {
                searchTimeout = setTimeout(() => {
                    searchKnowledgeBase(query);
                }, 300); // Delay of 300ms
            } else {
                $searchDropdown.empty().hide();
            }
        });

        $searchInput.on("keydown", function (e) {
            const $results = $searchDropdown.children();
            let $selected = $results.filter(".active");

            if (e.key === "Escape") {
                e.preventDefault();
                $searchDropdown.empty().hide();
                e.target.blur();
                $frame.trigger("focus");
            } else if (e.key === "Enter") {
                e.preventDefault();
                if ($selected.length) {
                    $selected.trigger("click");
                }
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!$selected.length) {
                    // If nothing is selected, select the first item
                    $results.first().addClass("active");
                } else {
                    const $next = $selected.next();
                    if ($next.length) {
                        $selected.removeClass("active");
                        $next.addClass("active");
                    }
                }
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if ($selected.length) {
                    const $prev = $selected.prev();
                    if ($prev.length) {
                        $selected.removeClass("active");
                        $prev.addClass("active");
                    }
                }
            }
        });

        $searchInput.on("focus", function (e) {
            clearTimeout(searchTimeout);
            const query = $searchInput.val();
            if (query) {
                searchTimeout = setTimeout(() => {
                    searchKnowledgeBase(query);
                }, 300); // Delay of 300ms
            } else {
                $searchDropdown.empty().hide();
            }
        });

        $searchInput.on("blur", function (e) {
            setTimeout(() => {
                if (!$.contains($searchDropdown[0], document.activeElement)) {
                    $searchDropdown.empty().hide();
                }
            }, 100);
        });

        async function searchKnowledgeBase(query) {
            const apiUrl = `https://atlyss.wiki.gg/api.php?action=query&list=search&srsearch=${query}&format=json&origin=*`;
            const searchUrl = `https://atlyss.wiki.gg/api.php?action=opensearch&search=${query}&format=json&origin=*`;
            try {
                const [response, search] = await Promise.all([fetch(apiUrl), fetch(searchUrl)]);
                const [data, searchData] = await Promise.all([response.json(), search.json()]);
                const searchResults = data.query.search;
                const openSearchResults = searchData[1];

                $searchDropdown.empty();

                const combinedResults = new Map();

                searchResults.forEach((result) => {
                    combinedResults.set(result.title, `https://atlyss.wiki.gg/wiki/${result.title}`);
                });

                openSearchResults.forEach((title, index) => {
                    if (!combinedResults.has(title) && index < 9) {
                        combinedResults.set(title, searchData[3][index]);
                    }
                });

                if (combinedResults.size > 0) {
                    let index = 0;
                    combinedResults.forEach((url, title) => {
                        if (index >= 9) return;

                        const $resultItem = $(`<a href="#" id="search-result-${index}">${title}</a>`);
                        if (index == 0) $resultItem.addClass("active");
                        $resultItem.on("click", function (e) {
                            e.preventDefault();
                            navigateTo(url);
                            $searchDropdown.empty().hide();
                            $searchInput.val("");
                        });
                        $searchDropdown.append($resultItem);
                        index++;
                    });
                    $searchDropdown.show();
                } else {
                    $searchDropdown.hide();
                }
            } catch (error) {
                console.error("Error fetching search results:", error);
                alert("An error occurred while searching. Please try again.");
            }
        }

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
            if ($(this).hasClass("locked")) return;

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
                $("#parse-data").prop("disabled", true);
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
            const scrollThreshold = 100; // Set a threshold for scrolling
            const isAtBottom = $textarea[0].scrollHeight - $textarea.scrollTop() - $textarea.height() <= scrollThreshold;
            $textarea.text($textarea.text() + message + "\n");
            if (isAtBottom) {
                $textarea.scrollTop($textarea[0].scrollHeight - $textarea.height());
            }
        });

        $("#game-data-path").on("click", async (e) => {
            e.preventDefault();
            if ($(e.target).prop("disabled")) return;

            $(e.target).prop("disabled", true);
            alert("This will delete all parsed data. Proceed with caution.");
            await api.selectGameSourceFolder();
        });
    }

    $("#asset-ripper").on("click", async (e) => {
        e.preventDefault();
        if ($(e.target).prop("disabled")) return;

        $(e.target).text("Ripping assets...");
        $(e.target).prop("disabled", true);
        api.ripAssets().then(() => {
            $(e.target).text("Use AssetRipper.CLI");
            $(e.target).prop("disabled", false);
        });
    });

    if (data.version !== version) {
        $("#version").html("Version: " + version + " <span style='color: red;'>[OUTDATED]</span>");
        $(".pre-message").html(`<p>A new version is available. Please download the latest version from <a href="https://github.com/${githubAddress}" target="_blank">here</a>.</p>`);
    } else {
        $("#credits").on("click", function (e) {
            alert("AssetRipper by Jeremy Pritts\nAtlyss Wiki by Atlyss Wiki Community\nAtlyss by Kiseff\n\nI am not affiliated with the above projects in any way.");
        });

        $("#version").text(`Version: ${data.version}`);
        $(".pre-message").html(`<p>Checking contents...</p>`);

        const gameVersion = await api.getGameVersion();

        if (gameVersion) {
            $(".pre-message").html(`<p>Found game data for version ${gameVersion}.</p>`);
            switchToMainMenu();
        } else {
            const config = await api.getConfig();
            if (config.gameSourceFolder) return switchToMainMenu();

            const $selectFolderButton = $("<button id=\"select-folder\" type=\"button\">Select Folder</button>");
            const onClickSelectFolder = async function () {
                const result = await api.selectGameSourceFolder();

                if (result?.error) {
                    $(".pre-message").html(`<p>${result.error}</p>`);
                    $(".pre-message").append($selectFolderButton.on("click", onClickSelectFolder));
                } else if (result?.value) {
                    $(".pre-message").html(`<p>Found game data for version ${result.value}.</p>`);
                    switchToMainMenu();
                }
            }

            $selectFolderButton.on("click", onClickSelectFolder);

            const $knowledgeBaseButton = $("<button id=\"knowledge-base\" type=\"button\">Go to Knowledge Base</button>");
            const onClickKnowledgeBase = async function () {
                $knowledgeBaseButton.prop("disabled", true);
                $selectFolderButton.prop("disabled", true);
                await switchToMainMenu();
                lockTabsExceptKnowledgeBase();
                $(".tab[data-tab='kb']").trigger("click");
            }

            $knowledgeBaseButton.on("click", onClickKnowledgeBase);

            $(".pre-message").html(`<p>No game data found. Please select the game data folder or go to the knowledge base.</p>`)
                .append($selectFolderButton)
                .append($knowledgeBaseButton);
        }

        function lockTabsExceptKnowledgeBase() {
            $(".tab").not("[data-tab='kb']").addClass("locked");
            $(".tab[data-tab='kb']").removeClass("locked");
        }
    }
});