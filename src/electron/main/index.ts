// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

// https://github.com/electron/electron/blob/master/docs/api/sandbox-option.md
// https://github.com/electron/electron/blob/master/docs/api/process.md
// https://github.com/electron/electron/blob/master/docs/api/browser-window.md
// https://github.com/electron/electron/blob/master/docs/api/protocol.md
// https://github.com/electron/electron/blob/master/docs/api/web-frame.md
// https://github.com/electron/electron/blob/master/docs/api/web-contents.md
// https://github.com/electron/electron/blob/master/docs/api/web-request.md
// https://github.com/electron/electron/blob/master/docs/api/session.md
// https://github.com/electron/electron/blob/master/docs/api/webview-tag.md
// https://github.com/electron/electron/blob/master/docs/api/browser-view.md
// https://github.com/electron/electron/blob/master/docs/api/client-request.md
// https://github.com/electron/electron/blob/master/docs/api/sandbox-option.md
// https://github.com/electron/electron/blob/master/docs/api/dialog.md
// https://github.com/electron/electron/blob/master/docs/api/ipc-renderer.md

import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { URL } from "url";

import { launchStatusDocumentProcessing } from "@r2-lcp-js/lsd/status-document-processing";
import { setLcpNativePluginPath } from "@r2-lcp-js/parser/epub/lcp";
import { LCP } from "@r2-lcp-js/parser/epub/lcp";
import { downloadEPUBFromLCPL } from "@r2-lcp-js/publication-download";
import { IEventPayload_R2_EVENT_READIUMCSS } from "@r2-navigator-js/electron/common/events";
import {
    IReadiumCSS,
    readiumCSSDefaults,
} from "@r2-navigator-js/electron/common/readium-css-settings";
import { convertHttpUrlToCustomScheme } from "@r2-navigator-js/electron/common/sessions";
import { trackBrowserWindow } from "@r2-navigator-js/electron/main/browser-window-tracker";
import { lsdLcpUpdateInject } from "@r2-navigator-js/electron/main/lsd-injectlcpl";
import { setupReadiumCSS } from "@r2-navigator-js/electron/main/readium-css";
import { initSessions, secureSessions } from "@r2-navigator-js/electron/main/sessions";
import {
    initGlobalConverters_OPDS,
} from "@r2-opds-js/opds/init-globals";
import {
    initGlobalConverters_GENERIC,
    initGlobalConverters_SHARED,
} from "@r2-shared-js/init-globals";
import { Publication } from "@r2-shared-js/models/publication";
import { Link } from "@r2-shared-js/models/publication-link";
import { isEPUBlication } from "@r2-shared-js/parser/epub";
import { Server } from "@r2-streamer-js/http/server";
import { isHTTP } from "@r2-utils-js/_utils/http/UrlUtils";
import { encodeURIComponent_RFC3986 } from "@r2-utils-js/_utils/http/UrlUtils";
import { streamToBufferPromise } from "@r2-utils-js/_utils/stream/BufferUtils";
import { ZipExploded } from "@r2-utils-js/_utils/zip/zip-ex";
import { ZipExplodedHTTP } from "@r2-utils-js/_utils/zip/zip-ex-http";
import * as debug_ from "debug";
import { BrowserWindow, Menu, MenuItemConstructorOptions, app, dialog, ipcMain, shell, webContents } from "electron";
import * as express from "express";
import * as portfinder from "portfinder";
import * as request from "request";
import * as requestPromise from "request-promise-native";
import { JSON as TAJSON } from "ta-json-x";
import * as uuid from "uuid";

import {
    IEventPayload_R2_EVENT_OPEN_URL_OR_PATH,
    R2_EVENT_DEVTOOLS,
    R2_EVENT_OPEN_URL_OR_PATH,
} from "../common/events";
import { IStore } from "../common/store";
import { StoreElectron } from "../common/store-electron";
import { installLcpHandler } from "./lcp";
import { installLsdHandler } from "./lsd";
import { getDeviceIDManager } from "./lsd-deviceid-manager";

// import * as filehound from "filehound";

const SECURE = true;

const electronStoreLSD: IStore = new StoreElectron("readium2-testapp-lsd", {});
const deviceIDManager = getDeviceIDManager(electronStoreLSD, "Readium2 Electron desktop app");

ipcMain.on("R2_EVENT_LCP_LSD_OPEN_SETTINGS", (_event: any, _arg: any) => {
    if ((electronStoreLSD as any).reveal) {
        (electronStoreLSD as any).reveal();
    }
});

// import * as mime from "mime-types";

initGlobalConverters_OPDS();
initGlobalConverters_SHARED();
initGlobalConverters_GENERIC();

