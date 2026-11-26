import { dataTask, lint, test, typeCheck } from './checks.mjs';
import { createRunner, runCli } from './task-runner.mjs';

await runCli(async (signal) => {
    const group = process.argv[2];
    if (group !== 'quality' && group !== 'tests')
        throw new Error('Choose quality or tests for the fork CI experiment.');

    const runner = createRunner({
        env: { ...process.env, ATLOS_SOURCE_ONLY: '1' },
        signal,
    });
    await dataTask(runner, 'prepare');

    if (group === 'tests') {
        await test(runner);
        return;
    }

    await dataTask(runner, 'check');
    await typeCheck(runner, 'all', false);
    await lint(runner);
});
