import path from 'path'; // Restart 12:45
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backendOrigin = (env.VITE_BACKEND_ORIGIN || 'http://localhost:8080').replace(/\/+$/, '');
  return {
    server: {
      port: 1000,
      host: '0.0.0.0',
      proxy: {
        '/api/public/support-tickets': {
          target: backendOrigin,
          changeOrigin: true,
          rewrite: () => '/api/v1/public/support/tickets',
        },
        '/api/public/demo-requests': {
          target: backendOrigin,
          changeOrigin: true,
          rewrite: () => '/api/v1/public/demo-requests',
        },
        '/api/v1/public/blogs': {
          target: backendOrigin,
          changeOrigin: true,
        },
      },
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