const IS_DEV = (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dev");

const lcpPluginPath = IS_DEV ?
    path.join(process.cwd(), "LCP", "lcp.node") :
    path.join(__dirname, "lcp.node");
setLcpNativePluginPath(lcpPluginPath);

const debug = debug_("r2:testapp#electron/main/index");

let _publicationsServer: Server;
let _publicationsServerPort: number;
let _publicationsRootUrl: string;
let _publicationsFilePaths: string[];
let _publicationsUrls: string[];

// let DEFAULT_BOOK_PATH = path.join(IS_DEV ? process.cwd() : __dirname, "misc", "epubs");
// debug(DEFAULT_BOOK_PATH);
// if (fs.existsSync(DEFAULT_BOOK_PATH)) {
//     debug("DEFAULT_BOOK_PATH => exists");
//     DEFAULT_BOOK_PATH = fs.realpathSync(path.resolve(DEFAULT_BOOK_PATH));
//     debug(DEFAULT_BOOK_PATH);
// } else {
//     debug("DEFAULT_BOOK_PATH => missing");
//     DEFAULT_BOOK_PATH = ".";
// }

let _lastBookPath: string | undefined;

// protocol.registerStandardSchemes(["epub", "file"], { secure: true });

function openAllDevTools() {
    for (const wc of webContents.getAllWebContents()) {
        // if (wc.hostWebContents &&
        //     wc.hostWebContents.id === electronBrowserWindow.webContents.id) {
        // }
        // https://github.com/electron/electron/blob/v3.0.0/docs/api/breaking-changes.md#webcontents
        wc.openDevTools({ mode: "detach" });
    }
}

// https://github.com/electron/electron/blob/v3.0.0/docs/api/breaking-changes.md#webcontents
function openTopLevelDevTools() {
    const bw = BrowserWindow.getFocusedWindow();
    if (bw) {
        bw.webContents.openDevTools({ mode: "detach" });
    } else {
        const arr = BrowserWindow.getAllWindows();
        arr.forEach((bww) => {
            bww.webContents.openDevTools({ mode: "detach" });
        });
    }
}

ipcMain.on(R2_EVENT_DEVTOOLS, (_event: any, _arg: any) => {
    openAllDevTools();
});

async function isManifestJSON(urlOrPath: string): Promise<boolean> {
    let p = urlOrPath;
    if (isHTTP(urlOrPath)) {
        const url = new URL(urlOrPath);
        p = url.pathname;

        const promise = new Promise<boolean>((resolve, reject) => {

            const isHTTPS = urlOrPath.startsWith("https://");
            const options = {
                host: url.host,
                method: "HEAD",
                path: urlOrPath.substr(urlOrPath.indexOf(url.pathname)),
                // port: (isHTTPS ? 443 : 80),
                // protocol: (isHTTPS ? "https:" : "http:"),
                // timeout: 1000,
            };
            debug(options);
            (isHTTPS ? https : http).request(options, (response) => {
                // let str: string | undefined;
                // let buffs: Buffer[] | undefined;

                debug(response.statusCode);

                if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
                    reject("STATUS: " + response.statusCode);
                    return;
                }
                debug(response.headers);
                debug(response.headers["content-type"]);

                const okay = response.headers["content-type"] &&
                    (response.headers["content-type"].indexOf("application/webpub+json") >= 0 ||
                        response.headers["content-type"].indexOf("application/audiobook+json") >= 0);
                resolve(okay as boolean);

                // response.on("data", (chunk) => {
                //     debug("data");
                //     if (typeof chunk === "string") {
                //         if (!str) {
                //             str = "";
                //         }
                //         str += chunk;
                //     } else {
                //         if (!buffs) {
                //             buffs = [];
                //         }
                //         buffs.push(chunk);
                //     }
                // });

                // response.on("end", async () => {
                //     debug("end");
                // });
            }).on("error", (err) => {
                reject(err);
            }).end();
        });

        let ok: boolean | undefined;
        try {
            ok = await promise;
            debug("########### IS MANIFEST (HTTP): " + ok);
            return ok; // or we could fallback to below manifest.json test?
        } catch (err) {
            debug(err); // fallback below ...
        }
    }

    // const fileName = path.basename(p);
    const isMan = /.*manifest\.json[\?]?.*/.test(p); // TODO: hacky!
    debug("########### IS MANIFEST: " + isMan);
    return isMan;
}

