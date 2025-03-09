const fs = require("fs");
const { exec } = require("youtube-dl-exec");
const albumArt = require("album-art");
const fetch = require("node-fetch");
const path = require("path");
const child_process = require("child_process");
const archiver = require('archiver');

const videos = {};
const ffPath = path.resolve("./bin");
const isWindows = process.platform === "win32";
const nullDevice = isWindows ? "NUL" : "/dev/null";

// Get command-line arguments
const args = process.argv.slice(2);
const clientUUID = args[0];
const playlistName = args[1] || "test";
let downloadsDir = "";

async function createDirectory(dirPath, cb) {
  try {
    const dirExists = await fs.promises.access(dirPath).then(() => true).catch(() => false);
    if (dirExists) { cb(); return };

    await fs.promises.mkdir(dirPath, { recursive: true });
    console.log(`Directory created`);//: ${dirPath}`);
    cb();
  } catch (error) {
    console.error(`Error creating directory`);//: ${error.message}`);
  }
}

function sanitizePath(input) {
  // Caratteri non validi per i path su Windows
  const windowsInvalidChars = /[<>:"/\\|?*\x00-\x1F]/g;
  // Caratteri non validi per i path su Linux (nessuna restrizione particolarmente stretta)
  const linuxInvalidChars = /[^\x20-\x7E]/g;

  // Rimuovi i caratteri non validi per Windows
  let sanitizedInput = input.replace(windowsInvalidChars, '');

  // Rimuovi i caratteri non validi per Linux
  sanitizedInput = sanitizedInput.replace(linuxInvalidChars, '');

  return sanitizedInput;
}

async function deleteFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      //console.warn(`The file does not exist: ${filePath}`);
    } else {
      //console.error(`Error deleting file: ${filePath}`, error);
    }
  }
}

async function main(querystring) {

  function getValuesStartingWith(obj, prefix) {
    const result = [];
    function recursiveSearch(currentObj) {
      for (const key in currentObj) {
        if (currentObj.hasOwnProperty(key)) {
          const value = currentObj[key];
          if (typeof value === "string" && value.startsWith(prefix)) {
            result.push(value);
          }
          if (typeof value === "object" && value !== null) {
            recursiveSearch(value);
          }
        }
      }
    }
    recursiveSearch(obj);
    return result;
  }

  const songArtistAlbum = querystring.split(" , ");
  const querystringArray = (songArtistAlbum[0] + ' ' + songArtistAlbum[1]).replaceAll(" ", "+");
  let response = await fetch(
    "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
    {
      method: "POST",
      body: JSON.stringify({
        context: {
          client: {
            hl: "en",
            gl: "US",
            clientName: "WEB",
            clientVersion: "2.20250304.01.00",
          },
        },
        query: querystringArray,
      }),
    }
  );

  const resJson = await response.json();
  const video = getValuesStartingWith(resJson, "/watch");

  if (video.length > 0) {
    videos[querystring] = "https://youtube.com" + video[0];
  }
}

async function processCSV(filePath) {
  try {
    const data = await fs.promises.readFile(filePath, "utf8");
    const lines = data.split("\n").map((line) => line.trim()).filter((line) => line);

    await Promise.all(lines.map((line) => main(line.replaceAll('"', ''))));
    downloadVideos(videos);
  } catch (err) {
    console.error("Error reading the file:", err);
  }
}

const downloadImage = async (url, filepath) => {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Download error: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await fs.promises.writeFile(filepath, buffer);
    console.log(`Thumbnail saved`);
  } catch (error) {
    console.error(`Error downloading image: ${error.message}`);
  }
};

