// ============================================================================
// storage.js
// All file uploads/downloads go through here. Path convention is fixed:
// `${userId}/${uuid}-${filename}` — this is what the storage RLS policies
// in storage-buckets.sql check against, so don't change it without updating
// those policies too.
// ============================================================================
import { supabase } from './supabaseClient.js';
import { getUser } from './auth.js';

function uid() {
  const u = getUser();
  if (!u) throw new Error('storage.js: no authenticated user');
  return u.id;
}

/**
 * Upload a File/Blob to a bucket. Returns { path, publicUrl: null } —
 * buckets are private, so use getSignedUrl() to display/download later.
 */
export async function uploadFile(bucket, file, { filename } = {}) {
  const safeName = (filename || file.name || 'upload').replace(/[^\w.\-]/g, '_');
  const path = `${uid()}/${crypto.randomUUID()}-${safeName}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  return { path };
}

/** Short-lived signed URL for private files (default 1 hour). */
export async function getSignedUrl(bucket, path, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteFile(bucket, path) {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}

export async function listUserFiles(bucket) {
  const { data, error } = await supabase.storage.from(bucket).list(uid());
  if (error) throw error;
  return data;
}

// Convenience wrappers matching the current app's use cases.
export const uploadRecording = (blob, filename) => uploadFile('interview-recordings', blob, { filename });
export const uploadPortfolioEvidence = (file) => uploadFile('portfolio-evidence', file);
export const uploadDocument = (file) => uploadFile('documents', file);
export const uploadImage = (file) => uploadFile('images', file);