async function createElectronBrowserWindow(publicationFilePath: string, publicationUrl: string) {

    debug("createElectronBrowserWindow() " + publicationFilePath + " : " + publicationUrl);

    let lcpHint: string | undefined;
    let publication: Publication | undefined;

    const isWebPub = await isManifestJSON(publicationFilePath);
    const isHttpWebPub = isWebPub && isHTTP(publicationFilePath);
    let isHttpWebPubWithoutLCP = isHttpWebPub;
    if (isWebPub) {
        // if (!isHTTP(publicationFilePath)) {
        //     debug("**** isManifestJSON && !isHTTP");
        //     const manifestJsonDir = path.dirname(publicationFilePath);
        //     debug(manifestJsonDir);
        //     const publicationFilePathBase64 =
        //         encodeURIComponent_RFC3986(Buffer.from(publicationFilePath).toString("base64"));
        //     const routePath = "/xpub/" + publicationFilePathBase64;
        //     debug(routePath);
        //     // https://expressjs.com/en/4x/api.html#express.static
        //     const staticOptions = {
        //         dotfiles: "ignore",
        //         etag: false,
        //         fallthrough: false,
        //         immutable: true,
        //         index: false,
        //         maxAge: "1d",
        //         redirect: false,
        //         // extensions: ["css", "otf"],
        //         // setHeaders: function (res, path, stat) {
        //         //   res.set('x-timestamp', Date.now())
        //         // }
        //     };
        //     _publicationsServer.expressUse(routePath,
        //         express.static(manifestJsonDir, staticOptions));
        //     publicationUrl = `${_publicationsServer.serverUrl()}${routePath}/manifest.json`;
        //     debug(publicationUrl);
        // }

        const failure = async (err: any) => {
            debug(err);
        };

        const handleLCP = (responseStr: string, pub: Publication) => {
            const responseJson = global.JSON.parse(responseStr);
            debug(responseJson);

            let lcpl: LCP | undefined;
            lcpl = TAJSON.deserialize<LCP>(responseJson, LCP);
            lcpl.ZipPath = "META-INF/license.lcpl";
            lcpl.JsonSource = responseStr;
            lcpl.init();

            // breakLength: 100  maxArrayLength: undefined
            // console.log(util.inspect(lcpl,
            //     { showHidden: false, depth: 1000, colors: true, customInspect: true }));

            pub.LCP = lcpl;
            // publicationUrl = publicationUrl.replace("/pub/",
            //     "/pub/" + _publicationsServer.lcpBeginToken +
            //     "URL_LCP_PASS_PLACEHOLDER" + _publicationsServer.lcpEndToken);
            // debug(publicationUrl);
        };

        const successLCP = async (response: request.RequestResponse, pub: Publication) => {

            // Object.keys(response.headers).forEach((header: string) => {
            //     debug(header + " => " + response.headers[header]);
            // });

            // debug(response);
            // debug(response.body);

            if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
                await failure("HTTP CODE " + response.statusCode);
                return;
            }

            let responseStr: string;
            if (response.body) {
                debug("RES BODY");
                responseStr = response.body;
            } else {
                debug("RES STREAM");
                let responseData: Buffer;
                try {
                    responseData = await streamToBufferPromise(response);
                } catch (err) {
                    debug(err);
                    return;
                }
                responseStr = responseData.toString("utf8");
            }

            handleLCP(responseStr, pub);
        };

        // No response streaming! :(
        // https://github.com/request/request-promise/issues/90
        const needsStreamingResponse = true;

        const handleManifestJson = async (responseStr: string) => {
            const manifestJson = global.JSON.parse(responseStr);
            debug(manifestJson);

            // hacky! assumes obfuscated fonts are transformed on the server side
            // (yet crypto info is present in manifest).
            // Note that local manifest.json generated with the r2-shared-js CLI does not contain crypto info
            // when resources are actually produced in plain text.
            if (isHTTP(publicationFilePath)) {

                const arrLinks = [];
                if (manifestJson.readingOrder) {
                    arrLinks.push(...manifestJson.readingOrder);
                }
                if (manifestJson.resources) {
                    arrLinks.push(...manifestJson.resources);
                }

                arrLinks.forEach((link: any) => {
                    if (link.properties && link.properties.encrypted &&
                        (link.properties.encrypted.algorithm === "http://www.idpf.org/2008/embedding" ||
                            link.properties.encrypted.algorithm === "http://ns.adobe.com/pdf/enc#RC")) {
                        delete link.properties.encrypted;

                        let atLeastOne = false;
                        const jsonProps = Object.keys(link.properties);
                        if (jsonProps) {
                            jsonProps.forEach((jsonProp) => {
                                if (link.properties.hasOwnProperty(jsonProp)) {
                                    atLeastOne = true;
                                    return false;
                                }
                                return true;
                            });
                        }
                        if (!atLeastOne) {
                            delete link.properties;
                        }
                    }
                });
            }

            try {
                publication = TAJSON.deserialize<Publication>(manifestJson, Publication);
            } catch (erorz) {
                debug(erorz);
                return;
            }
            debug(publication);

            const licenseLink = publication.Links ? publication.Links.find((link) => {
                return link.Rel.indexOf("license") >= 0 &&
                    link.TypeLink === "application/vnd.readium.lcp.license.v1.0+json";
            }) : undefined;
            isHttpWebPubWithoutLCP = isHttpWebPub && !licenseLink;

            let p = publicationFilePath;
            if (isHTTP(publicationFilePath)) {
                const url = new URL(publicationFilePath);
                p = url.pathname;
            }
            publication.AddToInternal("filename", path.basename(p));
            publication.AddToInternal("type", "epub");

            if (!isHttpWebPubWithoutLCP) {
                if (!isHTTP(publicationFilePath)) {
                    const dirPath = path.dirname(publicationFilePath);
                    const zip = await ZipExploded.loadPromise(dirPath);
                    publication.AddToInternal("zip", zip);
                } else {
                    const url = new URL(publicationFilePath);
                    const dirPath = path.dirname(p);
                    url.pathname = dirPath + "/";
                    const zip = await ZipExplodedHTTP.loadPromise(url.toString());
                    publication.AddToInternal("zip", zip);
                }
            }

            const pathDecoded = publicationFilePath;
            // const pathBase64 =
            //      decodeURIComponent(publicationFilePath.replace(/.*\/pub\/(.*)\/manifest.json/, "$1"));
            // debug(pathBase64);
            // const pathDecoded = new Buffer(pathBase64, "base64").toString("utf8");
            // debug(pathDecoded);
            // // const pathFileName = pathDecoded.substr(
            // //     pathDecoded.replace(/\\/g, "/").lastIndexOf("/") + 1,
            // //     pathDecoded.length - 1);
            // // debug(pathFileName);

            debug("ADDED HTTP pub to server cache: " + pathDecoded + " --- " + publicationFilePath);
            const publicationUrls = _publicationsServer.addPublications([pathDecoded]);
            _publicationsServer.cachePublication(pathDecoded, publication);
            const pubCheck = _publicationsServer.cachedPublication(pathDecoded);
            if (!pubCheck) {
                debug("PUB CHECK FAIL?");
            }

            if (!isHttpWebPubWithoutLCP) {
                // const publicationFilePathBase64 =
                //     encodeURIComponent_RFC3986(Buffer.from(pathDecoded).toString("base64"));
                // publicationUrl = `${_publicationsServer.serverUrl()}/pub/${publicationFilePathBase64}/manifest.json`;
                publicationUrl = `${_publicationsServer.serverUrl()}${publicationUrls[0]}`;
            }
            debug(publicationUrl);

            if (licenseLink && licenseLink.Href) {
                let lcplHref = licenseLink.Href;
                if (!isHTTP(lcplHref)) {
                    if (isHTTP(publicationFilePath)) {
                        lcplHref = new URL(lcplHref, publicationFilePath).toString();
                    } else {
                        lcplHref = publicationFilePath.replace("manifest.json", licenseLink.Href); // hacky!!
                    }
                }
                debug(lcplHref);

                if (isHTTP(lcplHref)) {
                    // No response streaming! :(
                    // https://github.com/request/request-promise/issues/90
                    // const needsStreamingResponse = true;
                    if (needsStreamingResponse) {
                        const promise = new Promise((resolve, reject) => {
                            request.get({
                                headers: {},
                                method: "GET",
                                uri: lcplHref,
                            })
                                .on("response", async (responsez: request.RequestResponse) => {
                                    await successLCP(responsez, publication as Publication);
                                    resolve();
                                })
                                .on("error", async (err: any) => {
                                    await failure(err);
                                    reject();
                                });
                        });
                        try {
                            await promise;
                        } catch (err) {
                            return;
                        }
                    } else {
                        let responsez: requestPromise.FullResponse;
                        try {
                            // tslint:disable-next-line:await-promise no-floating-promises
                            responsez = await requestPromise({
                                headers: {},
                                method: "GET",
                                resolveWithFullResponse: true,
                                uri: lcplHref,
                            });
                        } catch (err) {
                            await failure(err);
                            return;
                        }
                        await successLCP(responsez, publication);
                    }
                } else {
                    const responsezStr = fs.readFileSync(lcplHref, { encoding: "utf8" });
                    if (!responsezStr) {
                        await failure("Cannot read local file: " + lcplHref);
                        return;
                    }
                    handleLCP(responsezStr, publication);
                }
            }
        };

        if (isHTTP(publicationFilePath)) {
            const success = async (response: request.RequestResponse) => {

                // Object.keys(response.headers).forEach((header: string) => {
                //     debug(header + " => " + response.headers[header]);
                // });

                // debug(response);
                // debug(response.body);

                if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
                    await failure("HTTP CODE " + response.statusCode);
                    return;
                }

                let responseStr: string;
                if (response.body) {
                    debug("RES BODY");
                    responseStr = response.body;
                } else {
                    debug("RES STREAM");
                    let responseData: Buffer;
                    try {
                        responseData = await streamToBufferPromise(response);
                    } catch (err) {
                        debug(err);
                        return;
                    }
                    responseStr = responseData.toString("utf8");
                }
                await handleManifestJson(responseStr);
            };

            if (needsStreamingResponse) {
                const promise = new Promise((resolve, reject) => {
                    request.get({
                        headers: {},
                        method: "GET",
                        uri: publicationFilePath,
                    })
                        .on("response", async (response: request.RequestResponse) => {
                            await success(response);
                            resolve();
                        })
                        .on("error", async (err: any) => {
                            await failure(err);
                            reject();
                        });
                });
                try {
                    await promise;
                } catch (err) {
                    return;
                }
            } else {
                let response: requestPromise.FullResponse;
                try {
                    // tslint:disable-next-line:await-promise no-floating-promises
                    response = await requestPromise({
                        headers: {},
                        method: "GET",
                        resolveWithFullResponse: true,
                        uri: publicationFilePath,
                    });
                } catch (err) {
                    await failure(err);
                    return;
                }
                await success(response);
            }
        } else {
            const responseStr = fs.readFileSync(publicationFilePath, { encoding: "utf8" });
            if (!responseStr) {
                await failure("Cannot read local file: " + publicationFilePath);
                return;
            }
            await handleManifestJson(responseStr);
        }
    } else if (isEPUBlication(publicationFilePath)) {

        // const fileName = path.basename(publicationFilePath);
        // const ext = path.extname(fileName).toLowerCase();

        try {
            publication = await _publicationsServer.loadOrGetCachedPublication(publicationFilePath);
        } catch (err) {
            debug(err);
            return;
        }
    }

    if (publication && publication.LCP) {
        debug(publication.LCP);

        try {
            await launchStatusDocumentProcessing(publication.LCP, deviceIDManager,
                async (licenseUpdateJson: string | undefined) => {
                    debug("launchStatusDocumentProcessing DONE.");

                    if (licenseUpdateJson) {
                        let res: string;
                        try {
                            res = await lsdLcpUpdateInject(
                                licenseUpdateJson,
                                publication as Publication,
                                publicationFilePath);
                            debug("EPUB SAVED: " + res);
                        } catch (err) {
                            debug(err);
                        }
                    }
                });
        } catch (err) {
            debug(err);
        }

        if (publication.LCP.Encryption &&
            publication.LCP.Encryption.UserKey &&
            publication.LCP.Encryption.UserKey.TextHint) {
            lcpHint = publication.LCP.Encryption.UserKey.TextHint;
        }
        if (!lcpHint) {
            lcpHint = "LCP passphrase";
        }
    }

    // https://github.com/electron/electron/blob/v4.0.0/docs/api/breaking-changes.md#new-browserwindow-webpreferences-
    const electronBrowserWindow = new BrowserWindow({
        height: 600,
        webPreferences: {
            allowRunningInsecureContent: false,
            contextIsolation: false,
            devTools: true,
            nodeIntegration: true,
            nodeIntegrationInWorker: false,
            sandbox: false,
            webSecurity: true,
            webviewTag: true,
            // preload: __dirname + "/" + "preload.js",
        },
        width: 800,
    });
    trackBrowserWindow(electronBrowserWindow); // , _publicationsServer.serverUrl() as string

    // https://github.com/electron/electron/blob/v3.0.0/docs/api/breaking-changes.md#webcontents
    // https://github.com/electron/electron/blob/v3.0.0/docs/api/breaking-changes.md#webview
    // electronBrowserWindow.on("resize", () => {
    //     const [width, height] = electronBrowserWindow.getContentSize();

    //     for (const wc of webContents.getAllWebContents()) {
    //         if (wc.hostWebContents &&
    //             wc.hostWebContents.id === electronBrowserWindow.webContents.id) {
    //             wc.setSize({
    //                 normal: {
    //                     height: 400,
    //                     width,
    //                 },
    //             });
    //         }
    //     }
    // });

    electronBrowserWindow.webContents.on("dom-ready", () => {
        debug("electronBrowserWindow dom-ready " + publicationFilePath + " : " + publicationUrl);
        // https://github.com/electron/electron/blob/v3.0.0/docs/api/breaking-changes.md#webcontents
        // electronBrowserWindow.webContents.openDevTools({ mode: "detach" });
    });

    if (!isHttpWebPubWithoutLCP && SECURE && isHTTP(publicationUrl)) { // && !await isManifestJSON(publicationFilePath)
        // This triggers the origin-sandbox for localStorage, etc.
        publicationUrl = convertHttpUrlToCustomScheme(publicationUrl);
    }

    const urlEncoded = encodeURIComponent_RFC3986(publicationUrl);
    let htmlPath = IS_DEV ? `${__dirname}/../renderer/index.html` : `${__dirname}/index.html`;
    htmlPath = htmlPath.replace(/\\/g, "/");
    let fullUrl = `file://${htmlPath}?pub=${urlEncoded}`;
    if (lcpHint) {
        fullUrl = fullUrl + "&lcpHint=" + encodeURIComponent_RFC3986(lcpHint);
    }
    // fullUrl = fullUrl + "&lcpPlugin=" + encodeURIComponent_RFC3986(Buffer.from(lcpPluginPath).toString("base64"));

    const urlRoot = _publicationsServer.serverUrl() as string;
    fullUrl = fullUrl + "&pubServerRoot=" + encodeURIComponent_RFC3986(urlRoot);
    if (isHttpWebPubWithoutLCP) {
        fullUrl = fullUrl + "&isHttpWebPubWithoutLCP=1";
    }

    // `file://${process.cwd()}/src/electron/renderer/index.html`;
    // `file://${__dirname}/../../../../src/electron/renderer/index.html`
    debug(fullUrl);
    electronBrowserWindow.webContents.loadURL(fullUrl, { extraHeaders: "pragma: no-cache\n" });
}

