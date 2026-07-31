const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

// Dev/test driver only — production uses the S3 driver. Same interface,
// bytes land under STORAGE_LOCAL_DIR (default ./uploads, git-ignored).

const baseDir = () =>
  path.resolve(process.env.STORAGE_LOCAL_DIR || path.join(process.cwd(), "uploads"));

// Keys are generated server-side, but resolve defensively anyway so a
// corrupted key can never escape the uploads directory.
const resolveKey = (key) => {
  const full = path.resolve(baseDir(), key);
  if (!full.startsWith(baseDir() + path.sep)) {
    throw new Error(`Storage key escapes the uploads directory: ${key}`);
  }
  return full;
};

const put = async (key, buffer) => {
  const full = resolveKey(key);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, buffer);
};

const getStream = async (key) => {
  const full = resolveKey(key);
  const stat = await fsp.stat(full);
  return { stream: fs.createReadStream(full), contentLength: stat.size };
};

const remove = async (key) => {
  await fsp.unlink(resolveKey(key)).catch((err) => {
    if (err.code !== "ENOENT") throw err;
  });
};

// Local disk cannot mint URLs; callers fall back to streaming through the API.
const presignGet = async () => null;

module.exports = { put, getStream, remove, presignGet };
