import { execSync } from 'child_process';
const hash  = execSync('git rev-parse --short HEAD').toString().trim();
const dirty = execSync('git status --porcelain').toString().trim().length > 0;
const git   = hash + (dirty ? '-dirty' : '');

export default {
  define: {
    __GIT_HASH__: JSON.stringify(git)
  }
}