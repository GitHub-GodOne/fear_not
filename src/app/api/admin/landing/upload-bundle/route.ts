import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { PERMISSIONS } from '@/core/rbac';
import { respData, respErr } from '@/shared/lib/resp';
import { getConfigs, saveConfigs } from '@/shared/models/config';
import { getUserInfo } from '@/shared/models/user';
import {
  getLandingBundleRegistry,
  getLandingBundleVariantMap,
  type LandingBundleRegistryItem,
} from '@/shared/services/landing-config';
import { hasPermission } from '@/shared/services/rbac';

export const runtime = 'nodejs';

const unzipBinary = '/usr/bin/unzip';
const execFileAsync = promisify(execFile);

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeVariantValue(value: FormDataEntryValue | null) {
  const normalized = String(value || 'default').trim();
  return normalized || 'default';
}

function isSafeZipEntry(entry: string) {
  const normalized = entry.replace(/\\/g, '/').trim();

  if (!normalized) {
    return true;
  }

  if (
    normalized.startsWith('/') ||
    normalized.startsWith('..') ||
    normalized.includes('../') ||
    path.isAbsolute(normalized)
  ) {
    return false;
  }

  return true;
}

function pickHtmlEntry(entries: string[]) {
  const htmlEntries = entries.filter(
    (entry) =>
      entry.toLowerCase().endsWith('.html') && !entry.startsWith('__MACOSX/')
  );

  if (htmlEntries.length === 0) {
    return null;
  }

  return (
    htmlEntries.find((entry) => entry === 'index.html') ||
    htmlEntries.find((entry) => entry.toLowerCase().endsWith('/index.html')) ||
    htmlEntries[0]
  );
}

export async function POST(req: Request) {
  let tempDir = '';

  try {
    const user = await getUserInfo();
    if (!user) {
      return respErr('no auth, please sign in');
    }

    const canWrite = await hasPermission(user.id, PERMISSIONS.SETTINGS_WRITE);
    if (!canWrite) {
      return respErr('no permission', 403);
    }

    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return respErr('zip file is required');
    }

    const normalizedSlug = normalizeSlug(String(formData.get('slug') || ''));
    if (!normalizedSlug) {
      return respErr('valid bundle slug is required');
    }

    if (
      !file.name.toLowerCase().endsWith('.zip') &&
      file.type !== 'application/zip'
    ) {
      return respErr('only zip files are supported');
    }

    try {
      await fs.access(unzipBinary);
    } catch {
      return respErr('unzip binary is not available on this server', 500);
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'landing-bundle-'));
    const zipPath = path.join(tempDir, `${normalizedSlug}.zip`);
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(zipPath, fileBuffer);

    const { stdout } = await execFileAsync(unzipBinary, ['-Z1', zipPath], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const zipEntries = stdout
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (zipEntries.length === 0) {
      return respErr('zip archive is empty');
    }

    if (!zipEntries.every(isSafeZipEntry)) {
      return respErr('zip contains unsafe file paths');
    }

    const entryFile = pickHtmlEntry(zipEntries);
    if (!entryFile) {
      return respErr('zip must contain at least one html entry file');
    }

    const bundleRoot = path.join(process.cwd(), 'public', 'landing-bundles');
    const targetDir = path.join(bundleRoot, normalizedSlug);
    await fs.mkdir(bundleRoot, { recursive: true });
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(targetDir, { recursive: true });

    await execFileAsync(unzipBinary, ['-oq', zipPath, '-d', targetDir], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });

    const localeVariant = normalizeVariantValue(formData.get('locale'));
    const themeVariant = normalizeVariantValue(formData.get('theme'));
    const variantKey =
      String(formData.get('variantKey') || '').trim() ||
      `${localeVariant}:${themeVariant}`;
    const bundleTitle =
      String(formData.get('title') || '').trim() || normalizedSlug;

    const bundle: LandingBundleRegistryItem = {
      slug: normalizedSlug,
      title: bundleTitle,
      publicPath: `/landing-bundles/${normalizedSlug}`,
      indexPath: `/landing-bundles/${normalizedSlug}/${entryFile}`,
      entryFile,
      locale: localeVariant,
      theme: themeVariant,
      uploadedAt: new Date().toISOString(),
    };

    const configs = await getConfigs();
    const registry = getLandingBundleRegistry(configs).filter(
      (item) => item.slug !== normalizedSlug
    );
    const variants = getLandingBundleVariantMap(configs);

    const nextRegistry = [bundle, ...registry];
    const nextVariants = {
      ...variants,
      [variantKey]: normalizedSlug,
    };

    await saveConfigs({
      landing_home_bundle_enabled: 'true',
      landing_home_bundle_registry: JSON.stringify(nextRegistry, null, 2),
      landing_home_bundle_variants: JSON.stringify(nextVariants, null, 2),
    });

    return respData({
      bundle,
      variantKey,
    });
  } catch (error: any) {
    console.error('[landing upload bundle] failed:', error);
    return respErr(error.message || 'upload bundle failed', 500);
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}
