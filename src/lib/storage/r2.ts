import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { attachmentDisposition, type StorageDriver } from './types'
import { storageContentType } from '../mime'

export type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicBase?: string
}

export function readR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const missing = Object.entries({ R2_ACCOUNT_ID: accountId, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET: bucket })
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) throw new Error(`R2 driver needs: ${missing.join(', ')}`)
  return {
    accountId: accountId!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
    publicBase: process.env.R2_PUBLIC_BASE?.replace(/\/+$/, '') || undefined,
  }
}

export function createR2Client(cfg: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
}

export function createR2Driver(cfg = readR2Config()): StorageDriver {
  const client = createR2Client(cfg)

  return {
    name: 'r2',
    supportsPresign: true,

    async put(key, body, mime) {
      await client.send(
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: storageContentType(mime) }),
      )
    },

    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }))
      if (!res.Body) throw new Error(`R2 object has no body: ${key}`)
      return Buffer.from(await res.Body.transformToByteArray())
    },

    async presignPut(key, mime) {
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: storageContentType(mime) }),
        { expiresIn: 600 },
      )
    },

    async url(key) {
      if (cfg.publicBase) return `${cfg.publicBase}/${key}`
      return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
        expiresIn: 3600,
      })
    },

    // A public bucket URL can't carry a download name; the bytes still
    // download (they're stored as octet-stream), just under the hash.
    async downloadUrl(key, name) {
      if (cfg.publicBase) return `${cfg.publicBase}/${key}`
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          ResponseContentDisposition: attachmentDisposition(name),
        }),
        { expiresIn: 3600 },
      )
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
    },

    async has(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }))
        return true
      } catch {
        return false
      }
    },
  }
}
