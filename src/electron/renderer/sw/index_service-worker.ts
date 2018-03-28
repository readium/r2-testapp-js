// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

// import { startNavigatorExperiment } from "../index_navigator";

export function startServiceWorkerExperiment(publicationJsonUrl: string) {

    const webview2 = document.createElement("webview") as HTMLElement;
    webview2.setAttribute("id", "webview2");
    webview2.setAttribute("webpreferences",
        "nodeIntegration=0, nodeIntegrationInWorker=0, sandbox=0, " +
        "contextIsolation=0, webSecurity=1, allowRunningInsecureContent=0");
    webview2.setAttribute("preload", "./sw/preload_service-worker.js");
    const readerChrome = document.getElementById("reader_chrome");
    if (readerChrome) {
        readerChrome.appendChild(webview2 as Node);
    }
    // webview2.addEventListener('did-start-loading', () => {
    // });
    // webview2.addEventListener('did-stop-loading', () => {
    // });
    // webview2.addEventListener('did-finish-load', () => {
    // });
    webview2.addEventListener("dom-ready", () => {

        (webview2 as any).openDevTools();
        // const wc = webview2.getWebContents();

        setTimeout(async () => {
            // startNavigatorExperiment(publicationJsonUrl);
        }, 2000);
    });
    // const swBootUrl = publicationJsonUrl + "/show/metadata";
    // const swBootUrl = publicationJsonUrl;
    const swBootUrl = publicationJsonUrl + "/../";
    console.log(swBootUrl);
    webview2.setAttribute("src", swBootUrl);
}
