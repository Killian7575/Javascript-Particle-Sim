import { execSync } from 'child_process';
import react from '@vitejs/plugin-react';

const hash  = execSync('git rev-parse --short HEAD').toString().trim();
const dirty = execSync('git status --porcelain').toString().trim().length > 0;
const git   = hash + (dirty ? '-dirty' : '');

export default {
  plugins: [react()],
  define: {
    __GIT_HASH__: JSON.stringify(git)
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
}
