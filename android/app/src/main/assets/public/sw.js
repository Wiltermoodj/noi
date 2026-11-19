/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-afac4cd2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "southern-vietnam-icon-96.png",
    "revision": "9fcdb07d1ab67fa3800a5c8424f0241e"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "e971daa6dc6dda1ce61bfc060c0911e7"
  }, {
    "url": "pwa-512x512.png",
    "revision": "6f9f8e579b904a644cc13cd0415836af"
  }, {
    "url": "pwa-192x192.png",
    "revision": "520cdd1b8cb692481772c1e275b2df35"
  }, {
    "url": "privacy.html",
    "revision": "40698ba9f5be915f4b46c773cbcae887"
  }, {
    "url": "northern-vietnam-icon-96.png",
    "revision": "aa70b1239f62ecab03f97daf6a841ba3"
  }, {
    "url": "index.html",
    "revision": "78572e4a52281ce4afa73f6d5a7a699a"
  }, {
    "url": "icon.svg",
    "revision": "a18de40cb00ba672718ed6f8e0d5cb17"
  }, {
    "url": "central-vietnam-icon-96.png",
    "revision": "8a127c89ca95149f720c631f00f57b20"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "03bf426881759043aa706d8b157f7bbe"
  }, {
    "url": "assets/workbox-window.prod.es5-Bd17z0YL.js",
    "revision": null
  }, {
    "url": "assets/web-aVJ0cWYX.js",
    "revision": null
  }, {
    "url": "assets/web-BoV-XA69.js",
    "revision": null
  }, {
    "url": "assets/useSpeakingStatus-Ep1-qfbu.js",
    "revision": null
  }, {
    "url": "assets/index-V7jhTcWN.css",
    "revision": null
  }, {
    "url": "assets/index-ChSKtxjh.js",
    "revision": null
  }, {
    "url": "assets/dist-BD91r3g6.js",
    "revision": null
  }, {
    "url": "assets/copy-BTTTcTZK.js",
    "revision": null
  }, {
    "url": "assets/audioTimeStretch.worker-ByxVHhXv.js",
    "revision": null
  }, {
    "url": "assets/TranslateView-D0pi55rx.js",
    "revision": null
  }, {
    "url": "assets/ShowBigModal-CURURE_r.js",
    "revision": null
  }, {
    "url": "assets/SettingsModal-C4fobFeO.js",
    "revision": null
  }, {
    "url": "assets/SearchBar-YLOcigte.js",
    "revision": null
  }, {
    "url": "assets/PhrasesView-BnCDC3wM.js",
    "revision": null
  }, {
    "url": "assets/PhrasebookView-D1ngNiW0.js",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "03bf426881759043aa706d8b157f7bbe"
  }, {
    "url": "central-vietnam-icon-96.png",
    "revision": "8a127c89ca95149f720c631f00f57b20"
  }, {
    "url": "icon.svg",
    "revision": "a18de40cb00ba672718ed6f8e0d5cb17"
  }, {
    "url": "northern-vietnam-icon-96.png",
    "revision": "aa70b1239f62ecab03f97daf6a841ba3"
  }, {
    "url": "privacy.html",
    "revision": "40698ba9f5be915f4b46c773cbcae887"
  }, {
    "url": "pwa-192x192.png",
    "revision": "520cdd1b8cb692481772c1e275b2df35"
  }, {
    "url": "pwa-512x512.png",
    "revision": "6f9f8e579b904a644cc13cd0415836af"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "e971daa6dc6dda1ce61bfc060c0911e7"
  }, {
    "url": "southern-vietnam-icon-96.png",
    "revision": "9fcdb07d1ab67fa3800a5c8424f0241e"
  }, {
    "url": "manifest.webmanifest",
    "revision": "692c8ddad84a24ed1d0a44d1edbc8651"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//, /^\/privacy/, /^\/healthz$/, /^\/\.well-known\//]
  }));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