initSessions();

const readiumCssDefaultsJson: IReadiumCSS = Object.assign({}, readiumCSSDefaults);
const readiumCssKeys = Object.keys(readiumCSSDefaults);
// console.log(readiumCssKeys);
readiumCssKeys.forEach((key: string) => {
    const value = (readiumCSSDefaults as any)[key];
    // console.log(key, " => ", value);
    if (typeof value === "undefined") {
        (readiumCssDefaultsJson as any)[key] = null;
    } else {
        (readiumCssDefaultsJson as any)[key] = value;
    }
});

const electronStore: IStore = new StoreElectron("readium2-testapp", {
    basicLinkTitles: true,
    readiumCSS: readiumCssDefaultsJson,
    readiumCSSEnable: false,
});

function __computeReadiumCssJsonMessage(_publication: Publication, _link: Link | undefined):
    IEventPayload_R2_EVENT_READIUMCSS {

    const on = electronStore.get("readiumCSSEnable");
    if (on) {
        let cssJson = electronStore.get("readiumCSS");
        if (!cssJson) {
            cssJson = readiumCSSDefaults;
        }
        const jsonMsg: IEventPayload_R2_EVENT_READIUMCSS = {
            setCSS: cssJson,
        };
        return jsonMsg;
    } else {
        return { setCSS: undefined }; // reset all (disable ReadiumCSS)
    }
}

