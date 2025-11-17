if(!self.define){let e,s={};const c=(c,r)=>(c=new URL(c+".js",r).href,s[c]||new Promise(s=>{if("document"in self){const e=document.createElement("script");e.src=c,e.onload=s,document.head.appendChild(e)}else e=c,importScripts(c),s()}).then(()=>{let e=s[c];if(!e)throw new Error(`Module ${c} didn’t register its module`);return e}));self.define=(r,i)=>{const a=e||("document"in self?document.currentScript.src:"")||location.href;if(s[a])return;let l={};const n=e=>c(e,a),o={module:{uri:a},exports:l,require:n};s[a]=Promise.all(r.map(e=>o[e]||n(e))).then(e=>(i(...e),l))}}define(["./workbox-6484b88d"],function(e){"use strict";e.enable(),self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([{url:"css/pwa.css",revision:"ecf2bcab646dbac34b249048573d15b3"},{url:"dataset.js",revision:"c3e190d9f4e1113374e92a74540eb21c"},{url:"icons/icon-192-maskable.png",revision:"7e6b30884c5463e9870124a7915564f7"},{url:"icons/icon-192.png",revision:"5d413ae4d15e550dd85459a9e6c310c5"},{url:"icons/icon-192.svg",revision:"0680199348b245144b68703c91a66fa0"},{url:"icons/icon-512-maskable.png",revision:"6a518a6d11c408962c53498e2d41118b"},{url:"icons/icon-512.png",revision:"5d413ae4d15e550dd85459a9e6c310c5"},{url:"icons/icon-512.svg",revision:"0c3a1c2e8f074fb24d8c30094d974293"},{url:"index.html",revision:"1ce715fba9f72d25585f868cf14802ed"},{url:"main.js",revision:"296272edb617e85ad504e2eee13aa235"},{url:"placeholder_light_gray_block.png",revision:"90e25891b1960829b5c36f55dea81409"},{url:"print.css",revision:"bbe88b603c4a2788fab36a7af2874b13"},{url:"screenshots/home-1080x1920.png",revision:"16c93e0c3b5d145aef2f32fab0a45458"},{url:"screenshots/home-1920x1080.png",revision:"f704a233196f196ad5728258f56f814e"},{url:"src/features/export/lazy-libs.js",revision:"e73882a95fc8c7f420760cbe5be0b780"},{url:"src/features/pctcalc/pctcalc.css",revision:"1b869435fe22ec879b6f74dac6d240a6"},{url:"src/features/pctcalc/pctcalc.js",revision:"d5cde95910312ca798500a1bd329e2f8"},{url:"src/hooks/useAdmin.js",revision:"5a2c100c28be8ecf7ce8e8646ff1bb53"},{url:"src/lib/calc-core.js",revision:"1e5090e37b624bc90e0c57fe2b7f4ee2"},{url:"src/lib/e-komplet/export.js",revision:"824b4e6e3346fcf8dede8ccf466a9953"},{url:"src/lib/e-komplet/import.js",revision:"a935311b000e9b381e2c13bf65d56d4f"},{url:"src/lib/e-komplet/schema.js",revision:"e8a8a1b6c14b5c839c8968797303222f"},{url:"src/lib/e-komplet/storage.js",revision:"566404c7ded91db6c4a4428c8e58073d"},{url:"src/lib/e-komplet/validate.js",revision:"21c3a5b6329953b45c84742ab092ab39"},{url:"src/lib/materials/exclusions.js",revision:"96aa23eaa029268903692b54670a6703"},{url:"src/lib/sha256.js",revision:"b99130bd95cae0da4fd021ed13ce3e68"},{url:"src/lib/string-utils.js",revision:"2306185d8c0d2818cfbab7ef059bf565"},{url:"src/lib/timeRows.js",revision:"8a41d2233d5bc7b0a56bb39f9a96c316"},{url:"src/materials/v2/index.js",revision:"f968fc9278585c8f047a3e4333dc6527"},{url:"src/materials/v2/renderer.js",revision:"9a8083ee13fd1ab52da4c91804f347a4"},{url:"src/materials/v2/styles.css",revision:"562d292945cbca6331316b582d0782ea"},{url:"src/modules/calculateTotals.js",revision:"6b7b9d0f4a9c44d22980576eca6ec29b"},{url:"src/modules/materialRowTemplate.js",revision:"bb28ebb37b7ddd38b3723c27acb53649"},{url:"src/modules/materialsScrollLock.js",revision:"54cc29bba9d30c4c984ea2e66594c435"},{url:"src/modules/materialsVirtualList.js",revision:"83828e7a9c797825789ebe47962a46cb"},{url:"src/modules/numpadOverlay.js",revision:"cc7db74e4939ced1a6ab1eb5cdfe4b07"},{url:"src/pages/demo.css",revision:"55cf7dabefbdbda7a2c1adcf57c2002f"},{url:"src/pages/demo.html",revision:"1e6f6125c7a7f80d13ea5fdb2fbf26c5"},{url:"src/pages/demo.js",revision:"18bc1889356379fed027aba786096440"},{url:"src/state/admin.js",revision:"3aad8fc8933058fbe2ef0761de58f80a"},{url:"src/styles/fixes.css",revision:"e5409274a57c9addaaa528667e27efad"},{url:"src/ui/diagnostics.js",revision:"aeff04015d319f26d3df01690e313e59"},{url:"src/ui/e-komplet-panel.js",revision:"3f6ae043ee9aa2f7a71ae60b73434a11"},{url:"src/ui/Guards/ClickGuard.js",revision:"a22da3e8738d3cd68b106bfb4623eca7"},{url:"src/ui/numpad.css",revision:"f516a83e9472d886183997f5e3fa6180"},{url:"src/ui/numpad.init.js",revision:"6041ed2245f52d59509aee450e733c1c"},{url:"src/ui/numpad.js",revision:"b714302914790cfbc030090b581175c4"},{url:"src/ui/numpad.lazy.js",revision:"99c3d3df22c238120a128f14ab1b1428"},{url:"src/utils/devlog.js",revision:"1b89e24d23e0f8c2d82905c008ab7877"},{url:"style.css",revision:"b6eda20666618e8f5db3ea5dfb638b08"},{url:"/",revision:"null"},{url:"/?source=pwa",revision:"null"}],{}),e.registerRoute(({request:e})=>"navigate"===e.mode,new e.NetworkFirst({cacheName:"html",plugins:[new e.ExpirationPlugin({maxEntries:50,maxAgeSeconds:604800})]}),"GET"),e.registerRoute(({request:e})=>["script","style"].includes(e.destination),new e.StaleWhileRevalidate({cacheName:"assets",plugins:[]}),"GET"),e.registerRoute(({request:e})=>"image"===e.destination,new e.StaleWhileRevalidate({cacheName:"images",plugins:[new e.ExpirationPlugin({maxEntries:150,maxAgeSeconds:2592e3})]}),"GET"),e.registerRoute(({request:e})=>"font"===e.destination,new e.CacheFirst({cacheName:"fonts",plugins:[new e.ExpirationPlugin({maxEntries:30,maxAgeSeconds:31536e3})]}),"GET")});
//# sourceMappingURL=service-worker.js.map

