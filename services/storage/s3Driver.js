const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Production storage. Works unchanged against AWS S3, Cloudflare R2, or DO
// Spaces (set S3_ENDPOINT for the non-AWS ones). The bucket must be private
// with Block Public Access on and SSE enabled; the credentials are a
// dedicated IAM user scoped to put/get/delete on this bucket's
// dangote-delivery/* prefix only. Downloads happen via short-lived presigned
// GETs minted per request — no URL is ever stored.

let client = null;

const getClient = () => {
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || "auto",
      ...(process.env.S3_ENDPOINT
        ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
        : {}),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
};

const bucket = () => {
  const name = process.env.S3_BUCKET;
  if (!name) throw new Error("S3_BUCKET is not set but STORAGE_DRIVER=s3");
  return name;
};

const put = async (key, buffer, { contentType } = {}) => {
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
    })
  );
};

const getStream = async (key) => {
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key })
  );
  return {
    stream: res.Body,
    contentType: res.ContentType,
    contentLength: res.ContentLength,
  };
};

const remove = async (key) => {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
};

const presignGet = async (key, ttlSeconds = 300) => {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: ttlSeconds }
  );
};

module.exports = { put, getStream, remove, presignGet };