let _electronBrowserWindowFileOrUrlDialog: BrowserWindow | undefined;
function loadFileOrUrlDialog(initval: string) {

    if (_electronBrowserWindowFileOrUrlDialog) {
        _electronBrowserWindowFileOrUrlDialog.show();
        debug("_electronBrowserWindowFileOrUrlDialog.show()");
        return;
    }

    const dialogid = uuid.v4().replace(/-/g, "_");
    const html = `
<html>
<head>
<script type="text/javascript">

const { ipcRenderer } = require('electron');

ipcRenderer.on("filePath", (ev, filePath) => {

    const dataEl = document.getElementById('data');
    dataEl.value = filePath;
});

const cancel = () => {
const payload = {
urlOrPath: undefined,
};
ipcRenderer.send("${R2_EVENT_OPEN_URL_OR_PATH + dialogid}", payload);
};
const submit = () => {
const dataEl = document.getElementById('data');
const payload = {
urlOrPath: dataEl.value,
};
ipcRenderer.send("${R2_EVENT_OPEN_URL_OR_PATH + dialogid}", payload);
};

window.addEventListener("DOMContentLoaded", () => {

document.getElementById('filechoose').addEventListener('click', () => {
    const payload = {
        urlOrPath: undefined,
        fileChooser: true,
    };
    ipcRenderer.send("${R2_EVENT_OPEN_URL_OR_PATH + dialogid}", payload);
});

document.getElementById('ok').addEventListener('click', () => submit());
document.getElementById('cancel').addEventListener('click', () => cancel());

const dataEl = document.getElementById('data');

dataEl.addEventListener('keyup', e => {
e.which = e.which || e.keyCode;
if (e.which === 13) {
    submit();
}
if (e.which === 27) {
    cancel();
}
});

dataEl.focus();
dataEl.select();

const drag = (ev) => {
ev.preventDefault();
return false;
};
const drop = (ev) => {
ev.preventDefault();

if (!ev.dataTransfer) {
    return;
}

let urlOrPath = undefined;
if (ev.dataTransfer.items) {
    for (const item of ev.dataTransfer.items) {
        if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) {
                console.log(file.name);
                console.log(file.path);
                urlOrPath = file.path;
                break;
            }
        } else if (item.kind === "string") {
            if (item.type === "text/plain") { /* text/uri-list text/html */
                const data = ev.dataTransfer.getData(item.type);
                console.log(data);
                urlOrPath = data;
            } else {
                console.log(item.type);
                console.log(ev.dataTransfer.getData(item.type));
            }
        } else {
            console.log(item.kind);
        }
    }
} else if (ev.dataTransfer.files) {
    for (const file of ev.dataTransfer.files) {
        console.log(file.name);
        console.log(file.path);
        urlOrPath = file.path;
        break;
    }
}

if (urlOrPath) {
    const payload = {
        urlOrPath
    };
    ipcRenderer.send("${R2_EVENT_OPEN_URL_OR_PATH + dialogid}", payload);
}

};

window.document.addEventListener("dragover", drag, false);
window.document.addEventListener("drop", drag, false);

const dropEl = document.getElementById('drop');

dropEl.addEventListener("dragover", drag, false);
dropEl.addEventListener("drop", drop, false);
});

</script>
<style>
body {
font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
line-height: 1.5em;
color: #333;
background-color: #fff;
}

#container {
/* align-items: center;
justify-content: center; */
display: block;
overflow: hidden;
}

#form {
width: 100%;
}

#label {
max-width: 100%;
max-height: 100%;
margin-bottom: .8em;
padding: 0 .5em;
/* white-space: nowrap; */
/* overflow: hidden; */
/* text-overflow: ellipsis; */
}

#data {
border-radius: 2px;
background: #fff;
width: 400px;
padding: .4em .5em;
border: 1px solid black;
min-height: 2em;
margin: 0 0 1.2em;
}

#data-container {
text-align: center;
}

#buttons {
text-align: right;
padding: 0 .5em 0 0;
}

#filechoose,
#buttons > button {
border-radius: 2px;
border: 0;
margin: 0 0 0 .5em;
font-size: .8em;
line-height: 1em;
padding: .6em 1em;
cursor: pointer;
}

#filechoose {
    margin-right: 8px;
}
#filechoose, input {
    display: inline-block;
}

/*
#ok {
background-color: #3879D9;
color: white;
}

#cancel {
background-color: #DDD;
color: black;
}
*/

*:focus {
outline-style: solid !important;
outline-width: 2px !important;
outline-color: blue !important;
outline-offset: 2px !important;
}

#drop {
display: block;
margin-top: 1em;
width: 99%;
height: 100px;
color: black;
background-color: #eeffee;
border: 1px dashed #333333;
border-radius: 8px;
vertical-align: middle;
text-align: center;

display: flex;
justify-content: center;
flex-direction: column;
}
</style>
</head>
<body>
<div id="container">
<div id="form">
<div id="label">Enter URL or filepath:</div>
<div id="data-container">
<button id="filechoose">Choose...</button>
<input id="data" value="${initval}"/>
</div>
<div id="buttons">
<button id="cancel">Cancel</button>
<button id="ok">OK</button>
</div>
</div>
<div id="drop">
file drag-and-drop
</div>
</div>
</body>
</html>
    `;
    // tslint:disable-next-line:max-line-length
    // https://github.com/electron/electron/blob/v4.0.0/docs/api/breaking-changes.md#new-browserwindow-webpreferences-
    _electronBrowserWindowFileOrUrlDialog = new BrowserWindow({
        alwaysOnTop: true,
        height: 300,
        modal: false,
        resizable: false,
        skipTaskbar: false,
        title: "Readium2 Electron/NodeJS test app",
        useContentSize: false,
        webPreferences: {
            allowRunningInsecureContent: false,
            contextIsolation: false,
            devTools: true,
            nodeIntegration: true,
            nodeIntegrationInWorker: false,
            sandbox: false,
            webSecurity: true,
            webviewTag: false,
            // preload: __dirname + "/" + "preload.js",
        },
        width: 600,
    });

    resetMenu(undefined); // _electronBrowserWindowFileOrUrlDialog
    // _electronBrowserWindowFileOrUrlDialog.setMenu(null);

    async function dialogResult(_event: any, payload: IEventPayload_R2_EVENT_OPEN_URL_OR_PATH) {

        if (payload.urlOrPath) {
            process.nextTick(async () => {
                await loadFileOrUrl(payload.urlOrPath);
            });

            setTimeout(() => {
                if (_electronBrowserWindowFileOrUrlDialog) {
                    _electronBrowserWindowFileOrUrlDialog.close();
                }
            }, 200);
        } else if ((payload as any).fileChooser) {
            process.nextTick(async () => {
                const choice = dialog.showOpenDialog({
                    defaultPath: _lastBookPath, // || DEFAULT_BOOK_PATH,
                    filters: [
                        { name: "EPUB publication", extensions: ["epub", "epub3"] },
                        { name: "LCP license", extensions: ["lcpl"] },
                        { name: "Comic book", extensions: ["cbz"] },
                        // {name: "Zip archive", extensions: ["zip"]},
                        // {name: "Any file", extensions: ["*"]},
                    ],
                    message: "Choose a file",
                    properties: ["openFile"],
                    title: "Open from filesystem",
                });
                if (!choice || !choice.length) {
                    return;
                }
                const filePath = choice[0];
                debug(filePath);

                // await openFileDownload(filePath);
                // process.nextTick(async () => {
                //     loadFileOrUrlDialog(filePath);
                // });
                if (_electronBrowserWindowFileOrUrlDialog) {
                    _electronBrowserWindowFileOrUrlDialog.webContents.send("filePath", filePath);
                }
            });
        } else {
            if (_electronBrowserWindowFileOrUrlDialog) {
                _electronBrowserWindowFileOrUrlDialog.close();
            }
        }
    }

    ipcMain.on(R2_EVENT_OPEN_URL_OR_PATH + dialogid, dialogResult);

    _electronBrowserWindowFileOrUrlDialog.on("closed", (_ev: any) => {

        // if (BrowserWindow.getAllWindows().length === 1) { // webContents.getAllWebContents()
        //     ev.preventDefault();
        //     return;
        // }

        ipcMain.removeListener(R2_EVENT_OPEN_URL_OR_PATH + dialogid, dialogResult);
        _electronBrowserWindowFileOrUrlDialog = undefined;
    });

    _electronBrowserWindowFileOrUrlDialog.webContents.loadURL("data:text/html," + html);
}

