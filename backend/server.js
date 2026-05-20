const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Middleware to strip Vercel's route prefix if present (Experimental Services support)
app.use((req, res, next) => {
  if (req.url.startsWith('/_/backend')) {
    req.url = req.url.slice('/_/backend'.length);
  }
  next();
});

const tempDir = process.env.VERCEL
  ? '/tmp'
  : path.join(__dirname, 'temp');

if (!process.env.VERCEL && !fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const binDir = path.join(__dirname, 'bin');
const ytDlpPath = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

// Active download tasks progress store
const tasks = {};

// Clean up old temporary files on startup (only locally)
if (!process.env.VERCEL) {
  try {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      fs.unlinkSync(path.join(tempDir, file));
    }
    console.log('[cleanup] Cleared temporary downloads folder.');
  } catch (err) {
    console.error('[cleanup] Error clearing temp folder:', err.message);
  }
}

// Check if yt-dlp binary exists
function checkBinary() {
  if (!fs.existsSync(ytDlpPath)) {
    console.error(`[error] yt-dlp binary not found at: ${ytDlpPath}`);
    console.log('[setup] Running installer script...');
    try {
      require('child_process').execSync('node install-yt-dlp.js', { stdio: 'inherit' });
    } catch (err) {
      console.error('[setup] Automatic installation failed:', err.message);
    }
  }
}
checkBinary();

// Helper: Run yt-dlp with arguments and return output or spawn process
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(ytDlpPath, args);
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

// Endpoint: Get video info
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`[info] Fetching metadata for: ${url}`);
  try {
    const stdout = await runYtDlp(['--dump-json', '--no-playlist', '--skip-download', url]);
    const metadata = JSON.parse(stdout);
    
    // Extract relevant details
    const info = {
      id: metadata.id,
      title: metadata.title,
      uploader: metadata.uploader || metadata.channel,
      duration: metadata.duration, // in seconds
      thumbnail: metadata.thumbnail || (metadata.thumbnails && metadata.thumbnails.length > 0 ? metadata.thumbnails[metadata.thumbnails.length - 1].url : ''),
      viewCount: metadata.view_count,
      description: metadata.description ? metadata.description.slice(0, 200) + '...' : '',
      webpageUrl: metadata.webpage_url
    };

    res.json(info);
  } catch (err) {
    console.error(`[info] Error fetching metadata:`, err.message);
    res.status(500).json({ error: 'Failed to fetch video details. Verify the URL is correct.' });
  }
});

