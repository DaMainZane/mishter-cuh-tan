import { configDefaults, defineConfig } from 'vitest/config';

// `retired/` holds `[del.]` files kept for reference (CLAUDE.md: removable files are renamed, not deleted). They are not run.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'retired/**']
  }
});