const SW_VERSION = "V-20251117T135803Z";
const RUNTIME_CACHE_PREFIX = 'sscaff-runtime-'

function getRuntimeCacheName () {
  return `${RUNTIME_CACHE_PREFIX}${SW_VERSION}`
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      if (typeof self.skipWaiting === 'function') {
        await self.skipWaiting()
      }

      const workboxCore = self?.workbox?.core
      const cacheNames = workboxCore?.cacheNames
      const precacheName = cacheNames?.precache

      if (precacheName) {
        const precache = await caches.open(precacheName)
        await precache.addAll(['/', '/?source=pwa'])
      }

      await caches.open(getRuntimeCacheName())
    } catch (error) {
      console.warn('SW install fejl (delvist)', error)
    }
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const expectedRuntimeCache = getRuntimeCacheName()
      const cacheKeys = await caches.keys()

      await Promise.all(
        cacheKeys.map((key) => {
          if (key.startsWith(RUNTIME_CACHE_PREFIX) && key !== expectedRuntimeCache) {
            return caches.delete(key)
          }
          return undefined
        })
      )
    } catch (error) {
      console.warn('SW activate cleanup fejlede', error)
    }

    try {
      if (self.clients && typeof self.clients.claim === 'function') {
        await self.clients.claim()
      }
    } catch (claimError) {
      console.warn('SW clients.claim fejlede', claimError)
    }
  })())
})
