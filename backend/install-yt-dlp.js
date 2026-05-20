const fs = require('fs');
const path = require('path');
const https = require('https');
const ffbinaries = require('ffbinaries');

const binDir = path.join(__dirname, 'bin');
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

const isWindows = process.platform === 'win32';
const ytDlpUrl = isWindows
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

const destFilename = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const destPath = path.join(binDir, destFilename);

console.log(`[setup] Platform detected: ${process.platform}`);
console.log(`[setup] Target directory: ${binDir}`);

// Helper function to download yt-dlp
function downloadYtDlp(url, dest) {
  if (fs.existsSync(dest)) {
    console.log(`[setup] yt-dlp is already installed at ${dest}. Skipping download.`);
    return Promise.resolve();
  }
  
  console.log(`[setup] Downloading yt-dlp from: ${url}`);
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        if (!response.headers.location) {
          reject(new Error(`Redirected with no Location header (status: ${response.statusCode})`));
          return;
        }
        downloadYtDlp(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: Status Code ${response.statusCode} - ${response.statusMessage}`));
        return;
      }

      const file = fs.createWriteStream(dest);
      response.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          console.log(`[setup] yt-dlp download finished successfully.`);
          resolve();
        });
      });

      file.on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Helper function to download ffmpeg & ffprobe via ffbinaries
function downloadFFmpeg() {
  const ffmpegPath = path.join(binDir, isWindows ? 'ffmpeg.exe' : 'ffmpeg');
  const ffprobePath = path.join(binDir, isWindows ? 'ffprobe.exe' : 'ffprobe');
  
  if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) {
    console.log(`[setup] FFmpeg and FFprobe are already installed. Skipping download.`);
    return Promise.resolve();
  }

  console.log(`[setup] Downloading FFmpeg & FFprobe binaries via ffbinaries...`);
  return new Promise((resolve, reject) => {
    ffbinaries.downloadBinaries(['ffmpeg', 'ffprobe'], {
      destination: binDir,
      quiet: false
    }, (err, results) => {
      if (err) {
        console.error('[setup] Error downloading FFmpeg/FFprobe:', err);
        reject(err);
      } else {
        console.log('[setup] FFmpeg & FFprobe downloaded successfully!');
        resolve();
      }
    });
  });
}

// Run setup sequence
async function runSetup() {
  try {
    // 1. Download yt-dlp
    await downloadYtDlp(ytDlpUrl, destPath);
    if (!isWindows) {
      try {
        fs.chmodSync(destPath, '755');
        console.log(`[setup] Executable permissions (755) applied to ${destPath}`);
      } catch (err) {
        console.error(`[setup] Warning: Failed to apply executable permissions to ${destPath}:`, err.message);
      }
    }

    // 2. Download FFmpeg and FFprobe
    await downloadFFmpeg();

    console.log('[setup] All binaries (yt-dlp, ffmpeg, ffprobe) are installed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[setup] Critical setup error:', err);
    process.exit(1);
  }
}

runSetup();
