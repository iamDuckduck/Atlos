import { appendFile } from 'node:fs/promises';

const scripts = {
    overrides: 'validate-marker-overrides.mjs',
    intel: 'validate-intel-data.mjs',
    locale: 'validate-locale-icu.mjs',
    'tile-coverage': 'generate-tile-coverage.mjs',
    'marker-stats': 'build-marker-stats.mjs',
    'marker-lookup': 'build-marker-lookup.mjs',
    'marker-diff': 'build-marker-version-new.mjs',
    'search-index': 'build-search-index.mjs',
    'relink-preview': 'build-relink-preview.mjs',
    seo: 'build-seo-pages.mjs',
};

export const dataTask = async (runner, name = 'check') => {
    if (name === 'prepare') {
        for (const task of [
            'overrides',
            'tile-coverage',
            'marker-stats',
            'marker-lookup',
            'marker-diff',
            'search-index',
            'relink-preview',
        ]) {
            await dataTask(runner, task);
        }
    } else if (name === 'check') {
        for (const task of ['overrides', 'intel', 'locale'])
            await dataTask(runner, task);
        await runner.run('node', [
            './scripts/generate-tile-coverage.mjs',
            '--check',
        ]);
        await runner.run('node', ['./scripts/build-marker-lookup.mjs', '--check']);
    } else if (scripts[name]) {
        await runner.run(
            'node',
            [
                `./scripts/${scripts[name]}`,
                ...(name === 'intel' && runner.env.ATLOS_SOURCE_ONLY === '1'
                    ? ['--source-only']
                    : []),
            ],
            name === 'seo'
                ? {
                      SEO_WRITE_ALL_POINT_FILES: '1',
                      SEO_SKIP_IMAGES: '1',
                  }
                : {},
        );
    } else {
        throw new Error(
            `Unknown data task: ${name}. Use prepare, check, ${Object.keys(scripts).join(', ')}.`,
        );
    }
};

export const prepareTypes = async (runner, app = 'all') => {
    if (['all', 'main', 'intel', 'user-hub'].includes(app))
        await dataTask(runner, 'marker-diff');
    if (['all', 'main', 'relink'].includes(app))
        await dataTask(runner, 'relink-preview');
};

export const typeCheck = async (runner, app = 'all', prepare = true) => {
    if (prepare) await prepareTypes(runner, app);
    const projects = {
        main: '.',
        intel: 'apps/intel',
        'user-hub': 'apps/user-hub',
        world: 'apps/world',
        search: 'oem-search',
        relink: 'oem-relink',
    };
    if (app !== 'all' && !projects[app])
        throw new Error(`Unknown type-check app: ${app}`);
    // Typed lint also uses these projects; keep memory use bounded on CI.
    for (const [name, project] of Object.entries(projects)) {
        if (app === 'all' || app === name)
            await runner.run('pnpm', [
                ...(name === 'world' ? ['--filter', '@atlos/world'] : []),
                'exec',
                'tsc',
                '--noEmit',
                '--project',
                name === 'world' ? '.' : project,
            ]);
    }
};

export const test = async (runner, app = 'all', runSuite = (_name, run) => run()) => {
    if (
        !['all', 'main', 'intel', 'user-hub', 'scripts', 'relink', 'world'].includes(app)
    )
        throw new Error(`Unknown test app: ${app}`);
    if (app === 'all' || app === 'scripts')
        await runSuite('Script tests', () => runner.run('node', [
            '--test',
            './scripts/tasks.spec.mjs',
            './scripts/closure.spec.mjs',
            './scripts/package-pages.spec.mjs',
            './scripts/map-tiles.spec.mjs',
            './scripts/noclip.test.mjs',
        ]));
    if (app === 'all' || app === 'main' || app === 'relink') {
        await runSuite('Main and Relink tests', () => runner.run('pnpm', [
            'exec',
            'vitest',
            'run',
            ...(app === 'all'
                ? []
                : app === 'main'
                  ? ['--exclude', 'oem-relink/**']
                  : ['oem-relink']),
        ]));
    }
    if (app === 'all' || app === 'world')
        await runSuite('World tests', () => runner.run('pnpm', [
            'exec', 'vitest', 'run', '--config', 'apps/world/vitest.config.ts',
        ]));
    if (app === 'all' || app === 'intel')
        await runSuite('Intel tests', () => runner.run('pnpm', [
            'exec',
            'vitest',
            'run',
            '--config',
            'apps/intel/vitest.config.ts',
        ]));
    if (app === 'all' || app === 'user-hub')
        await runSuite('User Hub tests', () => runner.run('pnpm', [
            'exec',
            'vitest',
            'run',
            '--config',
            'apps/user-hub/vitest.config.ts',
        ]));
};

export const lint = async (runner, fix = false) => {
    await runner.run('node', ['./scripts/lint.mjs', ...(fix ? ['--fix'] : [])]);
};

export const check = async (runner, prepared = false) => {
    await dataTask(runner, 'check');
    if (!prepared) await prepareTypes(runner);
    await typeCheck(runner, 'all', false);

    if (runner.env.ATLOS_FORK_SEQUENTIAL_REPORT !== '1' || runner.dryRun) {
        await lint(runner);
        await test(runner);
        return;
    }

    const rows = ['| TypeScript | Passed |'];
    const failed = [];
    const reportCheck = async (name, run) => {
        try {
            await run();
            rows.push(`| ${name} | Passed |`);
        } catch (error) {
            runner.signal?.throwIfAborted();
            failed.push(name);
            rows.push(`| ${name} | Failed |`);
            console.error(`[check] ${name}: ${error.message}`);
        }
    };

    await reportCheck('Lint', () => lint(runner));
    await test(runner, 'all', reportCheck);

    const report = [
        '## Sequential check results',
        '',
        '| Check | Result |',
        '| --- | --- |',
        ...rows,
    ].join('\n');
    console.log(report);
    const summary = runner.env.GITHUB_STEP_SUMMARY;
    if (summary) await appendFile(summary, `${report}\n\n`, 'utf8');
    if (failed.length) throw new Error(`Checks failed: ${failed.join(', ')}`);
};
