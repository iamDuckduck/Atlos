import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const QUEUE_VERSION = 2;
const TOKEN_PATTERN = /^[0-9a-zA-Z]{7}$/;

export const SEO_OG_PUBLISH_QUEUE_FILE = '.publish-queue.json';

const queuePath = (outputDir) =>
    path.resolve(outputDir, SEO_OG_PUBLISH_QUEUE_FILE);

const emptyQueue = (requiresFullVerification = false) => ({
    version: QUEUE_VERSION,
    requiresFullVerification,
    entries: {},
});

const normalizeQueue = (value) => {
    if (
        !value ||
        value.version !== QUEUE_VERSION ||
        typeof value.requiresFullVerification !== 'boolean' ||
        !value.entries ||
        typeof value.entries !== 'object' ||
        Array.isArray(value.entries)
    ) {
        return null;
    }

    const entries = {};
    for (const [token, entry] of Object.entries(value.entries)) {
        if (!TOKEN_PATTERN.test(token)) return null;
        if (entry?.action !== 'upload' && entry?.action !== 'delete') return null;
        if (typeof entry.revision !== 'string' || !entry.revision) return null;
        entries[token] = {
            action: entry.action,
            revision: entry.revision,
        };
    }
    return {
        version: QUEUE_VERSION,
        requiresFullVerification: value.requiresFullVerification,
        entries,
    };
};

const writeQueue = async (outputDir, queue) => {
    const file = queuePath(outputDir);
    const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const orderedEntries = Object.fromEntries(
        Object.entries(queue.entries).sort(([left], [right]) =>
            left.localeCompare(right),
        ),
    );

    await fs.mkdir(outputDir, { recursive: true });
    try {
        await fs.writeFile(
            temporaryFile,
            `${JSON.stringify(
                {
                    version: QUEUE_VERSION,
                    requiresFullVerification: queue.requiresFullVerification,
                    entries: orderedEntries,
                },
                null,
                2,
            )}\n`,
        );
        await fs.rename(temporaryFile, file);
    } finally {
        await fs.rm(temporaryFile, { force: true });
    }
};

export const readSeoOgPublishQueue = async (outputDir) => {
    try {
        const parsed = JSON.parse(await fs.readFile(queuePath(outputDir), 'utf8'));
        const normalized = normalizeQueue(parsed);
        if (!normalized) {
            return {
                exists: true,
                invalid: true,
                ...emptyQueue(true),
            };
        }
        return { exists: true, invalid: false, ...normalized };
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return {
                exists: false,
                invalid: false,
                ...emptyQueue(true),
            };
        }
        if (error instanceof SyntaxError) {
            return {
                exists: true,
                invalid: true,
                ...emptyQueue(true),
            };
        }
        throw error;
    }
};

export const enqueueSeoOgPublishChanges = async (
    outputDir,
    { uploadTokens = [], deleteTokens = [] },
) => {
    const current = await readSeoOgPublishQueue(outputDir);
    const entries = { ...current.entries };
    let changed = false;

    for (const token of uploadTokens) {
        if (!TOKEN_PATTERN.test(token)) continue;
        entries[token] = { action: 'upload', revision: crypto.randomUUID() };
        changed = true;
    }
    for (const token of deleteTokens) {
        if (!TOKEN_PATTERN.test(token)) continue;
        entries[token] = { action: 'delete', revision: crypto.randomUUID() };
        changed = true;
    }

    if (!changed && !current.exists) return;
    await writeQueue(outputDir, {
        version: QUEUE_VERSION,
        requiresFullVerification: current.requiresFullVerification,
        entries,
    });
};

export const acknowledgeSeoOgPublishEntries = async (
    outputDir,
    processedEntries,
) => {
    const current = await readSeoOgPublishQueue(outputDir);
    const entries = { ...current.entries };

    for (const [token, processed] of Object.entries(processedEntries)) {
        if (entries[token]?.revision === processed.revision) {
            delete entries[token];
        }
    }

    await writeQueue(outputDir, {
        version: QUEUE_VERSION,
        requiresFullVerification: current.requiresFullVerification,
        entries,
    });
};

export const completeSeoOgFullVerification = async (
    outputDir,
    processedEntries = {},
) => {
    const current = await readSeoOgPublishQueue(outputDir);
    const entries = { ...current.entries };

    for (const [token, processed] of Object.entries(processedEntries)) {
        if (entries[token]?.revision === processed.revision) {
            delete entries[token];
        }
    }

    await writeQueue(outputDir, {
        version: QUEUE_VERSION,
        requiresFullVerification: false,
        entries,
    });
};