ipcMain.on(R2_EVENT_OPEN_URL_OR_PATH, async (_event: any, payload: IEventPayload_R2_EVENT_OPEN_URL_OR_PATH) => {
    await loadFileOrUrl(payload.urlOrPath);
});

async function loadFileOrUrl(argPath: string): Promise<boolean> {

    let filePathToLoadOnLaunch: string | undefined;
    let filePath = argPath;
    debug(filePath);
    if (isHTTP(filePath)) {
        await openFile(filePath);
        return true;
    } else {
        if (!fs.existsSync(filePath)) {
            filePath = path.join(__dirname, argPath);
            debug(filePath);
            if (!fs.existsSync(filePath)) {
                filePath = path.join(process.cwd(), argPath);
                debug(filePath);
                if (!fs.existsSync(filePath)) {
                    debug("FILEPATH DOES NOT EXIST: " + filePath);
                } else {
                    filePathToLoadOnLaunch = filePath;
                }
            } else {
                filePathToLoadOnLaunch = filePath;
            }
        } else {
            filePath = fs.realpathSync(filePath);
            debug(filePath);
            filePathToLoadOnLaunch = filePath;
        }
    }

    if (filePathToLoadOnLaunch) {
        if (isEPUBlication(filePathToLoadOnLaunch) || await isManifestJSON(filePathToLoadOnLaunch)) {
            await openFile(filePathToLoadOnLaunch);
            return true;
        } else if (!fs.lstatSync(filePathToLoadOnLaunch).isDirectory()) {
            await openFileDownload(filePathToLoadOnLaunch);
            return true;
        }
    }
    return false;
}

