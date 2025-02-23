# ATLYSS-KB

*A port of my ATLYSS-Data-Parser, built on Electron*

## Overview

ATLYSS-KB is a Windows desktop application designed with two primary user groups in mind. It serves as a quick reference for users seeking detailed information on the game and as a practical tool for wiki editors who want to update the game's wiki data in just a few steps. Whether you're exploring raw game data or streamlining your wiki updates, ATLYSS-KB aims to simplify the process.

## Features

- **Data Parsing & Visualization**  
  Quickly parse ATLYSS data files and display the results on the game's wiki.
- **Search Functionality**  
  Look for the actual data using robust wiki search engine.
- **Wiki Explorer**  
  Freely browse the game’s wiki directly within the application.
- **Export Data to Wiki**  
  Export the parsed game data directly to the wiki for further analysis or updates.

> **Note:**  
> ATLYSS-KB is in its early stages. The interface is minimal and may not be very intuitive. Feedback and contributions to improve usability are highly appreciated!

## Installation

1. **Download the Archive**  
   Visit the [Releases](https://github.com/LiveGobe/ATLYSS-KB/releases) page and download the latest ZIP archive.
2. **Extract the Archive**  
   Extract the contents of the ZIP file to a folder of your choice.
3. **Run the Application**  
   Open the extracted folder and double-click on `ATLYSS-KB.exe` to launch the application.

## Usage

When you launch ATLYSS-KB, you will see a basic window with two options:
1. Selecting game's data folder, which is required to make automated updates to wiki.
2. Opening the Knowledge Base directly, which will lock you for wiki browsing only.

Follow these steps to use the application:
1. **Opening Game's Data Folder**  
   - Click the **Select Folder** button.  
   - Select the folder with exported data using [AssetRipper](https://github.com/AssetRipper/AssetRipper) (Or press "Use AssetRipper.CLI" text on the bottom).

2. **Parse the Data**  
   - Once the data is loaded, open **Parsing** tab and click the **Parse Raw Data** button.  
   - The application will process the exported files (parsing time may vary depending on your computer specs and amount of files).

3. **Use Parsers For Game's Data**  
   - New menu in **Parsing** tab will appear.  
   - Make all parsers you want to use be green and press **Parse Selected Data** button.

4. **Export Data to Wiki**
   - Go to **Settings** tab and change your login and password to your credentials on the wiki.gg platform.
   - After parsing, open **Uploads** tab and make all uploads you want to use be green and press **Upload Selected Data** (Black uploads mean there isn't any parsed data for that upload, check your parsers).  
   - Await while selected data is being uploaded to the wiki.

6. **Explore the Game's Wiki**  
   - Switch to the **Knowledge Base** tab to browse the game's wiki.  
   - Navigate through various pages and use the search functionality to find relevant information.

> **Disclaimer:**  
> ATLYSS-KB is experimental. The Wiki Explorer and export functionality are newly added features and may not be fully polished. User feedback is welcome!

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository.
2. Create a feature branch:
   ```bash
   git checkout -b feature/my-new-feature
   ```
3. Commit your changes:
   ```bash
   git commit -am 'Describe your feature'
   ```
4. Push to your branch:
   ```bash
   git push origin feature/my-new-feature
   ```
5. Open a pull request with a description of your changes.

## License

This project is licensed under the GPL-3.0 License. See the [LICENSE](LICENSE) file for details.

## Sponsorship

If you enjoy using ATLYSS-KB, consider sponsoring future development at [Boosty.to/livegobe](https://boosty.to/livegobe).

## Contact

For issues or questions, please open an issue in the repository or reach out via the project’s [GitHub Discussions](https://github.com/LiveGobe/ATLYSS-KB/discussions).
