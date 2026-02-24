import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	ssr: {
		// Process workspace packages through Vite (raw .ts source, no pre-build)
		noExternal: ['termlings']
	}
});
