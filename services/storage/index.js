// Pluggable object storage. STORAGE_DRIVER=s3 in production; anything else
// (or unset) uses the local-disk driver for dev and tests. DB rows store only
// storage keys — never bytes, never URLs.

const DRIVER = process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";

const driver = DRIVER === "s3" ? require("./s3Driver") : require("./localDiskDriver");

module.exports = {
  DRIVER,
  put: driver.put,
  getStream: driver.getStream,
  remove: driver.remove,
  presignGet: driver.presignGet,
};