app.on("ready", () => {
    debug("app ready");

    // protocol.registerServiceWorkerSchemes(["epub"]);

    // registerFileProtocol
    // protocol.registerBufferProtocol("epub",
    //     (request, callback) => {
    //         debug(request.url);
    //         const data = fs.readFileSync(request.url);
    //         const mimeType = mime.lookup(request.url);
    //         callback({ data, mimeType });
    //     }, (error) => {
    //         debug(error);
    //     });

    // tslint:disable-next-line:no-floating-promises
    (async () => {
        // try {
        //     _publicationsFilePaths = await filehound.create()
        //         .depth(0)
        //         .ignoreHiddenDirectories()
        //         .ignoreHiddenFiles()
        //         // .discard("node_modules")
        //         // .discard(".*.asar")
        //         .paths(DEFAULT_BOOK_PATH)
        //         .ext([".epub", ".epub3", ".cbz", ".lcpl"])
        //         .find();
        // } catch (err) {
        //     debug(err);
        // }
        // debug(_publicationsFilePaths);
        _publicationsFilePaths = [];
        _publicationsUrls = [];

        _publicationsServer = new Server({
            disableDecryption: false,
            disableOPDS: true,
            disableReaders: true,
            disableRemotePubUrl: true,
        });

        if (SECURE) {
            secureSessions(_publicationsServer); // port 443 ==> HTTPS
        }

        installLcpHandler(_publicationsServer);
        installLsdHandler(_publicationsServer, deviceIDManager);

        const readiumCSSPath = IS_DEV ?
            path.join(process.cwd(), "dist", "ReadiumCSS").replace(/\\/g, "/") :
            path.join(__dirname, "ReadiumCSS").replace(/\\/g, "/");

        setupReadiumCSS(_publicationsServer, readiumCSSPath, __computeReadiumCssJsonMessage);

        // For the webview preload sourcemaps (local file URL)
        if (IS_DEV) {
            let preloadPath = "FOLDER_PATH_TO/preload.js";
            // TODO: REEEALLY HACKY! (and does not work in release bundle mode, only with dist/ exploded code)
            let distTarget: string | undefined;
            const dirnameSlashed = __dirname.replace(/\\/g, "/");
            if (dirnameSlashed.indexOf("/dist/es5") > 0) {
                distTarget = "es5";
            } else if (dirnameSlashed.indexOf("/dist/es6-es2015") > 0) {
                distTarget = "es6-es2015";
            } else if (dirnameSlashed.indexOf("/dist/es7-es2016") > 0) {
                distTarget = "es7-es2016";
            } else if (dirnameSlashed.indexOf("/dist/es8-es2017") > 0) {
                distTarget = "es8-es2017";
            }
            if (distTarget) {
                preloadPath = path.join(process.cwd(),
                    "node_modules/r2-navigator-js/dist/" +
                    distTarget); // + "/src/electron/renderer/webview/preload.js"
            }
            preloadPath = preloadPath.replace(/\\/g, "/");
            console.log(preloadPath);
            // https://expressjs.com/en/4x/api.html#express.static
            const staticOptions = {
                dotfiles: "ignore",
                etag: true,
                fallthrough: false,
                immutable: true,
                index: false,
                maxAge: "1d",
                redirect: false,
                // extensions: ["css", "otf"],
                // setHeaders: function (res, path, stat) {
                //   res.set('x-timestamp', Date.now())
                // }
            };
            _publicationsServer.expressUse(preloadPath, express.static(preloadPath, staticOptions));
        }

        // _publicationsServer.expressGet(["/resize-sensor.js"],
        //     (req: express.Request, res: express.Response) => {

        //         const swPth = "./renderer/ResizeSensor.js";
        //         const swFullPath = path.resolve(path.join(__dirname, swPth));
        //         if (!fs.existsSync(swFullPath)) {

        //             const err = "Missing ResizeSensor JS! ";
        //             debug(err + swFullPath);
        //             res.status(500).send("<html><body><p>Internal Server Error</p><p>"
        //                 + err + "</p></body></html>");
        //             return;
        //         }

        //         const swJS = fs.readFileSync(swFullPath, { encoding: "utf8" });
        //         // debug(swJS);

        //         // this.setResponseCORS(res);
        //         res.set("Content-Type", "text/javascript; charset=utf-8");

        //         const checkSum = crypto.createHash("sha256");
        //         checkSum.update(swJS);
        //         const hash = checkSum.digest("hex");

        //         const match = req.header("If-None-Match");
        //         if (match === hash) {
        //             debug("ResizeSensor.js cache");
        //             res.status(304); // StatusNotModified
        //             res.end();
        //             return;
        //         }

        //         res.setHeader("ETag", hash);
        //         // res.setHeader("Cache-Control", "public,max-age=86400");

        //         res.status(200).send(swJS);
        //     });

        // _publicationsServer.expressGet(["/sw.js"],
        //     (req: express.Request, res: express.Response) => {

        //         const swPth = "./renderer/sw/service-worker.js";
        //         const swFullPath = path.resolve(path.join(__dirname, swPth));
        //         if (!fs.existsSync(swFullPath)) {

        //             const err = "Missing Service Worker JS! ";
        //             debug(err + swFullPath);
        //             res.status(500).send("<html><body><p>Internal Server Error</p><p>"
        //                 + err + "</p></body></html>");
        //             return;
        //         }

        //         const swJS = fs.readFileSync(swFullPath, { encoding: "utf8" });
        //         // debug(swJS);

        //         // this.setResponseCORS(res);
        //         res.set("Content-Type", "text/javascript; charset=utf-8");

        //         const checkSum = crypto.createHash("sha256");
        //         checkSum.update(swJS);
        //         const hash = checkSum.digest("hex");

        //         const match = req.header("If-None-Match");
        //         if (match === hash) {
        //             debug("service-worker.js cache");
        //             res.status(304); // StatusNotModified
        //             res.end();
        //             return;
        //         }

        //         res.setHeader("ETag", hash);
        //         // res.setHeader("Cache-Control", "public,max-age=86400");

        //         res.status(200).send(swJS);
        //     });

        try {
            _publicationsServerPort = await portfinder.getPortPromise();
        } catch (err) {
            debug(err);
        }

        // Force HTTPS, see secureSessions()
        // const serverInfo =
        await _publicationsServer.start(_publicationsServerPort, SECURE);
        // debug(serverInfo);

        _publicationsRootUrl = _publicationsServer.serverUrl() as string;
        debug(_publicationsRootUrl);

        if (_publicationsFilePaths && _publicationsFilePaths.length) {
            const pubPaths = _publicationsServer.addPublications(_publicationsFilePaths);
            _publicationsUrls = pubPaths.map((pubPath) => {
                return `${_publicationsRootUrl}${pubPath}`;
            });
            debug(_publicationsUrls);
        }

        resetMenu(undefined);

        process.nextTick(async () => {

            const args = process.argv.slice(2);
            debug("args:");
            debug(args);
            if (args && args.length && args[0]) {
                const argPath = args[0].trim();
                if (await loadFileOrUrl(argPath)) {
                    return;
                }
            }

            loadFileOrUrlDialog("");
        });
    })();
});