// Endpoint: Start download
app.post('/api/download/start', (req, res) => {
  const { url, format = 'm4a' } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const taskId = uuidv4();
  const filenameTemplate = `${taskId}.%(ext)s`;
  const outputPattern = path.join(tempDir, filenameTemplate);

  tasks[taskId] = {
    id: taskId,
    status: 'starting',
    percent: 0,
    speed: '0 KiB/s',
    eta: '--:--',
    title: '',
    filePath: null,
    error: null,
    format
  };

  console.log(`[download] Starting download task ${taskId} (${format}) for URL: ${url}`);

  // Construct yt-dlp arguments based on the requested format
  let downloadArgs = [];
  if (format === 'mp3') {
    // Extract audio and convert to MP3 using ffmpeg
    downloadArgs = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0', // Best VBR quality
      '--ffmpeg-location', binDir,
      '-o', outputPattern,
      '--no-playlist',
      url
    ];
  } else if (format === 'mp4') {
    // Download high quality video (MP4) and merge with audio (M4A)
    downloadArgs = [
      '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]',
      '--ffmpeg-location', binDir,
      '-o', outputPattern,
      '--no-playlist',
      url
    ];
  } else {
    // Default to M4A (fast, native, no transcoding required)
    downloadArgs = [
      '-f', 'ba[ext=m4a]', 
      '--ffmpeg-location', binDir,
      '-o', outputPattern,
      '--no-playlist',
      url
    ];
  }

  const ytDlpProcess = spawn(ytDlpPath, downloadArgs);
  tasks[taskId].process = ytDlpProcess;

  ytDlpProcess.stdout.on('data', (data) => {
    const line = data.toString();
    
    // Parse progress percentage, speed, and ETA
    // Match "[download]  12.5% of   5.12MiB at  2.41MiB/s ETA 00:03"
    // Also matches ffmpeg post-processing lines like "[ExtractAudio]" or "[ffmpeg]"
    const percentMatch = line.match(/\[download\]\s+([\d.]+)%/);
    const speedMatch = line.match(/at\s+([\d.]+[a-zA-Z/]+)/);
    const etaMatch = line.match(/ETA\s+([\d:]+)/);

    // If it's converting or post-processing, show that status
    if (line.includes('[ExtractAudio]') || line.includes('[ffmpeg]') || line.includes('[FixupM4a]')) {
      tasks[taskId].status = 'converting';
      tasks[taskId].percent = 99; // Almost done
    }

    if (percentMatch) {
      tasks[taskId].status = 'downloading';
      tasks[taskId].percent = parseFloat(percentMatch[1]);
    }
    if (speedMatch) {
      tasks[taskId].speed = speedMatch[1];
    }
    if (etaMatch) {
      tasks[taskId].eta = etaMatch[1];
    }
  });

  ytDlpProcess.stderr.on('data', (data) => {
    const errorLine = data.toString();
    console.error(`[download-error] Task ${taskId}: ${errorLine}`);
  });

  ytDlpProcess.on('close', (code) => {
    delete tasks[taskId].process; // Remove process reference

    if (code === 0) {
      // Find the created file in the temp directory
      const files = fs.readdirSync(tempDir);
      const downloadedFile = files.find(file => file.startsWith(taskId));

      if (downloadedFile) {
        tasks[taskId].status = 'completed';
        tasks[taskId].percent = 100;
        tasks[taskId].filePath = path.join(tempDir, downloadedFile);
        console.log(`[download] Task ${taskId} completed successfully. File: ${downloadedFile}`);
      } else {
        tasks[taskId].status = 'failed';
        tasks[taskId].error = 'Downloaded file not found on disk.';
        console.error(`[download] Task ${taskId} failed: File not found.`);
      }
    } else {
      tasks[taskId].status = 'failed';
      tasks[taskId].error = `yt-dlp process exited with code ${code}`;
      console.error(`[download] Task ${taskId} failed with exit code ${code}`);
    }
  });

  // Respond immediately with taskId so frontend can poll
  res.json({ taskId });
});

// Endpoint: Check task progress
app.get('/api/download/progress/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks[taskId];

  if (!task) {
    return res.status(404).json({ error: 'Download task not found' });
  }

  // Return status information (omit process reference)
  res.json({
    id: task.id,
    status: task.status,
    percent: task.percent,
    speed: task.speed,
    eta: task.eta,
    error: task.error
  });
});

// Endpoint: Download file
app.get('/api/download/file/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks[taskId];

  if (!task || !task.filePath || !fs.existsSync(task.filePath)) {
    return res.status(404).send('File not found or task is not completed yet.');
  }

  const originalExtension = path.extname(task.filePath);
  
  // Custom response headers based on file type
  if (originalExtension === '.mp4') {
    res.setHeader('Content-Type', 'video/mp4');
  } else if (originalExtension === '.mp3') {
    res.setHeader('Content-Type', 'audio/mpeg');
  } else {
    res.setHeader('Content-Type', 'audio/mp4'); // M4A
  }
  
  // We can pass a title query parameter from frontend to name the file nicely
  const cleanTitle = req.query.title 
    ? req.query.title.replace(/[\\/*?:"<>|]/g, '') // remove invalid characters
    : 'youtube-audio';

  const downloadName = `${cleanTitle}${originalExtension}`;
  
  console.log(`[file] Streaming download for Task ${taskId}: ${downloadName}`);
  
  res.download(task.filePath, downloadName, (err) => {
    if (err) {
      console.error(`[file] Error during stream:`, err.message);
    }

    // Delete the file after download finishes to save space
    try {
      if (fs.existsSync(task.filePath)) {
        fs.unlinkSync(task.filePath);
        console.log(`[file] Deleted temp file for Task ${taskId}: ${task.filePath}`);
      }
      delete tasks[taskId];
    } catch (cleanErr) {
      console.error(`[file] Failed to clean up temp file:`, cleanErr.message);
    }
  });
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`==================================================`);
});
