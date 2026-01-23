export function isProd() {
  const context = String(process.env.CONTEXT || process.env.NETLIFY_CONTEXT || '').toLowerCase();
  return context === 'production';
}