function resetMenu(browserWindow: BrowserWindow | undefined) {

    const menuTemplate = [
        {
            label: "Readium2 Electron",
            submenu: [
                { label: "About...", selector: "orderFrontStandardAboutPanel:" },
                { type: "separator" },
                {
                    accelerator: "Command+Q",
                    click: () => { app.quit(); },
                    label: "Quit",
                },
            ],
        },
        {
            label: "File",
            submenu: [
            ],
        },
        {
            label: "Edit",
            submenu: [
                { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
                { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
                { type: "separator" },
                { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
                { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
                { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
                { label: "Select All", accelerator: "CmdOrCtrl+A", selector: "selectAll:" },
            ],
        },
        {
            role: "window",
            submenu: [
                {
                    role: "togglefullscreen",
                },
                {
                    role: "minimize",
                },
                {
                    role: "close",
                },
            ],
        },
        {
            label: "Tools",
            submenu: [
                // {
                //     accelerator: "CmdOrCtrl+W",
                //     click: (_item: any, focusedWindow: any) => {
                //         if (focusedWindow) {
                //             focusedWindow.close();
                //         }
                //     },
                //     label: "Close",
                // },
                {
                    accelerator: "CmdOrCtrl+R",
                    click: (_item: any, focusedWindow: any) => {
                        if (focusedWindow) {
                            focusedWindow.reload();
                        }
                    },
                    label: "Reload",
                },
                {
                    accelerator: process.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I",
                    click: (_item: any, _focusedWindow: any) => {
                        openAllDevTools();
                        // setTimeout(() => {
                        //     // console.log(focusedWindow);
                        //     if (focusedWindow) {
                        //         focusedWindow.webContents.toggleDevTools();
                        //     }
                        // }, 1000);
                    },
                    label: "Dev Tools (all)",
                },
                {
                    accelerator: process.platform === "darwin" ? "Shift+Alt+Command+I" : "Alt+Ctrl+Shift+I",
                    click: (_item: any, _focusedWindow: any) => {
                        openTopLevelDevTools();
                    },
                    label: "Dev Tools (top only)",
                },
            ],
        },
        {
            role: "help",
            submenu: [
                {
                    click: (_item: any, _focusedWindow: any) => {
                        shell.openExternal("https://github.com/readium/r2-testapp-js/");
                    },
                    label: "Website...",
                },
            ],
        },
    ];

    // (menuTemplate[1].submenu as any[]).push({
    //     click: async () => {
    //         ...
    //     },
    //     label: "Choose from filesystem...",
    // } as any);

    (menuTemplate[1].submenu as any[]).push({
        accelerator: "CmdOrCtrl+O",
        click: async () => {
            loadFileOrUrlDialog("");
        },
        label: "Open...",
    } as any);

    (menuTemplate[1].submenu as any[]).push(
        {
            type: "separator",
        } as any);

    _publicationsUrls.forEach((pubManifestUrl, n) => {
        const filePath = _publicationsFilePaths[n];
        debug("MENU ITEM: " + filePath + " : " + pubManifestUrl);

        (menuTemplate[1] as any).submenu.push({
            click: async () => {
                debug(filePath);
                await openFileDownload(filePath);
            },
            label: filePath, // + " : " + pubManifestUrl,
        } as any);
    });
    const menu = Menu.buildFromTemplate(menuTemplate as MenuItemConstructorOptions[]);
    if (browserWindow) {
        browserWindow.setMenu(menu);
    } else {
        Menu.setApplicationMenu(menu);
    }
}

async function openFileDownload(filePath: string) {
    const dir = path.dirname(filePath);
    _lastBookPath = dir;
    debug(_lastBookPath);

    const ext = path.extname(filePath);
    const filename = path.basename(filePath);
    const destFileName = filename + ".epub";
    if (ext === ".lcpl") {
        let epubFilePath: string[];
        try {
            epubFilePath = await downloadEPUBFromLCPL(filePath, dir, destFileName);
        } catch (err) {
            process.nextTick(() => {
                const detail = (typeof err === "string") ?
                    err :
                    (err.toString ? err.toString() : "ERROR!?");
                const message = "LCP EPUB download fail!]";
                const res = dialog.showMessageBox({
                    buttons: ["&OK"],
                    cancelId: 0,
                    defaultId: 0,
                    detail,
                    message,
                    noLink: true,
                    normalizeAccessKeys: true,
                    title: "Readium2 Electron streamer / navigator",
                    type: "info",
                });
                if (res === 0) {
                    debug("ok");
                }
            });
            return;
        }

        const result = epubFilePath as string[];
        process.nextTick(async () => {
            const detail = result[0] + " ---- [" + result[1] + "]";
            const message = "LCP EPUB file download success [" + destFileName + "]";
            const res = dialog.showMessageBox({
                buttons: ["&OK"],
                cancelId: 0,
                defaultId: 0,
                detail,
                message,
                noLink: true,
                normalizeAccessKeys: true,
                title: "Readium2 Electron streamer / navigator",
                type: "info",
            });
            if (res === 0) {
                debug("ok");
            }

            await openFile(result[0]);
        });
    } else {
        await openFile(filePath);
    }
}

async function openFile(filePath: string) {
    let n = _publicationsFilePaths.indexOf(filePath);
    if (n < 0) {
        if (await isManifestJSON(filePath)) {
            _publicationsFilePaths.push(filePath);
            debug(_publicationsFilePaths);

            _publicationsUrls.push(filePath);
            debug(_publicationsUrls);

            n = _publicationsFilePaths.length - 1; // === _publicationsUrls.length - 1
        } else {
            const publicationPaths = _publicationsServer.addPublications([filePath]);
            debug(publicationPaths);

            _publicationsFilePaths.push(filePath);
            debug(_publicationsFilePaths);

            _publicationsUrls.push(`${_publicationsRootUrl}${publicationPaths[0]}`);
            debug(_publicationsUrls);

            n = _publicationsFilePaths.length - 1; // === _publicationsUrls.length - 1
        }

        process.nextTick(() => {
            resetMenu(undefined);
        });
    }

    const file = _publicationsFilePaths[n];
    const pubManifestUrl = _publicationsUrls[n];

    await createElectronBrowserWindow(file, pubManifestUrl);
}

app.on("activate", () => {
    debug("app activate");
});

app.on("before-quit", () => {
    debug("app before quit");
});

app.on("window-all-closed", () => {
    debug("app window-all-closed");

    setTimeout(() => {
        dialog.showMessageBox(
            {
                buttons: [ "yes", "no" ],
                cancelId: 1,
                checkboxChecked: undefined,
                checkboxLabel: undefined,
                defaultId: 0,
                detail: undefined,
                icon: undefined,
                message: "Do you want to exit this application?",
                noLink: true,
                normalizeAccessKeys: false,
                title: "Readium2 test app, exit?",
                type: "question",
            },
            (response: number, _checkboxChecked: boolean) => {

            if (response === 0) {
                app.quit();
            } else {
                loadFileOrUrlDialog("");
            }
        });
    }, 300);
    // if (process.platform !== "darwin") {
    //     app.quit();
    // }
});

app.on("quit", () => {
    debug("app quit");

    _publicationsServer.stop();
});
