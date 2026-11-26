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

export const test = async (runner, app = 'all') => {
    if (
        !['all', 'main', 'intel', 'user-hub', 'scripts', 'relink', 'world'].includes(app)
    )
        throw new Error(`Unknown test app: ${app}`);
    if (app === 'all' || app === 'scripts')
        await runner.run('node', ['--test', './scripts/tasks.spec.mjs', './scripts/closure.spec.mjs', './scripts/package-pages.spec.mjs', './scripts/map-tiles.spec.mjs', './scripts/noclip.test.mjs']);
    if (app === 'all' || app === 'main' || app === 'relink') {
        await runner.run('pnpm', [
            'exec',
            'vitest',
            'run',
            ...(app === 'all'
                ? []
                : app === 'main'
                  ? ['--exclude', 'oem-relink/**']
                  : ['oem-relink']),
        ]);
    }
    if (app === 'all' || app === 'world') await runner.run('pnpm', ['exec', 'vitest', 'run', '--config', 'apps/world/vitest.config.ts']);
    if (app === 'all' || app === 'intel')
        await runner.run('pnpm', [
            'exec',
            'vitest',
            'run',
            '--config',
            'apps/intel/vitest.config.ts',
        ]);
    if (app === 'all' || app === 'user-hub')
        await runner.run('pnpm', [
            'exec',
            'vitest',
            'run',
            '--config',
            'apps/user-hub/vitest.config.ts',
        ]);
};

export const lint = async (runner, fix = false) => {
    await runner.run('node', ['./scripts/lint.mjs', ...(fix ? ['--fix'] : [])]);
};

export const check = async (runner, prepared = false) => {
    await dataTask(runner, 'check');
    if (!prepared) await prepareTypes(runner);

    const quality = async () => {
        await typeCheck(runner, 'all', false);
        await lint(runner);
    };
    if (runner.env.ATLOS_FORK_SHARED_RUNNER !== '1') {
        await quality();
        await test(runner);
        return;
    }

    const lanes = [
        ['TypeScript and lint', quality],
        ['Tests', () => test(runner)],
    ];
    const results = await Promise.allSettled(
        lanes.map(async ([name, run]) => {
            await run();
            console.log(`[check] ${name} passed`);
        }),
    );
    const failures = results.flatMap((result, index) =>
        result.status === 'rejected'
            ? [`${lanes[index][0]}: ${result.reason.message}`]
            : [],
    );
    if (failures.length)
        throw new Error(`Parallel checks failed:\n${failures.join('\n')}`);
};