const download = async (title, videoUrl) => {
  return new Promise(async (resolve) => {
    try {
      let [artist, song, album] = title.split(" , ");

      let filenameFilteredSong = sanitizePath(song);

      downloadsDir = path.resolve("./clients/" + (clientUUID ? clientUUID + "/" : "") + "downloads/" + playlistName);
      const noThumb = path.join(downloadsDir, `${filenameFilteredSong}_nothumb.mp3`);
      const outputPath = path.join(downloadsDir, `${filenameFilteredSong}.mp3`);
      const imagePath = path.join(downloadsDir, `${filenameFilteredSong}.jpg`);

      await createDirectory(downloadsDir);

      console.log(`Downloading: ${song} by ${artist} (${album})`);

      try {
        await exec(videoUrl, {
          audioFormat: "mp3",
          forceOverwrites: true,
          ffmpegLocation: ffPath,
          o: noThumb,
          x: true,
          postprocessorArgs: `-metadata artist="${artist}" -metadata title="${song}" -metadata album="${album}"`
        });

        console.log("Download completed.");

        let imageUrl = await albumArt(artist, { album: album, size: "large" });
        console.log(`Thumbnail URL: ${imageUrl}`);

        await downloadImage(imageUrl, imagePath);

        // Compatible with Windows and Linux
        const addThumbCmd = [
          `${ffPath}/ffmpeg -y`,
          "-i", `"${noThumb}"`,
          "-i", `"${imagePath}"`,
          "-map", "0:a",
          "-map", "1",
          "-c:a", "copy",
          "-c:v", "mjpeg",
          "-metadata:s:v", 'title="Album Cover"',
          "-metadata:s:v", 'comment="Cover (Front)"',
          `"${outputPath}"`
        ].join(" ");

        child_process.execSync(`${addThumbCmd} > ${nullDevice} 2>&1`, { shell: true });

        console.log("Metadata added.");
        console.log("-----------------------------------------------------------")

        deleteFile(noThumb);
        deleteFile(imagePath);

      } catch (e) {
        console.log("Error during download:", e);
      }
    } catch (error) {
      console.log("General error:", error);
    }
    resolve();
  });
};

const downloadVideos = async (videos) => {
  try {
    const maxConcurrentDownloads = 1;
    let activeDownloads = 0;
    const downloadQueue = [];

    const downloadNext = () => {
      if (downloadQueue.length === 0 && activeDownloads === 0) {
        console.log("Creating compressed archive...");
        const zipDir = "./clients/" + (clientUUID ? clientUUID + "/" : "") + "zip/";
        createDirectory(zipDir, () => {
          zipDirectory(downloadsDir, zipDir + playlistName + ".zip")
        });
      }
      if (activeDownloads >= maxConcurrentDownloads) return;

      if (downloadQueue.length > 0) {
        const { title, url } = downloadQueue.shift();
        activeDownloads++;
        //console.log(`Downloading: ${title}`);

        download(title, url).finally(() => {
          activeDownloads--;
          downloadNext();
        });
      }
    };

    Object.entries(videos).forEach(([title, url]) => {
      downloadQueue.push({ title, url });
      downloadNext();
    });
  } catch (error) {
    console.error("Error loading video-urls.json:", error);
  }
};

function zipDirectory(sourceDir, outputZip) {

  // Crea una scrittura nel file di destinazione
  const output = fs.createWriteStream(outputZip);

  // Crea un'istanza dell'archiver per zippare
  const archive = archiver('zip', {
    zlib: { level: 9 }  // Imposta la compressione al livello massimo
  });

  // Gestione degli errori
  output.on('close', function () {
    console.log(`Archive created, starting DOWNLOAD... (~${Math.round(archive.pointer()/1000000)}MB`);
    console.log("All done. Bye!");
  });

  archive.on('error', function (err) {
    throw err;
  });

  // Imposta la destinazione dell'output
  archive.pipe(output);

  // Aggiungi la directory al file zip
  archive.directory(sourceDir, false);  // Il secondo parametro è il prefisso che vuoi dare all'interno dello zip. Lascia vuoto per mantenere la struttura originale

  // Finalizza e scrivi nel file zip
  archive.finalize();
}

processCSV(`clients/${clientUUID}/csv/${playlistName}.csv`);
