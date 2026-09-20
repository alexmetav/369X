# 369X frontend

Static single-page app. No build step.

## Deploy to Vercel
Option A (browser): vercel.com/new -> "Deploy" a new project -> drag this folder in.
Option B (CLI):
    npm i -g vercel
    vercel          # preview deploy
    vercel --prod   # production

## Connect the backend
Open index.html, find `const CONFIG`, set USE_MOCK: false and API_BASE to your server.
All endpoints are listed in the comment above CONFIG.
