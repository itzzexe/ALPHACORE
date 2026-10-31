// The programs this machine runs on the company's documents: tesseract reads
// text out of an image, pdftoppm turns a PDF into images, ffmpeg turns a
// recording into the audio a speech model reads, and whisper.cpp writes down
// what was said. All of them on this server; nothing is sent anywhere.
//
// None goes through a shell. Each is a known name — a setting may point at
// where it is installed, but not swap it for another program — run with an
// argument array, a time limit and a ceiling on what it may print.
// deploy/vps/tools-setup.sh installs them on a server.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { getSetting } from './settings.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };

const TOOLS = {
  tesseract: { setting: 'OCR_BIN', names: ['tesseract', 'tesseract.exe'], probe: ['--version'] },
  pdftoppm: { setting: 'PDFTOPPM_BIN', names: ['pdftoppm', 'pdftoppm.exe'], probe: ['-v'] },
  ffmpeg: { setting: 'FFMPEG_BIN', names: ['ffmpeg', 'ffmpeg.exe'], probe: ['-version'] },
  whisper: { setting: 'WHISPER_BIN', names: ['whisper-cli', 'whisper-cli.exe', 'main', 'whisper'], probe: ['--help'] },
};

/** Where a tool is: the setting, if it names that tool, or the tool's own name on the PATH. */
export function toolPath(name) {
  const t = TOOLS[name];
  if (!t) refuse(`no such tool: ${name}`);
  const set = getSetting(t.setting);
  if (set) {
    if (!t.names.includes(path.basename(set))) refuse(`${t.setting} must point at ${t.names[0]}, not ${path.basename(set)}`);
    return set;
  }
  return t.names[0];
}

/** Run a tool and return what it printed. */
export function runTool(name, args, { timeoutMs = 120_000, maxBuffer = 20 * 1024 * 1024 } = {}) {
  const bin = toolPath(name);
  return new Promise((resolve, reject) => {
    execFile(bin, args.map(String), { timeout: timeoutMs, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const why = err.code === 'ENOENT' ? `${name} is not installed on this server (deploy/vps/tools-setup.sh installs it)` : String(stderr || err.message).slice(0, 300);
        reject(Object.assign(new Error(why), { status: err.code === 'ENOENT' ? 503 : 500 }));
      } else resolve(String(stdout));
    });
  });
}

/** Which tools answer, for the pages that depend on them. */
export async function toolStatus() {
  const out = {};
  for (const [name, t] of Object.entries(TOOLS)) {
    try { await runTool(name, t.probe, { timeoutMs: 10_000 }); out[name] = true; } catch (e) { out[name] = e.status !== 503; }
  }
  out.whisperModel = Boolean(getSetting('WHISPER_MODEL'));
  return out;
}
