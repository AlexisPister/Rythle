import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter(),
			// GitHub Pages serves the site under /<repo-name>; set by the deploy workflow.
			paths: { base: process.env.BASE_PATH ?? '' }
		})
	]
});
