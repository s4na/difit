import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const run = (command, args, options = {}) => {
  execFileSync(command, args, { stdio: 'inherit', ...options });
};

const command = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);

if (existsSync(join(process.cwd(), '.git'))) {
  try {
    run(command('lefthook'), ['install']);
  } catch {
    // Hook installation should not block package preparation.
  }
}

run(command('npm'), ['run', 'build']);
