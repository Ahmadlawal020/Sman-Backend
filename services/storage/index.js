// Object storage. Production uses Cloudinary (client-direct upload: the client
// uploads straight to Cloudinary via a backend-signed payload; the backend
// never sees the bytes — mode === "direct"). The local-disk driver is the
// offline dev/test fallback only, used when STORAGE_DRIVER isn't "cloudinary"
// (it's backend-mediated so the suite can upload without a Cloudinary account).
// DB rows store only opaque storage keys — never bytes, never public URLs.

const DRIVER = process.env.STORAGE_DRIVER === "cloudinary" ? "cloudinary" : "local";

const driver =
  DRIVER === "cloudinary" ? require("./cloudinaryDriver") : require("./localDiskDriver");

// backend drivers don't declare a mode; only the direct driver does.
const MODE = driver.mode || "backend";

const notDirect = (name) => () => {
  throw new Error(`${name}() is only available on a direct-upload driver (STORAGE_DRIVER=cloudinary)`);
};

module.exports = {
  DRIVER,
  MODE,
  // backend-mediated
  put: driver.put,
  getStream: driver.getStream,
  // both
  remove: driver.remove,
  presignGet: driver.presignGet,
  // client-direct (throw a clear error on backend drivers)
  signUpload: driver.signUpload || notDirect("signUpload"),
  verifyUploaded: driver.verifyUploaded || notDirect("verifyUploaded"),
};
