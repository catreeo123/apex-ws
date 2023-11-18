import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['index.ts'],
    format: ['cjs', 'esm'],
    dts: {
        resolve: true,
        entry: ['index.ts'],
        compilerOptions: {
            moduleResolution: 'node',
        },
    },
    splitting: false,
    sourcemap: true,
    clean: true,
})
