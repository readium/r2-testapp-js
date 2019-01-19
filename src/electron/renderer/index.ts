// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import * as path from "path";

import {
    IEventPayload_R2_EVENT_READIUMCSS,
} from "@r2-navigator-js/electron/common/events";
import {
    IReadiumCSS,
    readiumCSSDefaults,
} from "@r2-navigator-js/electron/common/readium-css-settings";
import {
    READIUM2_ELECTRON_HTTP_PROTOCOL,
    convertCustomSchemeToHttpUrl,
} from "@r2-navigator-js/electron/common/sessions";
import { getURLQueryParams } from "@r2-navigator-js/electron/renderer/common/querystring";
import {
    LocatorExtended,
    TTSStateEnum,
    getCurrentReadingLocation,
    handleLinkLocator,
    handleLinkUrl,
    installNavigatorDOM,
    navLeftOrRight,
    readiumCssOnOff,
    setEpubReadingSystemInfo,
    setReadingLocationSaver,
    setReadiumCssJsonGetter,
    ttsClickEnable,
    ttsListen,
    ttsNext,
    ttsPause,
    ttsPlay,
    ttsPrevious,
    ttsResume,
    ttsStop,
} from "@r2-navigator-js/electron/renderer/index";
import {
    initGlobalConverters_OPDS,
} from "@r2-opds-js/opds/init-globals";
import {
    initGlobalConverters_GENERIC,
    initGlobalConverters_SHARED,
} from "@r2-shared-js/init-globals";
import { Locator } from "@r2-shared-js/models/locator";
import { IStringMap } from "@r2-shared-js/models/metadata-multilang";
import { Publication } from "@r2-shared-js/models/publication";
import { debounce } from "debounce";
import { ipcRenderer } from "electron";
import { JSON as TAJSON } from "ta-json-x";
import * as throttle from "throttleit";

import {
    IEventPayload_R2_EVENT_LCP_LSD_RENEW,
    IEventPayload_R2_EVENT_LCP_LSD_RENEW_RES,
    IEventPayload_R2_EVENT_LCP_LSD_RETURN,
    IEventPayload_R2_EVENT_LCP_LSD_RETURN_RES,
    IEventPayload_R2_EVENT_TRY_LCP_PASS,
    IEventPayload_R2_EVENT_TRY_LCP_PASS_RES,
    R2_EVENT_LCP_LSD_RENEW,
    R2_EVENT_LCP_LSD_RENEW_RES,
    R2_EVENT_LCP_LSD_RETURN,
    R2_EVENT_LCP_LSD_RETURN_RES,
    R2_EVENT_TRY_LCP_PASS,
    R2_EVENT_TRY_LCP_PASS_RES,
} from "../common/events";
import { IStore } from "../common/store";
import { StoreElectron } from "../common/store-electron";
import { HTML_COLORS } from "./colours";
import { setupDragDrop } from "./drag-drop";
import {
    IRiotOptsLinkList,
    IRiotOptsLinkListItem,
    IRiotTagLinkList,
    riotMountLinkList,
} from "./riots/linklist/index_";
import {
    IRiotOptsLinkListGroup,
    IRiotOptsLinkListGroupItem,
    IRiotTagLinkListGroup,
    riotMountLinkListGroup,
} from "./riots/linklistgroup/index_";
import {
    IRiotOptsLinkTree,
    IRiotOptsLinkTreeItem,
    IRiotTagLinkTree,
    riotMountLinkTree,
} from "./riots/linktree/index_";
import {
    IRiotOptsMenuSelect,
    IRiotOptsMenuSelectItem,
    IRiotTagMenuSelect,
    riotMountMenuSelect,
} from "./riots/menuselect/index_";

import SystemFonts = require("system-font-families");

// import { consoleRedirect } from "@r2-navigator-js/electron/renderer/common/console-redirect";
// // const releaseConsoleRedirect =
// consoleRedirect("r2:testapp#electron/renderer/index", process.stdout, process.stderr, true);

const IS_DEV = (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dev");

const queryParams = getURLQueryParams();

// import { registerProtocol } from "@r2-navigator-js/electron/renderer/common/protocol";
// registerProtocol();

const readiumCssDefaultsJson: IReadiumCSS = readiumCSSDefaults;
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

const electronStoreLCP: IStore = new StoreElectron("readium2-testapp-lcp", {});

// console.log(window.location);
// console.log(document.baseURI);
// console.log(document.URL);

initGlobalConverters_OPDS();
initGlobalConverters_SHARED();
initGlobalConverters_GENERIC();

// tslint:disable-next-line:no-string-literal
const pubServerRoot = queryParams["pubServerRoot"];
console.log(pubServerRoot);

const computeReadiumCssJsonMessage = (): IEventPayload_R2_EVENT_READIUMCSS => {

    const on = electronStore.get("readiumCSSEnable");
    if (on) {
        let cssJson = electronStore.get("readiumCSS");
        console.log("---- readiumCSS -----");
        console.log(cssJson);
        console.log("-----");
        if (!cssJson) {
            cssJson = readiumCSSDefaults;
        }
        const jsonMsg: IEventPayload_R2_EVENT_READIUMCSS = {
            setCSS: cssJson,
            urlRoot: pubServerRoot,
        };
        return jsonMsg;
    } else {
        return { setCSS: undefined }; // reset all (disable ReadiumCSS)
    }
};
setReadiumCssJsonGetter(computeReadiumCssJsonMessage);

setEpubReadingSystemInfo({ name: "Readium2 test app", version: "0.0.1-alpha.1" });

interface IReadingLocation {
    doc: string;
    loc: string | undefined; // legacy
    locCfi: string;
    locCssSelector: string;
    locProgression: number;
    locPosition: number;
}

function setReadingProgressionSlider(locator: Locator | undefined) {
    const percent = (!locator || !locator.locations.progression) ? 0 :
        Math.round(locator.locations.progression * 10) * 10;
    const positionSelector = document.getElementById("positionSelector") as HTMLElement;
    (positionSelector as any).mdcSlider.value = percent;

    const positionSelectorValue = document.getElementById("positionSelectorValue") as HTMLElement;

    const current = getCurrentReadingLocation(); // LocatorExtended
    if (!current || !current.paginationInfo ||
        (typeof current.paginationInfo.isTwoPageSpread === "undefined") ||
        (typeof current.paginationInfo.spreadIndex === "undefined") ||
        (typeof current.paginationInfo.currentColumn === "undefined") ||
        (typeof current.paginationInfo.totalColumns === "undefined")) {

        positionSelectorValue.textContent = "";
        return;
    }
    // const n = current.paginationInfo.isTwoPageSpread ?
    //     current.paginationInfo.spreadIndex : current.paginationInfo.currentColumn;
    // const total = current.paginationInfo.isTwoPageSpread ?
    //     (current.paginationInfo.totalColumns / 2) : current.paginationInfo.totalColumns;
    const nColumn = current.paginationInfo.currentColumn + 1;
    const nSpreadColumn = (current.paginationInfo.spreadIndex * 2) + 1;
    const total = current.paginationInfo.totalColumns;
    positionSelectorValue.textContent = current.paginationInfo.isTwoPageSpread ?
        `Pages ${nSpreadColumn}-${nSpreadColumn + 1} / ${total}` : `Page ${nColumn} / ${total}`;
}

const saveReadingLocation = (location: LocatorExtended) => {

    setReadingProgressionSlider(location.locator);

    let obj = electronStore.get("readingLocation");
    if (!obj) {
        obj = {};
    }
    obj[pathDecoded] = {
        doc: location.locator.href,
        loc: undefined,
        locCfi: location.locator.locations.cfi,
        locCssSelector: location.locator.locations.cssSelector,
        locPosition: location.locator.locations.position,
        locProgression: location.locator.locations.progression,
    } as IReadingLocation;
    electronStore.set("readingLocation", obj);
};
setReadingLocationSaver(saveReadingLocation);

// import * as path from "path";
// import { setLcpNativePluginPath } from "@r2-streamer-js/parser/epub/lcp";
// // tslint:disable-next-line:no-string-literal
// const lcpPluginBase64 = queryParams["lcpPlugin"];
// if (lcpPluginBase64) {
//     const lcpPlugin = new Buffer(lcpPluginBase64, "base64").toString("utf8");
//     setLcpNativePluginPath(lcpPlugin);
// } else {
//     setLcpNativePluginPath(path.join(process.cwd(), "LCP", "lcp.node"));
// }

// tslint:disable-next-line:no-string-literal
const publicationJsonUrl = queryParams["pub"];
console.log(publicationJsonUrl);
const publicationJsonUrl_ = publicationJsonUrl.startsWith(READIUM2_ELECTRON_HTTP_PROTOCOL) ?
    convertCustomSchemeToHttpUrl(publicationJsonUrl) : publicationJsonUrl;
console.log(publicationJsonUrl_);

// tslint:disable-next-line:no-string-literal
const isHttpWebPubWithoutLCP = queryParams["isHttpWebPub"];
console.log(isHttpWebPubWithoutLCP);

let pathDecoded = "";
if (isHttpWebPubWithoutLCP) {
    pathDecoded = publicationJsonUrl;
} else {
    const pathBase64 = publicationJsonUrl_.
        replace(/.*\/pub\/(.*)\/manifest.json.*/, "$1");
    // replace("*-URL_LCP_PASS_PLACEHOLDER-*", ""); // lcpBeginToken + lcpEndToken
    console.log(pathBase64);
    pathDecoded = new Buffer(decodeURIComponent(pathBase64), "base64").toString("utf8");
    console.log(pathDecoded);
}
const pathFileName = pathDecoded.substr(
    pathDecoded.replace(/\\/g, "/").lastIndexOf("/") + 1,
    pathDecoded.length - 1);
console.log(pathFileName);

// tslint:disable-next-line:no-string-literal
const lcpHint = queryParams["lcpHint"];

electronStore.onChanged("readiumCSS.colCount", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }
    console.log("readiumCSS.colCount: ", oldValue, " => ", newValue);

    const radioColCountAutoEl = document.getElementById("radioColCountAuto") as HTMLInputElement;
    radioColCountAutoEl.checked = newValue === "auto";

    const radioColCount1El = document.getElementById("radioColCount1") as HTMLInputElement;
    radioColCount1El.checked = newValue === "1";

    const radioColCount2El = document.getElementById("radioColCount2") as HTMLInputElement;
    radioColCount2El.checked = newValue === "2";

    refreshReadiumCSS();
});

electronStore.onChanged("readiumCSS.night", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }

    if (newValue) {
        // const sepiaSwitchEl = document.getElementById("sepia_switch") as HTMLElement;
        // const sepiaSwitch = (sepiaSwitchEl as any).mdcSwitch;
        // if (sepiaSwitch.checked) {
        //     sepiaSwitch.checked = false;
        // }
        if (electronStore.get("readiumCSS.sepia")) {
            electronStore.set("readiumCSS.sepia", false);
        }
    }

    // const nightSwitch = document.getElementById("night_switch-input") as HTMLInputElement;
    const nightSwitchEl = document.getElementById("night_switch") as HTMLElement;
    const nightSwitch = (nightSwitchEl as any).mdcSwitch;
    nightSwitch.checked = newValue;

    // TODO DARK THEME UI
    // if (newValue) {
    //     document.body.classList.add("mdc-theme--dark");
    // } else {
    //     document.body.classList.remove("mdc-theme--dark");
    // }

    const darkenSwitchEl = document.getElementById("darken_switch") as HTMLElement;
    const darkenSwitch = (darkenSwitchEl as any).mdcSwitch;
    darkenSwitch.disabled = !newValue;
    if (!newValue) {
        electronStore.set("readiumCSS.darken", false);
    }

    const invertSwitchEl = document.getElementById("invert_switch") as HTMLElement;
    const invertSwitch = (invertSwitchEl as any).mdcSwitch;
    invertSwitch.disabled = !newValue;
    if (!newValue) {
        electronStore.set("readiumCSS.invert", false);
    }

    const nightDiv = document.getElementById("night_div") as HTMLElement;
    nightDiv.style.display = newValue ? "block" : "none";

    refreshReadiumCSS();
});

electronStore.onChanged("readiumCSS.sepia", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }

    if (newValue) {
        // const nightSwitchEl = document.getElementById("night_switch") as HTMLElement;
        // const nightSwitch = (nightSwitchEl as any).mdcSwitch;
        // if (nightSwitch.checked) {
        //     nightSwitch.checked = false;
        // }
        if (electronStore.get("readiumCSS.night")) {
            electronStore.set("readiumCSS.night", false);
        }
    }

    const sepiaSwitchEl = document.getElementById("sepia_switch") as HTMLElement;
    const sepiaSwitch = (sepiaSwitchEl as any).mdcSwitch;
    sepiaSwitch.checked = newValue;

    refreshReadiumCSS();
});

electronStore.onChanged("readiumCSS.darken", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }

    const darkenSwitchEl = document.getElementById("darken_switch") as HTMLElement;
    const darkenSwitch = (darkenSwitchEl as any).mdcSwitch;
    darkenSwitch.checked = newValue;

    refreshReadiumCSS();
});

electronStore.onChanged("readiumCSS.invert", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }

    const invertSwitchEl = document.getElementById("invert_switch") as HTMLElement;
    const invertSwitch = (invertSwitchEl as any).mdcSwitch;
    invertSwitch.checked = newValue;

    refreshReadiumCSS();
});

electronStore.onChanged("readiumCSS.textAlign", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }

    // const justifySwitch = document.getElementById("justify_switch-input") as HTMLInputElement;
    const justifySwitchEl = document.getElementById("justify_switch") as HTMLElement;
    const justifySwitch = (justifySwitchEl as any).mdcSwitch;
    justifySwitch.checked = (newValue === "justify");

    refreshReadiumCSS();
});

electronStore.onChanged("readiumCSS.noFootnotes", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }

    // const footnotesSwitch = document.getElementById("footnotes_switch-input") as HTMLInputElement;
    const footnotesSwitchEl = document.getElementById("footnotes_switch") as HTMLElement;
    const footnotesSwitch = (footnotesSwitchEl as any).mdcSwitch;
    footnotesSwitch.checked = newValue ? false : true;

    refreshReadiumCSS();
});

electronStore.onChanged("readiumCSS.reduceMotion", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }

    // const reduceMotionSwitch = document.getElementById("reduceMotion_switch-input") as HTMLInputElement;
    const reduceMotionSwitchEl = document.getElementById("reduceMotion_switch") as HTMLElement;
    const reduceMotionSwitch = (reduceMotionSwitchEl as any).mdcSwitch;
    reduceMotionSwitch.checked = newValue ? true : false;

    refreshReadiumCSS();
});

electronStore.onChanged("readiumCSS.paged", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }

    // const paginateSwitch = document.getElementById("paginate_switch-input") as HTMLInputElement;
    const paginateSwitchEl = document.getElementById("paginate_switch") as HTMLElement;
    const paginateSwitch = (paginateSwitchEl as any).mdcSwitch;
    paginateSwitch.checked = newValue;

    const colCountRadiosEl = document.getElementById("colCountRadios") as HTMLElement;
    if (newValue) {
        colCountRadiosEl.style.display = "block";
    } else {
        colCountRadiosEl.style.display = "none";
    }

    refreshReadiumCSS();
});

const refreshReadiumCSS = debounce(() => {
    readiumCssOnOff();
}, 500);

// super hacky, but necessary :(
// https://github.com/material-components/material-components-web/issues/1017#issuecomment-340068426
function ensureSliderLayout() {
    setTimeout(() => {
        document.querySelectorAll(".settingSlider").forEach((elem) => {
            if ((elem as any).mdcSlider) {
                (elem as any).mdcSlider.layout();
            }
            // if ((elem as any).mdcSwitch) {
            //     (elem as any).mdcSwitch.layout();
            // }
        });
    }, 100);
}

electronStore.onChanged("readiumCSSEnable", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }
    const stylingWrapper = document.getElementById("stylingWrapper") as HTMLElement;
    stylingWrapper.style.display = newValue ? "block" : "none";
    if (newValue) {
        ensureSliderLayout();
    }

    // const readiumcssSwitch = document.getElementById("readiumcss_switch-input") as HTMLInputElement;
    const readiumcssSwitchEl = document.getElementById("readiumcss_switch") as HTMLElement;
    const readiumcssSwitch = (readiumcssSwitchEl as any).mdcSwitch;
    readiumcssSwitch.checked = newValue;

    refreshReadiumCSS();

    // const justifySwitch = document.getElementById("justify_switch-input") as HTMLInputElement;
    const justifySwitchEl = document.getElementById("justify_switch") as HTMLElement;
    const justifySwitch = (justifySwitchEl as any).mdcSwitch;
    justifySwitch.disabled = !newValue;

    // const footnotesSwitch = document.getElementById("footnotes_switch-input") as HTMLInputElement;
    const footnotesSwitchEl = document.getElementById("footnotes_switch") as HTMLElement;
    const footnotesSwitch = (footnotesSwitchEl as any).mdcSwitch;
    footnotesSwitch.disabled = !newValue;

    // const reduceMotionSwitch = document.getElementById("reduceMotion_switch-input") as HTMLInputElement;
    const reduceMotionSwitchEl = document.getElementById("reduceMotion_switch") as HTMLElement;
    const reduceMotionSwitch = (reduceMotionSwitchEl as any).mdcSwitch;
    reduceMotionSwitch.disabled = !newValue;

    // const paginateSwitch = document.getElementById("paginate_switch-input") as HTMLInputElement;
    const paginateSwitchEl = document.getElementById("paginate_switch") as HTMLElement;
    const paginateSwitch = (paginateSwitchEl as any).mdcSwitch;
    paginateSwitch.disabled = !newValue;

    // const nightSwitch = document.getElementById("night_switch-input") as HTMLInputElement;
    const nightSwitchEl = document.getElementById("night_switch") as HTMLElement;
    const nightSwitch = (nightSwitchEl as any).mdcSwitch;
    nightSwitch.disabled = !newValue;
    // if (!newValue) {
    //     electronStore.set("readiumCSS.night", false);
    // }

    const sepiaSwitchEl = document.getElementById("sepia_switch") as HTMLElement;
    const sepiaSwitch = (sepiaSwitchEl as any).mdcSwitch;
    sepiaSwitch.disabled = !newValue;
    // if (!newValue) {
    //     electronStore.set("readiumCSS.sepia", false);
    // }

    const darkenSwitchEl = document.getElementById("darken_switch") as HTMLElement;
    const darkenSwitch = (darkenSwitchEl as any).mdcSwitch;
    darkenSwitch.disabled = !newValue;
    // if (!newValue) {
    //     electronStore.set("readiumCSS.darken", false);
    // }

    const invertSwitchEl = document.getElementById("invert_switch") as HTMLElement;
    const invertSwitch = (invertSwitchEl as any).mdcSwitch;
    invertSwitch.disabled = !newValue;
    // if (!newValue) {
    //     electronStore.set("readiumCSS.invert", false);
    // }
});

electronStore.onChanged("basicLinkTitles", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }
    // const basicSwitch = document.getElementById("nav_basic_switch-input") as HTMLInputElement;
    const basicSwitchEl = document.getElementById("nav_basic_switch") as HTMLElement;
    const basicSwitch = (basicSwitchEl as any).mdcSwitch;
    basicSwitch.checked = !newValue;
});

let snackBar: any;
let drawer: any;

window.onerror = (err) => {
    console.log("window.onerror:");
    console.log(err);
};

ipcRenderer.on(R2_EVENT_TRY_LCP_PASS_RES, (
    _event: any,
    payload: IEventPayload_R2_EVENT_TRY_LCP_PASS_RES) => {

    if (!payload.okay && payload.error) {
        let message: string;
        if (typeof payload.error === "string") {
            message = payload.error;
        } else {
            switch (payload.error as number) {
                case 0: {
                    message = "NONE: " + payload.error;
                    break;
                }
                case 1: {
                    message = "INCORRECT PASSPHRASE: " + payload.error;
                    break;
                }
                case 11: {
                    message = "LICENSE_OUT_OF_DATE: " + payload.error;
                    break;
                }
                case 101: {
                    message = "CERTIFICATE_REVOKED: " + payload.error;
                    break;
                }
                case 102: {
                    message = "CERTIFICATE_SIGNATURE_INVALID: " + payload.error;
                    break;
                }
                case 111: {
                    message = "LICENSE_SIGNATURE_DATE_INVALID: " + payload.error;
                    break;
                }
                case 112: {
                    message = "LICENSE_SIGNATURE_INVALID: " + payload.error;
                    break;
                }
                case 121: {
                    message = "CONTEXT_INVALID: " + payload.error;
                    break;
                }
                case 131: {
                    message = "CONTENT_KEY_DECRYPT_ERROR: " + payload.error;
                    break;
                }
                case 141: {
                    message = "USER_KEY_CHECK_INVALID: " + payload.error;
                    break;
                }
                case 151: {
                    message = "CONTENT_DECRYPT_ERROR: " + payload.error;
                    break;
                }
                default: {
                    message = "Unknown error?! " + payload.error;
                }
            }
        }

        setTimeout(() => {
            showLcpDialog(message);
        }, 500);

        // DRMErrorCode (from r2-lcp-client)
        // 1 === NO CORRECT PASSPHRASE / UERKEY IN GIVEN ARRAY
        //     // No error
        //     NONE = 0,
        //     /**
        //         WARNING ERRORS > 10
        //     **/
        //     // License is out of date (check start and end date)
        //     LICENSE_OUT_OF_DATE = 11,
        //     /**
        //         CRITICAL ERRORS > 100
        //     **/
        //     // Certificate has been revoked in the CRL
        //     CERTIFICATE_REVOKED = 101,
        //     // Certificate has not been signed by CA
        //     CERTIFICATE_SIGNATURE_INVALID = 102,
        //     // License has been issued by an expired certificate
        //     LICENSE_SIGNATURE_DATE_INVALID = 111,
        //     // License signature does not match
        //     LICENSE_SIGNATURE_INVALID = 112,
        //     // The drm context is invalid
        //     CONTEXT_INVALID = 121,
        //     // Unable to decrypt encrypted content key from user key
        //     CONTENT_KEY_DECRYPT_ERROR = 131,
        //     // User key check invalid
        //     USER_KEY_CHECK_INVALID = 141,
        //     // Unable to decrypt encrypted content from content key
        //     CONTENT_DECRYPT_ERROR = 151
        return;
    }

    if (payload.passSha256Hex) {
        const lcpStore = electronStoreLCP.get("lcp");
        if (!lcpStore) {
            const lcpObj: any = {};
            const pubLcpObj: any = lcpObj[pathDecoded] = {};
            pubLcpObj.sha = payload.passSha256Hex;

            electronStoreLCP.set("lcp", lcpObj);
        } else {
            const pubLcpStore = lcpStore[pathDecoded];
            if (pubLcpStore) {
                pubLcpStore.sha = payload.passSha256Hex;
            } else {
                lcpStore[pathDecoded] = {
                    sha: payload.passSha256Hex,
                };
            }
            electronStoreLCP.set("lcp", lcpStore);
        }

        // if (publicationJsonUrl.indexOf("URL_LCP_PASS_PLACEHOLDER") > 0) {
        //     let pazz = Buffer.from(payload.passSha256Hex).toString("base64");
        //     pazz = encodeURIComponent_RFC3986(pazz);
        //     publicationJsonUrl = publicationJsonUrl.replace("URL_LCP_PASS_PLACEHOLDER", pazz);
        //     console.log(publicationJsonUrl);
        // }
    }

    startNavigatorExperiment();
});

let lcpDialog: any;

function showLcpDialog(message?: string) {

    // dialog.lastFocusedTarget = evt.target;

    const lcpPassHint = document.getElementById("lcpPassHint") as HTMLElement;
    lcpPassHint.textContent = lcpHint;

    if (message) {
        const lcpPassMessage = document.getElementById("lcpPassMessage") as HTMLElement;
        lcpPassMessage.textContent = message;
    }

    lcpDialog.open();
    setTimeout(() => {
        const lcpPassInput = document.getElementById("lcpPassInput") as HTMLElement;
        lcpPassInput.focus();
        setTimeout(() => {
            lcpPassInput.classList.add("no-focus-outline");
        }, 500);
    }, 800);
}

function installKeyboardMouseFocusHandler() {
    let dateLastKeyboardEvent = new Date();
    let dateLastMouseEvent = new Date();

    // // DEBUG
    // document.body.addEventListener("focus", (ev: any) => {
    //     console.log("focus:");
    //     console.log(ev.target);
    //     if (ev.target.tagName.toLowerCase() === "webview") {
    //         console.log("preventing...");
    //         ev.preventDefault();
    //         ev.stopPropagation();
    //     }
    // }, true);
    // document.body.addEventListener("focusin", (ev: any) => {
    //     console.log("focusin:");
    //     console.log(ev.target);
    //     if (ev.target.tagName.toLowerCase() === "webview") {
    //         console.log("preventing...");
    //         ev.preventDefault();
    //         ev.stopPropagation();
    //     }
    // });
    // // DEBUG

    document.body.addEventListener("focusin", debounce((ev: any) => {
        const focusWasTriggeredByMouse = dateLastMouseEvent > dateLastKeyboardEvent;
        if (focusWasTriggeredByMouse) {
            if (ev.target && ev.target.classList) {
                ev.target.classList.add("no-focus-outline");
            }
        }
    }, 500));
    document.body.addEventListener("focusout", (ev: any) => {
        if (ev.target && ev.target.classList) {
            ev.target.classList.remove("no-focus-outline");
        }
    });
    document.body.addEventListener("mousedown", () => {
        dateLastMouseEvent = new Date();
    });
    document.body.addEventListener("keydown", () => {
        dateLastKeyboardEvent = new Date();
    });
}

const initLineHeightSelector = () => {

    const lineHeightSelectorDefault = 150;

    const lineHeightSelectorValue = document.getElementById("lineHeightSelectorValue") as HTMLElement;

    const lineHeightSelector = document.getElementById("lineHeightSelector") as HTMLElement;
    const slider = new (window as any).mdc.slider.MDCSlider(lineHeightSelector);
    (lineHeightSelector as any).mdcSlider = slider;
    // const step = lineHeightSelector.getAttribute("data-step") as string;
    // console.log("step: " + step);
    // slider.step = parseFloat(step);
    // console.log("slider.step: " + slider.step);

    slider.disabled = !electronStore.get("readiumCSSEnable");
    const val = electronStore.get("readiumCSS.lineHeight");
    if (val) {
        slider.value = parseFloat(val) * 100;
    } else {
        slider.value = lineHeightSelectorDefault;
    }
    lineHeightSelectorValue.textContent = slider.value + "%";

    // console.log(slider.min);
    // console.log(slider.max);
    // console.log(slider.value);
    // console.log(slider.step);

    electronStore.onChanged("readiumCSSEnable", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        slider.disabled = !newValue;
    });

    // slider.listen("MDCSlider:input", (event: any) => {
    //     console.log(event.detail.value);
    // });
    slider.listen("MDCSlider:change", (event: any) => {
        electronStore.set("readiumCSS.lineHeight", "" + (event.detail.value / 100));
        lineHeightSelectorValue.textContent = event.detail.value + "%";
    });

    electronStore.onChanged("readiumCSS.lineHeight", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }

        slider.value = (newValue ? (parseFloat(newValue) * 100) : lineHeightSelectorDefault);
        lineHeightSelectorValue.textContent = slider.value + "%";

        refreshReadiumCSS();
    });
};

const initPageMarginSelector = () => {

    const pageMarginsSelectorDefault = 100;

    const pageMarginsSelectorValue = document.getElementById("pageMarginsSelectorValue") as HTMLElement;

    const pageMarginsSelector = document.getElementById("pageMarginsSelector") as HTMLElement;
    const slider = new (window as any).mdc.slider.MDCSlider(pageMarginsSelector);
    (pageMarginsSelector as any).mdcSlider = slider;
    // const step = pageMarginsSelector.getAttribute("data-step") as string;
    // console.log("step: " + step);
    // slider.step = parseFloat(step);
    // console.log("slider.step: " + slider.step);

    slider.disabled = !electronStore.get("readiumCSSEnable");
    const val = electronStore.get("readiumCSS.pageMargins");
    if (val) {
        slider.value = parseFloat(val) * 100;
    } else {
        slider.value = pageMarginsSelectorDefault;
    }
    pageMarginsSelectorValue.textContent = slider.value + "%";

    // console.log(slider.min);
    // console.log(slider.max);
    // console.log(slider.value);
    // console.log(slider.step);

    electronStore.onChanged("readiumCSSEnable", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        slider.disabled = !newValue;
    });

    // slider.listen("MDCSlider:input", (event: any) => {
    //     console.log(event.detail.value);
    // });
    slider.listen("MDCSlider:change", (event: any) => {
        electronStore.set("readiumCSS.pageMargins", "" + (event.detail.value / 100));
        pageMarginsSelectorValue.textContent = event.detail.value + "%";
    });

    electronStore.onChanged("readiumCSS.pageMargins", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }

        slider.value = (newValue ? (parseFloat(newValue) * 100) : pageMarginsSelectorDefault);
        pageMarginsSelectorValue.textContent = slider.value + "%";

        refreshReadiumCSS();
    });
};

const initTypeScaleSelector = () => {

    const typeScaleSelectorDefault = 120;

    const typeScaleSelectorValue = document.getElementById("typeScaleSelectorValue") as HTMLElement;

    const typeScaleSelector = document.getElementById("typeScaleSelector") as HTMLElement;
    const slider = new (window as any).mdc.slider.MDCSlider(typeScaleSelector);
    (typeScaleSelector as any).mdcSlider = slider;
    // const step = typeScaleSelector.getAttribute("data-step") as string;
    // console.log("step: " + step);
    // slider.step = parseFloat(step);
    // console.log("slider.step: " + slider.step);

    slider.disabled = !electronStore.get("readiumCSSEnable");
    const val = electronStore.get("readiumCSS.typeScale");
    if (val) {
        slider.value = parseFloat(val) * 100;
    } else {
        slider.value = typeScaleSelectorDefault;
    }
    typeScaleSelectorValue.textContent = slider.value + "%";

    // console.log(slider.min);
    // console.log(slider.max);
    // console.log(slider.value);
    // console.log(slider.step);

    electronStore.onChanged("readiumCSSEnable", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        slider.disabled = !newValue;
    });

    // slider.listen("MDCSlider:input", (event: any) => {
    //     console.log(event.detail.value);
    // });
    slider.listen("MDCSlider:change", (event: any) => {
        electronStore.set("readiumCSS.typeScale", "" + (event.detail.value / 100));
        typeScaleSelectorValue.textContent = event.detail.value + "%";
    });

    electronStore.onChanged("readiumCSS.typeScale", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }

        slider.value = (newValue ? (parseFloat(newValue) * 100) : typeScaleSelectorDefault);
        typeScaleSelectorValue.textContent = slider.value + "%";

        refreshReadiumCSS();
    });
};

const initLetterSpacingSelector = () => {

    const letterSpacingSelectorDefault = 0;

    const letterSpacingSelectorValue = document.getElementById("letterSpacingSelectorValue") as HTMLElement;

    const letterSpacingSelector = document.getElementById("letterSpacingSelector") as HTMLElement;
    const slider = new (window as any).mdc.slider.MDCSlider(letterSpacingSelector);
    (letterSpacingSelector as any).mdcSlider = slider;
    // const step = letterSpacingSelector.getAttribute("data-step") as string;
    // console.log("step: " + step);
    // slider.step = parseFloat(step);
    // console.log("slider.step: " + slider.step);

    slider.disabled = !electronStore.get("readiumCSSEnable");
    const val = electronStore.get("readiumCSS.letterSpacing");
    if (val) {
        slider.value = parseFloat(val.replace("rem", "")) * 100;
    } else {
        slider.value = letterSpacingSelectorDefault;
    }
    letterSpacingSelectorValue.textContent = (slider.value / 100).toFixed(2) + "rem";

    // console.log(slider.min);
    // console.log(slider.max);
    // console.log(slider.value);
    // console.log(slider.step);

    electronStore.onChanged("readiumCSSEnable", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        slider.disabled = !newValue;
    });

    // slider.listen("MDCSlider:input", (event: any) => {
    //     console.log(event.detail.value);
    // });
    slider.listen("MDCSlider:change", (event: any) => {
        electronStore.set("readiumCSS.letterSpacing", (event.detail.value / 100) + "rem");
        letterSpacingSelectorValue.textContent = (event.detail.value / 100).toFixed(2) + "rem";
    });

    electronStore.onChanged("readiumCSS.letterSpacing", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }

        slider.value = (newValue ? (parseFloat(newValue.replace("rem", "")) * 100) : letterSpacingSelectorDefault);
        letterSpacingSelectorValue.textContent = (slider.value / 100).toFixed(2) + "rem";

        refreshReadiumCSS();
    });
};

const initWordSpacingSelector = () => {

    const wordSpacingSelectorDefault = 0;

    const wordSpacingSelectorValue = document.getElementById("wordSpacingSelectorValue") as HTMLElement;

    const wordSpacingSelector = document.getElementById("wordSpacingSelector") as HTMLElement;
    const slider = new (window as any).mdc.slider.MDCSlider(wordSpacingSelector);
    (wordSpacingSelector as any).mdcSlider = slider;
    // const step = wordSpacingSelector.getAttribute("data-step") as string;
    // console.log("step: " + step);
    // slider.step = parseFloat(step);
    // console.log("slider.step: " + slider.step);

    slider.disabled = !electronStore.get("readiumCSSEnable");
    const val = electronStore.get("readiumCSS.wordSpacing");
    if (val) {
        slider.value = parseFloat(val.replace("rem", "")) * 100;
    } else {
        slider.value = wordSpacingSelectorDefault;
    }
    wordSpacingSelectorValue.textContent = (slider.value / 100).toFixed(2) + "rem";

    // console.log(slider.min);
    // console.log(slider.max);
    // console.log(slider.value);
    // console.log(slider.step);

    electronStore.onChanged("readiumCSSEnable", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        slider.disabled = !newValue;
    });

    // slider.listen("MDCSlider:input", (event: any) => {
    //     console.log(event.detail.value);
    // });
    slider.listen("MDCSlider:change", (event: any) => {
        electronStore.set("readiumCSS.wordSpacing", (event.detail.value / 100) + "rem");
        wordSpacingSelectorValue.textContent = (event.detail.value / 100).toFixed(2) + "rem";
    });

    electronStore.onChanged("readiumCSS.wordSpacing", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }

        slider.value = (newValue ? (parseFloat(newValue.replace("rem", "")) * 100) : wordSpacingSelectorDefault);
        wordSpacingSelectorValue.textContent = (slider.value / 100).toFixed(2) + "rem";

        refreshReadiumCSS();
    });
};

const initParaSpacingSelector = () => {

    const paraSpacingSelectorDefault = 0;

    const paraSpacingSelectorValue = document.getElementById("paraSpacingSelectorValue") as HTMLElement;

    const paraSpacingSelector = document.getElementById("paraSpacingSelector") as HTMLElement;
    const slider = new (window as any).mdc.slider.MDCSlider(paraSpacingSelector);
    (paraSpacingSelector as any).mdcSlider = slider;
    // const step = paraSpacingSelector.getAttribute("data-step") as string;
    // console.log("step: " + step);
    // slider.step = parseFloat(step);
    // console.log("slider.step: " + slider.step);

    slider.disabled = !electronStore.get("readiumCSSEnable");
    const val = electronStore.get("readiumCSS.paraSpacing");
    if (val) {
        slider.value = parseFloat(val.replace("rem", "")) * 100;
    } else {
        slider.value = paraSpacingSelectorDefault;
    }
    paraSpacingSelectorValue.textContent = (slider.value / 100).toFixed(2) + "rem";

    // console.log(slider.min);
    // console.log(slider.max);
    // console.log(slider.value);
    // console.log(slider.step);

    electronStore.onChanged("readiumCSSEnable", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        slider.disabled = !newValue;
    });

    // slider.listen("MDCSlider:input", (event: any) => {
    //     console.log(event.detail.value);
    // });
    slider.listen("MDCSlider:change", (event: any) => {
        electronStore.set("readiumCSS.paraSpacing", (event.detail.value / 100) + "rem");
        paraSpacingSelectorValue.textContent = (event.detail.value / 100).toFixed(2) + "rem";
    });

    electronStore.onChanged("readiumCSS.paraSpacing", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }

        slider.value = (newValue ? (parseFloat(newValue.replace("rem", "")) * 100) : paraSpacingSelectorDefault);
        paraSpacingSelectorValue.textContent = (slider.value / 100).toFixed(2) + "rem";

        refreshReadiumCSS();
    });
};

const initParaIndentSelector = () => {

    const paraIndentSelectorDefault = 200;

    const paraIndentSelectorValue = document.getElementById("paraIndentSelectorValue") as HTMLElement;

    const paraIndentSelector = document.getElementById("paraIndentSelector") as HTMLElement;
    const slider = new (window as any).mdc.slider.MDCSlider(paraIndentSelector);
    (paraIndentSelector as any).mdcSlider = slider;
    // const step = paraIndentSelector.getAttribute("data-step") as string;
    // console.log("step: " + step);
    // slider.step = parseFloat(step);
    // console.log("slider.step: " + slider.step);

    slider.disabled = !electronStore.get("readiumCSSEnable");
    const val = electronStore.get("readiumCSS.paraIndent");
    if (val) {
        slider.value = parseFloat(val.replace("rem", "")) * 100;
    } else {
        slider.value = paraIndentSelectorDefault;
    }
    paraIndentSelectorValue.textContent = (slider.value / 100).toFixed(2) + "rem";

    // console.log(slider.min);
    // console.log(slider.max);
    // console.log(slider.value);
    // console.log(slider.step);

    electronStore.onChanged("readiumCSSEnable", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        slider.disabled = !newValue;
    });

    // slider.listen("MDCSlider:input", (event: any) => {
    //     console.log(event.detail.value);
    // });
    slider.listen("MDCSlider:change", (event: any) => {
        electronStore.set("readiumCSS.paraIndent", (event.detail.value / 100) + "rem");
        paraIndentSelectorValue.textContent = (event.detail.value / 100).toFixed(2) + "rem";
    });

    electronStore.onChanged("readiumCSS.paraIndent", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }

        slider.value = (newValue ? (parseFloat(newValue.replace("rem", "")) * 100) : paraIndentSelectorDefault);
        paraIndentSelectorValue.textContent = (slider.value / 100).toFixed(2) + "rem";

        refreshReadiumCSS();
    });
};

const initFontSizeSelector = () => {

    const fontSizeSelectorDefault = 100;

    const fontSizeSelectorValue = document.getElementById("fontSizeSelectorValue") as HTMLElement;

    const fontSizeSelector = document.getElementById("fontSizeSelector") as HTMLElement;
    const slider = new (window as any).mdc.slider.MDCSlider(fontSizeSelector);
    (fontSizeSelector as any).mdcSlider = slider;

    // const drawerElement = document.getElementById("drawer") as HTMLElement;
    // const funcClose = () => {
    //     drawerElement.removeEventListener("MDCTemporaryDrawer:close", funcClose);
    //     console.log("MDCTemporaryDrawer:close");

    //     const funcOpen = () => {
    //         drawerElement.removeEventListener("MDCTemporaryDrawer:open", funcOpen);
    //         console.log("MDCTemporaryDrawer:open");

    //         setTimeout(() => {
    //             console.log("SLIDER LAYOUT");
    //             slider.layout();
    //         }, 1000);
    //     };
    //     drawerElement.addEventListener("MDCTemporaryDrawer:open", funcOpen);
    // };
    // drawerElement.addEventListener("MDCTemporaryDrawer:close", funcClose);

    slider.disabled = !electronStore.get("readiumCSSEnable");
    const val = electronStore.get("readiumCSS.fontSize");
    if (val) {
        slider.value = parseInt(val.replace("%", ""), 10);
    } else {
        slider.value = fontSizeSelectorDefault;
    }
    fontSizeSelectorValue.textContent = slider.value + "%";

    // console.log(slider.min);
    // console.log(slider.max);
    // console.log(slider.value);
    // console.log(slider.step);

    electronStore.onChanged("readiumCSSEnable", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        slider.disabled = !newValue;
    });

    // slider.listen("MDCSlider:input", (event: any) => {
    //     console.log(event.detail.value);
    // });
    slider.listen("MDCSlider:change", (event: any) => {
        // console.log(event.detail.value);
        const percent = event.detail.value + "%";
        electronStore.set("readiumCSS.fontSize", percent);
        fontSizeSelectorValue.textContent = percent;
    });

    electronStore.onChanged("readiumCSS.fontSize", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }

        slider.value = (newValue ? (parseInt(newValue.replace("%", ""), 10)) : fontSizeSelectorDefault);
        fontSizeSelectorValue.textContent = slider.value + "%";

        refreshReadiumCSS();
    });
};

const initTextColorSelector = () => {
    initColorSelector("textColor", "Text colour");
};

const initBackgroundColorSelector = () => {
    initColorSelector("backgroundColor", "Background colour");
};

const initColorSelector = (who: string, label: string) => {
    const ID_PREFIX = who + "Select_";

    const options: IRiotOptsMenuSelectItem[] = [];
    options.push({
        id: ID_PREFIX,
        label: "default",
    });
    Object.keys(HTML_COLORS).forEach((colorName) => {
        const colorCode = (HTML_COLORS as any)[colorName];
        options.push({
            id: ID_PREFIX + colorName,
            label: colorName,
            style: `border: 10px solid ${colorCode};`,
        });
    });

    const currentColorCode = electronStore.get("readiumCSS." + who);
    let foundColorName: string | undefined;
    const colorNames = Object.keys(HTML_COLORS);
    for (const colorName of colorNames) {
        const colorCode = (HTML_COLORS as any)[colorName];
        if (currentColorCode === colorCode) {
            foundColorName = colorName;
            break;
        }
    }
    let selectedID = ID_PREFIX;
    if (foundColorName) {
        selectedID = ID_PREFIX + foundColorName;
    }

    const foundItem = options.find((item) => {
        return item.id === selectedID;
    });
    if (!foundItem) {
        selectedID = options[0].id;
    }
    const opts: IRiotOptsMenuSelect = {
        disabled: !electronStore.get("readiumCSSEnable"),
        label,
        options,
        selected: selectedID,
    };
    const tag = riotMountMenuSelect("#" + who + "Select", opts)[0] as IRiotTagMenuSelect;

    tag.on("selectionChanged", (index: number) => {
        if (!index) {
            electronStore.set("readiumCSS." + who, null);
            return;
        }
        // console.log("selectionChanged");
        // console.log(index);
        const id = tag.getIdForIndex(index);
        // console.log(id);
        if (!id) {
            return;
        }
        // const element = tag.root.ownerDocument.getElementById(val) as HTMLElement;
        //     console.log(element.textContent);
        const colorName = id.replace(ID_PREFIX, "");
        // console.log(id);
        const colorCode = (HTML_COLORS as any)[colorName] || undefined;
        electronStore.set("readiumCSS." + who, colorCode);
    });

    function updateLabelColor(colorCode: string | undefined) {
        if (tag.root) {
            const labelText = tag.root.querySelector(".mdc-select__selected-text");
            if (labelText) {
                (labelText as HTMLElement).style.border = colorCode ? `6px solid ${colorCode}` : "none";
            }
        }
    }

    electronStore.onChanged("readiumCSS." + who, (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        // console.log("onDidChange");
        // console.log(newValue);

        updateLabelColor(newValue);

        let foundColor: string | undefined;
        if (newValue) {
            const colNames = Object.keys(HTML_COLORS);
            for (const colName of colNames) {
                const colCode = (HTML_COLORS as any)[colName];
                if (newValue === colCode) {
                    foundColor = colName;
                    break;
                }
            }
        }
        if (foundColor) {
            tag.setSelectedItem(ID_PREFIX + foundColor);
        } else {
            tag.setSelectedItem(ID_PREFIX);
        }

        refreshReadiumCSS();
    });

    electronStore.onChanged("readiumCSSEnable", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        tag.setDisabled(!newValue);
    });

    updateLabelColor(electronStore.get("readiumCSS." + who));
};

const initFontSelector = () => {

    const ID_PREFIX = "fontselect_";

    const options: IRiotOptsMenuSelectItem[] =
        [{
            id: ID_PREFIX + "DEFAULT",
            label: "Default font",
        }, {
            id: ID_PREFIX + "OLD",
            label: "Old Style",
            style: "font-family: \"Iowan Old Style\", \"Sitka Text\", Palatino, \"Book Antiqua\", serif;",
        }, {
            id: ID_PREFIX + "MODERN",
            label: "Modern",
            style: "font-family: Athelas, Constantia, Georgia, serif;",
        }, {
            id: ID_PREFIX + "SANS",
            label: "Sans",
            style: "font-family: -apple-system, system-ui, BlinkMacSystemFont," +
                " \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif;",
        }, {
            id: ID_PREFIX + "HUMAN",
            label: "Humanist",
            style: "font-family: Seravek, Calibri, Roboto, Arial, sans-serif;",
        }, {
            id: ID_PREFIX + "DYS",
            label: "Readable (dys)",
            style: "font-family: AccessibleDfa;",
        }, {
            id: ID_PREFIX + "DUO",
            label: "Duospace",
            style: "font-family: \"IA Writer Duospace\", Consolas, monospace;",
        }, {
            id: ID_PREFIX + "MONO",
            label: "Monospace",
            style: "font-family: \"Andale Mono\", Consolas, monospace;",
        }];
    let selectedID = ID_PREFIX + electronStore.get("readiumCSS.font");
    const foundItem = options.find((item) => {
        return item.id === selectedID;
    });
    if (!foundItem) {
        selectedID = options[0].id;
    }
    const opts: IRiotOptsMenuSelect = {
        disabled: !electronStore.get("readiumCSSEnable"),
        label: "Font name",
        options,
        selected: selectedID,
    };
    const tag = riotMountMenuSelect("#fontSelect", opts)[0] as IRiotTagMenuSelect;

    tag.on("selectionChanged", (index: number) => {
        // console.log("selectionChanged");
        // console.log(index);
        let id = tag.getIdForIndex(index);
        // console.log(id);
        if (!id) {
            return;
        }
        // const element = tag.root.ownerDocument.getElementById(val) as HTMLElement;
        //     console.log(element.textContent);
        id = id.replace(ID_PREFIX, "");
        // console.log(id);
        electronStore.set("readiumCSS.font", id);
    });

    function updateLabelFont(newValue: string) {
        if (tag.root) {
            const label = tag.root.querySelector(".mdc-select__selected-text");
            if (label) {
                let fontFamily: string | undefined = newValue;
                if (fontFamily === "DEFAULT") {
                    fontFamily = undefined;
                } else if (fontFamily === "DUO") {
                    // fontFamily = "IA Writer Duospace";
                } else if (fontFamily === "DYS") {
                    // fontFamily = "AccessibleDfa";
                } else if (fontFamily === "OLD") {
                    // fontFamily = options[1].style; // "oldStyleTf";
                } else if (fontFamily === "MODERN") {
                    // fontFamily = options[2].style; // "modernTf";
                } else if (fontFamily === "SANS") {
                    // fontFamily = "sansTf";
                } else if (fontFamily === "HUMAN") {
                    // fontFamily = "humanistTf";
                } else if (fontFamily === "MONO") {
                    // fontFamily = "monospaceTf";
                } else if (fontFamily === "JA") {
                    // fontFamily = "serif-ja";
                } else if (fontFamily === "JA-SANS") {
                    // fontFamily = "sans-serif-ja";
                } else if (fontFamily === "JA-V") {
                    // fontFamily = "serif-ja-v";
                } else if (fontFamily === "JA_V_SANS") {
                    // fontFamily = "sans-serif-ja-v";
                } else {
                    (label as HTMLElement).style.fontFamily = fontFamily;
                    return;
                }
                if (!fontFamily) {
                    label.removeAttribute("style");
                } else {
                    const idToFind = ID_PREFIX + newValue;
                    const optionFound = options.find((item) => {
                        return item.id === idToFind;
                    });
                    if (!optionFound || !optionFound.style) {
                        label.removeAttribute("style");
                        return;
                    }
                    label.setAttribute("style", optionFound.style);
                }
            }
        }
    }

    electronStore.onChanged("readiumCSS.font", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        // console.log("onDidChange");
        // console.log(newValue);
        tag.setSelectedItem(ID_PREFIX + newValue);

        updateLabelFont(newValue);

        refreshReadiumCSS();
    });

    electronStore.onChanged("readiumCSSEnable", (newValue: any, oldValue: any) => {
        if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
            return;
        }
        tag.setDisabled(!newValue);
    });

    setTimeout(async () => {

        let _sysFonts: string[] = [];
        const systemFonts = new SystemFonts.default();
        // const sysFonts = systemFonts.getFontsSync();
        try {
            _sysFonts = await systemFonts.getFonts();
            // console.log(_sysFonts);
        } catch (err) {
            console.log(err);
        }
        if (_sysFonts && _sysFonts.length) {
            const arr = ((tag.opts as IRiotOptsMenuSelect).options as IRiotOptsMenuSelectItem[]);
            const divider: IRiotOptsMenuSelectItem = {
                id: ID_PREFIX + "_",
                label: "_",
            };
            arr.push(divider);
            _sysFonts.forEach((sysFont) => {
                if (sysFont.startsWith(".")) {
                    return;
                }
                const option: IRiotOptsMenuSelectItem = {
                    id: ID_PREFIX + sysFont, // .replace(/ /g, "_"),
                    label: sysFont,
                    style: "font-family: " + sysFont + ";",
                };
                arr.push(option);
            });
            let newSelectedID = ID_PREFIX + electronStore.get("readiumCSS.font");
            const newFoundItem = options.find((item) => {
                return item.id === newSelectedID;
            });
            if (!newFoundItem) {
                newSelectedID = arr[0].id;
            }
            (tag.opts as IRiotOptsMenuSelect).selected = newSelectedID;
            tag.update();
        }

        updateLabelFont(electronStore.get("readiumCSS.font"));
    }, 100);
};

// window.addEventListener("load", () => {
// });

window.addEventListener("DOMContentLoaded", () => {

    setupDragDrop();

    (window as any).mdc.menu.MDCMenuFoundation.numbers.TRANSITION_DURATION_MS = 200;

    // TODO this seems to hijack MDC slider thumb change
    window.document.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (drawer.open) {
            return;
        }
        if ((ev.target as any).mdcSlider) {
            return;
        }

        if (ev.keyCode === 37) { // left
            navLeftOrRight(true);
        } else if (ev.keyCode === 39) { // right
            navLeftOrRight(false);
        }
    });

    setTimeout(() => {
        // material-components-web
        (window as any).mdc.autoInit();
    }, 500);

    window.document.title = "Readium2 [ " + pathFileName + "]";

    const h1 = document.getElementById("pubTitle") as HTMLElement;
    h1.textContent = pathFileName;

    installKeyboardMouseFocusHandler();

    // TODO DARK THEME
    // if (electronStore.get("readiumCSS.night")) {
    //     document.body.classList.add("mdc-theme--dark");
    // } else {
    //     document.body.classList.remove("mdc-theme--dark");
    // }

    const drawerElement = document.getElementById("drawer") as HTMLElement;
    drawer = new (window as any).mdc.drawer.MDCDrawer(drawerElement);
    (drawerElement as any).mdcTemporaryDrawer = drawer;
    const drawerButton = document.getElementById("drawerButton") as HTMLElement;
    drawerButton.addEventListener("click", () => {
        drawer.open = true;
    });
    // drawerElement.addEventListener("click", (ev) => {
    //     const allMenus = drawerElement.querySelectorAll(".mdc-menu");
    //     const openedMenus: Node[] = [];
    //     allMenus.forEach((elem) => {
    //         if ((elem as any).mdcSimpleMenu && (elem as any).mdcSimpleMenu.open) {
    //             openedMenus.push(elem);
    //         }
    //     });

    //     let needsToCloseMenus = true;
    //     let currElem: Node | null = ev.target as Node;
    //     while (currElem) {
    //         if (openedMenus.indexOf(currElem) >= 0) {
    //             needsToCloseMenus = false;
    //             break;
    //         }
    //         currElem = currElem.parentNode;
    //     }
    //     if (needsToCloseMenus) {
    //         openedMenus.forEach((elem) => {
    //             (elem as any).mdcSimpleMenu.open = false;
    //             let ss = (elem.parentNode as HTMLElement).querySelector(".mdc-select__selected-text");
    //             if (ss) {
    //                 (ss as HTMLElement).style.transform = "initial";
    //                 (ss as HTMLElement).style.opacity = "1";
    //                 (ss as HTMLElement).focus();
    //             }
    //             ss = (elem.parentNode as HTMLElement).querySelector(".mdc-select__label");
    //             if (ss) {
    //                 (ss as HTMLElement).style.transform = "initial";
    //                 (ss as HTMLElement).style.opacity = "1";
    //                 (ss as HTMLElement).focus();
    //             }
    //         });
    //     } else {
    //         console.log("NOT CLOSING MENU");
    //     }
    // }, true);

    initTextColorSelector();
    initBackgroundColorSelector();
    initFontSelector();
    initFontSizeSelector();
    initLineHeightSelector();
    initTypeScaleSelector();
    initPageMarginSelector();
    initWordSpacingSelector();
    initParaSpacingSelector();
    initParaIndentSelector();
    initLetterSpacingSelector();

    // const nightSwitch = document.getElementById("night_switch-input") as HTMLInputElement;
    const nightSwitchEl = document.getElementById("night_switch") as HTMLElement;
    const nightSwitch = new (window as any).mdc.switchControl.MDCSwitch(nightSwitchEl);
    (nightSwitchEl as any).mdcSwitch = nightSwitch;
    nightSwitch.checked = electronStore.get("readiumCSS.night");

    const nightDiv = document.getElementById("night_div") as HTMLElement;
    nightDiv.style.display = nightSwitch.checked ? "block" : "none";

    nightSwitchEl.addEventListener("change", (_event: any) => {
        // nightSwitch.handleChange("change", (_event: any) => {
        const checked = nightSwitch.checked;
        electronStore.set("readiumCSS.night", checked);
    });
    nightSwitch.disabled = !electronStore.get("readiumCSSEnable");

    const sepiaSwitchEl = document.getElementById("sepia_switch") as HTMLElement;
    const sepiaSwitch = new (window as any).mdc.switchControl.MDCSwitch(sepiaSwitchEl);
    (sepiaSwitchEl as any).mdcSwitch = sepiaSwitch;
    sepiaSwitch.checked = electronStore.get("readiumCSS.sepia");
    sepiaSwitchEl.addEventListener("change", (_event: any) => {
        const checked = sepiaSwitch.checked;
        electronStore.set("readiumCSS.sepia", checked);
    });
    sepiaSwitch.disabled = !electronStore.get("readiumCSSEnable");

    const invertSwitchEl = document.getElementById("invert_switch") as HTMLElement;
    const invertSwitch = new (window as any).mdc.switchControl.MDCSwitch(invertSwitchEl);
    (invertSwitchEl as any).mdcSwitch = invertSwitch;
    invertSwitch.checked = electronStore.get("readiumCSS.invert");
    invertSwitchEl.addEventListener("change", (_event: any) => {
        const checked = invertSwitch.checked;
        electronStore.set("readiumCSS.invert", checked);
    });
    invertSwitch.disabled = !nightSwitch.checked || !electronStore.get("readiumCSSEnable");

    const darkenSwitchEl = document.getElementById("darken_switch") as HTMLElement;
    const darkenSwitch = new (window as any).mdc.switchControl.MDCSwitch(darkenSwitchEl);
    (darkenSwitchEl as any).mdcSwitch = darkenSwitch;
    darkenSwitch.checked = electronStore.get("readiumCSS.darken");
    darkenSwitchEl.addEventListener("change", (_event: any) => {
        const checked = darkenSwitch.checked;
        electronStore.set("readiumCSS.darken", checked);
    });
    darkenSwitch.disabled = !nightSwitch.checked || !electronStore.get("readiumCSSEnable");

    // const justifySwitch = document.getElementById("justify_switch-input") as HTMLInputElement;
    const justifySwitchEl = document.getElementById("justify_switch") as HTMLElement;
    const justifySwitch = new (window as any).mdc.switchControl.MDCSwitch(justifySwitchEl);
    (justifySwitchEl as any).mdcSwitch = justifySwitch;
    justifySwitch.checked = electronStore.get("readiumCSS.textAlign") === "justify";
    justifySwitchEl.addEventListener("change", (_event: any) => {
        // justifySwitch.handleChange("change", (_event: any) => {
        const checked = justifySwitch.checked;
        electronStore.set("readiumCSS.textAlign", checked ? "justify" : "initial");
    });
    justifySwitch.disabled = !electronStore.get("readiumCSSEnable");

    // const footnotesSwitch = document.getElementById("footnotes_switch-input") as HTMLInputElement;
    const footnotesSwitchEl = document.getElementById("footnotes_switch") as HTMLElement;
    const footnotesSwitch = new (window as any).mdc.switchControl.MDCSwitch(footnotesSwitchEl);
    (footnotesSwitchEl as any).mdcSwitch = footnotesSwitch;
    footnotesSwitch.checked = electronStore.get("readiumCSS.noFootnotes") ? false : true;
    footnotesSwitchEl.addEventListener("change", (_event: any) => {
        // footnotesSwitch.handleChange("change", (_event: any) => {
        const checked = footnotesSwitch.checked;
        electronStore.set("readiumCSS.noFootnotes", checked ? false : true);
    });
    footnotesSwitch.disabled = !electronStore.get("readiumCSSEnable");

    // const reduceMotionSwitch = document.getElementById("reduceMotion_switch-input") as HTMLInputElement;
    const reduceMotionSwitchEl = document.getElementById("reduceMotion_switch") as HTMLElement;
    const reduceMotionSwitch = new (window as any).mdc.switchControl.MDCSwitch(reduceMotionSwitchEl);
    (reduceMotionSwitchEl as any).mdcSwitch = reduceMotionSwitch;
    reduceMotionSwitch.checked = electronStore.get("readiumCSS.reduceMotion") ? true : false;
    reduceMotionSwitchEl.addEventListener("change", (_event: any) => {
        // footnotesSwitch.handleChange("change", (_event: any) => {
        const checked = reduceMotionSwitch.checked;
        electronStore.set("readiumCSS.reduceMotion", checked ? true : false);
    });
    reduceMotionSwitch.disabled = !electronStore.get("readiumCSSEnable");

    // const paginateSwitch = document.getElementById("paginate_switch-input") as HTMLInputElement;
    const paginateSwitchEl = document.getElementById("paginate_switch") as HTMLElement;
    const paginateSwitch = new (window as any).mdc.switchControl.MDCSwitch(paginateSwitchEl);
    (paginateSwitchEl as any).mdcSwitch = paginateSwitch;
    paginateSwitch.checked = electronStore.get("readiumCSS.paged");
    paginateSwitchEl.addEventListener("change", (_event: any) => {
        // paginateSwitch.handleChange("change", (_event: any) => {
        const checked = paginateSwitch.checked;
        electronStore.set("readiumCSS.paged", checked);

        const colCountRadiosEl = document.getElementById("colCountRadios") as HTMLElement;
        if (checked) {
            colCountRadiosEl.style.display = "block";
        } else {
            colCountRadiosEl.style.display = "none";
        }
    });
    paginateSwitch.disabled = !electronStore.get("readiumCSSEnable");

    const colCountRadiosElem = document.getElementById("colCountRadios") as HTMLElement;
    if (paginateSwitch.checked) {
        colCountRadiosElem.style.display = "block";
    } else {
        colCountRadiosElem.style.display = "none";
    }

    const radioColCountAutoEl = document.getElementById("radioColCountAuto") as HTMLInputElement;
    radioColCountAutoEl.checked = electronStore.get("readiumCSS.colCount") === "auto";
    radioColCountAutoEl.addEventListener("change", () => {
        if (radioColCountAutoEl.checked) {
            electronStore.set("readiumCSS.colCount", "auto");
        }
    });
    const radioColCount1El = document.getElementById("radioColCount1") as HTMLInputElement;
    radioColCount1El.checked = electronStore.get("readiumCSS.colCount") === "1";
    radioColCount1El.addEventListener("change", () => {
        if (radioColCount1El.checked) {
            electronStore.set("readiumCSS.colCount", "1");
        }
    });
    const radioColCount2El = document.getElementById("radioColCount2") as HTMLInputElement;
    radioColCount2El.checked = electronStore.get("readiumCSS.colCount") === "2";
    radioColCount2El.addEventListener("change", () => {
        if (radioColCount2El.checked) {
            electronStore.set("readiumCSS.colCount", "2");
        }
    });

    // const readiumcssSwitch = document.getElementById("readiumcss_switch-input") as HTMLInputElement;
    const readiumcssSwitchEl = document.getElementById("readiumcss_switch") as HTMLElement;
    const readiumcssSwitch = new (window as any).mdc.switchControl.MDCSwitch(readiumcssSwitchEl);
    (readiumcssSwitchEl as any).mdcSwitch = readiumcssSwitch;
    readiumcssSwitch.checked = electronStore.get("readiumCSSEnable");
    const stylingWrapper = document.getElementById("stylingWrapper") as HTMLElement;
    stylingWrapper.style.display = readiumcssSwitch.checked ? "block" : "none";
    if (readiumcssSwitch.checked) {
        ensureSliderLayout();
    }
    readiumcssSwitchEl.addEventListener("change", (_event: any) => {
        // readiumcssSwitch.handleChange("change", (_event: any) => {
        const checked = readiumcssSwitch.checked;
        electronStore.set("readiumCSSEnable", checked);
    });

    // const basicSwitch = document.getElementById("nav_basic_switch-input") as HTMLInputElement;
    const basicSwitchEl = document.getElementById("nav_basic_switch") as HTMLElement;
    const basicSwitch = new (window as any).mdc.switchControl.MDCSwitch(basicSwitchEl);
    (basicSwitchEl as any).mdcSwitch = basicSwitch;
    basicSwitch.checked = !electronStore.get("basicLinkTitles");
    basicSwitchEl.addEventListener("change", (_event: any) => {
        // basicSwitch.handleChange("change", (_event: any) => {
        const checked = basicSwitch.checked;
        electronStore.set("basicLinkTitles", !checked);

        setTimeout(() => {
            snackBar.labelText = `Link URLs now ${checked ? "shown" : "hidden"}.`;
            snackBar.actionButtonText = "OK";
            snackBar.open();
        }, 500);
    });

    const snackBarElem = document.getElementById("snackbar") as HTMLElement;
    snackBar = new (window as any).mdc.snackbar.MDCSnackbar(snackBarElem);
    (snackBarElem as any).mdcSnackbar = snackBar;

    //     drawerElement.addEventListener("MDCTemporaryDrawer:open", () => {
    //         console.log("MDCTemporaryDrawer:open");
    //     });
    //     drawerElement.addEventListener("MDCTemporaryDrawer:close", () => {
    //         console.log("MDCTemporaryDrawer:close");
    //     });

    // const menuFactory = (menuEl: HTMLElement) => {
    //     console.log("menuEl:");
    //     console.log(menuEl);
    //     const menu = new (window as any).mdc.menu.MDCMenu(menuEl);
    //     (menuEl as any).mdcSimpleMenu = menu;
    //     return menu;
    // };

    const selectElement = document.getElementById("nav-select") as HTMLElement;
    const navSelector = new (window as any).mdc.select.MDCSelect(selectElement); // , undefined, menuFactory
    (selectElement as any).mdcSelect = navSelector;
    navSelector.listen("MDCSelect:change", (ev: any) => {
        // console.log("MDCSelect:change");
        // console.log(ev);
        // console.log(ev.detail);
        // console.log(ev.detail.index); // ev.detail.selectedIndex
        // console.log(ev.detail.value);

        // console.log(ev.detail.selectedOptions[0].textContent);

        const activePanel = document.querySelector(".tabPanel.active");
        if (activePanel) {
            activePanel.classList.remove("active");
        }
        const newActivePanel = document.querySelector(".tabPanel:nth-child(" + (ev.detail.index + 1) + ")");
        if (newActivePanel) {
            newActivePanel.classList.add("active");

            const div = document.getElementById("reader_controls_STYLES") as HTMLElement;
            if (newActivePanel === div) {
                ensureSliderLayout();
            }
        }
    });

    const diagElem = document.querySelector("#lcpDialog");
    const lcpPassInput = document.getElementById("lcpPassInput") as HTMLInputElement;
    lcpDialog = new (window as any).mdc.dialog.MDCDialog(diagElem);
    (diagElem as any).mdcDialog = lcpDialog;

    lcpDialog.listen("MDCDialog:opened", () => {
        console.log("MDCDialog:opened");
    });

    lcpDialog.listen("MDCDialog:closed", (event: any) => {
        console.log("MDCDialog:closed");

        if (event.detail.action === "close") {
            console.log("MDCDialog:ACTION:close");

            setTimeout(() => {
                showLcpDialog();
            }, 10);
        } else if (event.detail.action === "accept") {

            console.log("MDCDialog:ACTION:accept");

            const lcpPass = lcpPassInput.value;

            const payload: IEventPayload_R2_EVENT_TRY_LCP_PASS = {
                isSha256Hex: false,
                lcpPass,
                publicationFilePath: pathDecoded,
            };
            ipcRenderer.send(R2_EVENT_TRY_LCP_PASS, payload);
        } else {
            console.log("!! MDCDialog:ACTION:" + event.detail.action);

            setTimeout(() => {
                showLcpDialog();
            }, 10);
        }
    });

    const positionSelector = document.getElementById("positionSelector") as HTMLElement;
    const slider = new (window as any).mdc.slider.MDCSlider(positionSelector);
    (positionSelector as any).mdcSlider = slider;

    slider.listen("MDCSlider:change", (event: any) => {
        const current = getCurrentReadingLocation(); // LocatorExtended
        if (!current) {
            return;
        }

        current.locator.text = undefined;
        current.locator.title = undefined;
        // current.locator.href
        current.locator.locations = {
            cfi: undefined,
            cssSelector: undefined,
            position: undefined,
            progression: event.detail.value / 100,
        };
        handleLinkLocator(current.locator);
    });

    if (lcpPassInput) {
        lcpPassInput.addEventListener("keyup", (ev) => {
            if (ev.keyCode === 13) {
                ev.preventDefault();
                const lcpDialogAcceptButton = document.getElementById("lcpDialogAcceptButton") as HTMLElement;
                lcpDialogAcceptButton.click();
            }
        });
    }

    if (lcpHint) {

        let lcpPassSha256Hex: string | undefined;
        const lcpStore = electronStoreLCP.get("lcp");
        if (lcpStore) {
            const pubLcpStore = lcpStore[pathDecoded];
            if (pubLcpStore && pubLcpStore.sha) {
                lcpPassSha256Hex = pubLcpStore.sha;
            }
        }
        if (lcpPassSha256Hex) {
            const payload: IEventPayload_R2_EVENT_TRY_LCP_PASS = {
                isSha256Hex: true,
                lcpPass: lcpPassSha256Hex,
                publicationFilePath: pathDecoded,
            };
            ipcRenderer.send(R2_EVENT_TRY_LCP_PASS, payload);
        } else {
            showLcpDialog();
        }
    } else {
        startNavigatorExperiment();
    }

    const buttonClearReadingLocations = document.getElementById("buttonClearReadingLocations") as HTMLElement;
    buttonClearReadingLocations.addEventListener("click", () => {
        electronStore.set("readingLocation", {});

        drawer.open = false;
        setTimeout(() => {
            snackBar.labelText = "Reading locations reset.";
            snackBar.actionButtonText = "OK";
            snackBar.open();
        }, 500);
    });

    const buttonClearSettings = document.getElementById("buttonClearSettings") as HTMLElement;
    buttonClearSettings.addEventListener("click", () => {
        // electronStore.clear();
        // electronStore.store = electronStore.getDefaults();
        electronStore.set(undefined, electronStore.getDefaults());

        drawer.open = false;
        setTimeout(() => {
            snackBar.labelText = "Settings reset.";
            snackBar.actionButtonText = "OK";
            snackBar.open();
        }, 500);
    });

    const buttonClearSettingsStyle = document.getElementById("buttonClearSettingsStyle") as HTMLElement;
    buttonClearSettingsStyle.addEventListener("click", () => {

        electronStore.set("readiumCSS", electronStore.getDefaults().readiumCSS);

        // drawer.open = false;
        // setTimeout(() => {
        //     snackBar.labelText = "Default styles.";
        //     snackBar.actionButtonText = "OK";
        //     snackBar.open();
        // }, 500);
    });

    const buttonOpenSettings = document.getElementById("buttonOpenSettings") as HTMLElement;
    buttonOpenSettings.addEventListener("click", () => {
        if ((electronStore as any).reveal) {
            (electronStore as any).reveal();
        }
    });

    const buttonOpenLcpSettings = document.getElementById("buttonOpenLcpSettings") as HTMLElement;
    buttonOpenLcpSettings.addEventListener("click", () => {
        if ((electronStoreLCP as any).reveal) {
            (electronStoreLCP as any).reveal();
        }
        ipcRenderer.send("R2_EVENT_LCP_LSD_OPEN_SETTINGS");
    });

    const buttonLSDRenew = document.getElementById("buttonLSDRenew") as HTMLElement;
    buttonLSDRenew.addEventListener("click", () => {
        const payload: IEventPayload_R2_EVENT_LCP_LSD_RENEW = {
            endDateStr: undefined, // no explicit end date
            publicationFilePath: pathDecoded,
        };
        ipcRenderer.send(R2_EVENT_LCP_LSD_RENEW, payload);

        drawer.open = false;
        setTimeout(() => {
            snackBar.labelText = "LCP LSD renew message sent.";
            snackBar.actionButtonText = "OK";
            snackBar.open();
        }, 500);
    });

    const buttonLSDReturn = document.getElementById("buttonLSDReturn") as HTMLElement;
    buttonLSDReturn.addEventListener("click", () => {
        const payload: IEventPayload_R2_EVENT_LCP_LSD_RETURN = {
            publicationFilePath: pathDecoded,
        };
        ipcRenderer.send(R2_EVENT_LCP_LSD_RETURN, payload);

        drawer.open = false;
        setTimeout(() => {
            snackBar.labelText = "LCP LSD return message sent.";
            snackBar.actionButtonText = "OK";
            snackBar.open();
        }, 500);
    });

    // const buttonDevTools = document.getElementById("buttonDevTools") as HTMLElement;
    //     buttonDevTools.addEventListener("click", () => {
    //         ipcRenderer.send(R2_EVENT_DEVTOOLS, "test");
    //     });

    document.querySelectorAll("#tabsPanels .mdc-switch__native-control").forEach((elem) => {
        elem.addEventListener("focusin", (ev) => {

            // .mdc-switch__thumb-underlay div
            // tslint:disable-next-line:max-line-length
            (((ev.target as HTMLElement).parentElement as HTMLElement).parentElement as HTMLElement).style.setProperty("--mdc-ripple-fg-scale", "1.7");
            // tslint:disable-next-line:max-line-length
            (((ev.target as HTMLElement).parentElement as HTMLElement).parentElement as HTMLElement).style.setProperty("--mdc-ripple-fg-size", "28px");
            // tslint:disable-next-line:max-line-length
            (((ev.target as HTMLElement).parentElement as HTMLElement).parentElement as HTMLElement).style.setProperty("--mdc-ripple-left", "10px");
            // tslint:disable-next-line:max-line-length
            (((ev.target as HTMLElement).parentElement as HTMLElement).parentElement as HTMLElement).style.setProperty("--mdc-ripple-top", "10px");

            // .switchWrap div
            // tslint:disable-next-line:max-line-length
            (((((ev.target as HTMLElement).parentElement as HTMLElement).parentElement as HTMLElement).parentElement as HTMLElement).parentElement as HTMLElement).classList.add("keyboardfocus");
        });
        elem.addEventListener("focusout", (ev) => {
            // .switchWrap div
            // tslint:disable-next-line:max-line-length
            (((((ev.target as HTMLElement).parentElement as HTMLElement).parentNode as HTMLElement).parentNode as HTMLElement).parentNode as HTMLElement).classList.remove("keyboardfocus");
        });
    });
});

ipcRenderer.on(R2_EVENT_LCP_LSD_RENEW_RES, (_event: any, payload: IEventPayload_R2_EVENT_LCP_LSD_RENEW_RES) => {
    console.log("R2_EVENT_LCP_LSD_RENEW_RES");
    console.log(payload.okay);
    console.log(payload.error);
    console.log(payload.lsdJson);
});

ipcRenderer.on(R2_EVENT_LCP_LSD_RETURN_RES, (_event: any, payload: IEventPayload_R2_EVENT_LCP_LSD_RETURN_RES) => {
    console.log("R2_EVENT_LCP_LSD_RETURN_RES");
    console.log(payload.okay);
    console.log(payload.error);
    console.log(payload.lsdJson);
});

function startNavigatorExperiment() {

    const drawerButton = document.getElementById("drawerButton") as HTMLElement;
    drawerButton.focus();

    // tslint:disable-next-line:no-floating-promises
    (async () => {

        let response: Response;
        try {
            // https://github.com/electron/electron/blob/v3.0.0/docs/api/breaking-changes.md#webframe
            // publicationJsonUrl is READIUM2_ELECTRON_HTTP_PROTOCOL (see convertCustomSchemeToHttpUrl)
            // publicationJsonUrl_ is https://127.0.0.1:PORT
            response = await fetch(publicationJsonUrl_);
        } catch (e) {
            console.log(e);
            console.log(publicationJsonUrl_);
            return;
        }
        if (!response.ok) {
            console.log("BAD RESPONSE?!");
        }
        // response.headers.forEach((arg0: any, arg1: any) => {
        //     console.log(arg0 + " => " + arg1);
        // });

        let _publicationJSON: any | undefined;
        try {
            _publicationJSON = await response.json();
        } catch (e) {
            console.log(e);
        }
        if (!_publicationJSON) {
            return;
        }
        // const pubJson = global.JSON.parse(publicationStr);

        // let _publication: Publication | undefined;
        const _publication = TAJSON.deserialize<Publication>(_publicationJSON, Publication);

        if (_publication.Metadata && _publication.Metadata.Title) {
            let title: string | undefined;
            if (typeof _publication.Metadata.Title === "string") {
                title = _publication.Metadata.Title;
            } else {
                const keys = Object.keys(_publication.Metadata.Title as IStringMap);
                if (keys && keys.length) {
                    title = (_publication.Metadata.Title as IStringMap)[keys[0]];
                }
            }

            if (title) {
                const h1 = document.getElementById("pubTitle") as HTMLElement;
                h1.textContent = title;
                h1.setAttribute("title", title);
                h1.addEventListener("click", (_event: any) => {
                    if ((window as any).READIUM2 && (window as any).READIUM2.debug) {
                        (window as any).READIUM2.debug((window as any).READIUM2.DEBUG_VISUALS ? false : true);
                    }
                });
            }
        }

        const buttonttsPLAYPAUSE = document.getElementById("ttsPLAYPAUSE") as HTMLElement;
        buttonttsPLAYPAUSE.addEventListener("MDCIconButtonToggle:change", (event) => {
            // console.log("MDCIconButtonToggle:change");
            // console.log((event as any).detail.isOn);

            if ((event as any).detail.isOn) {
                if (_ttsState === TTSStateEnum.PAUSED) {
                    ttsResume();
                } else {
                    ttsPlay();
                }
            } else {
                ttsPause();
            }
        });
        const mdcButtonttsPLAYPAUSE = new (window as any).mdc.iconButton.MDCIconButtonToggle(buttonttsPLAYPAUSE);
        (buttonttsPLAYPAUSE as any).mdcButton = mdcButtonttsPLAYPAUSE;
        // console.log("(buttonttsPLAYPAUSE as any).mdcButton.on");
        // console.log((buttonttsPLAYPAUSE as any).mdcButton.on);

        // const buttonttsPLAY = document.getElementById("ttsPLAY") as HTMLElement;
        // buttonttsPLAY.addEventListener("click", (_event) => {
        //     ttsPlay();
        // });
        // const buttonttsPAUSE = document.getElementById("ttsPAUSE") as HTMLElement;
        // buttonttsPAUSE.addEventListener("click", (_event) => {
        //     ttsPause();
        // });
        const buttonttsSTOP = document.getElementById("ttsSTOP") as HTMLElement;
        buttonttsSTOP.addEventListener("click", (_event) => {
            ttsStop();
        });
        // const buttonttsRESUME = document.getElementById("ttsRESUME") as HTMLElement;
        // buttonttsRESUME.addEventListener("click", (_event) => {
        //     ttsResume();
        // });
        const buttonttsNEXT = document.getElementById("ttsNEXT") as HTMLElement;
        buttonttsNEXT.addEventListener("click", (_event) => {
            ttsNext();
        });
        const buttonttsPREVIOUS = document.getElementById("ttsPREVIOUS") as HTMLElement;
        buttonttsPREVIOUS.addEventListener("click", (_event) => {
            ttsPrevious();
        });

        // const buttonttsENABLE = document.getElementById("ttsENABLE") as HTMLElement;
        // buttonttsENABLE.addEventListener("click", (_event) => {
        //     ttsEnableToggle();
        // });

        // const buttonttsDISABLE = document.getElementById("ttsDISABLE") as HTMLElement;
        // buttonttsDISABLE.addEventListener("click", (_event) => {
        //     ttsEnableToggle();
        // });

        const buttonttsTOGGLE = document.getElementById("ttsTOGGLE") as HTMLElement;
        buttonttsTOGGLE.addEventListener("MDCIconButtonToggle:change", (_event) => {
            ttsEnableToggle();
        });
        const mdcButtonttsTOGGLE = new (window as any).mdc.iconButton.MDCIconButtonToggle(buttonttsTOGGLE);
        (buttonttsTOGGLE as any).mdcButton = mdcButtonttsTOGGLE;

        let _ttsState: TTSStateEnum | undefined;
        refreshTtsUiState();

        ttsListen((ttsState: TTSStateEnum) => {
            if (!_ttsEnabled) {
                return;
            }
            _ttsState = ttsState;
            refreshTtsUiState();
        });

        function refreshTtsUiState() {
            if (_ttsState === TTSStateEnum.PAUSED) {
                // console.log("refreshTtsUiState _ttsState === TTSStateEnum.PAUSED");
                // console.log((buttonttsPLAYPAUSE as any).mdcButton.on);
                (buttonttsPLAYPAUSE as any).mdcButton.on = false;
                // buttonttsPLAY.style.display = "none";
                // buttonttsRESUME.style.display = "inline-block";
                // buttonttsPAUSE.style.display = "none";
                buttonttsPLAYPAUSE.style.display = "inline-block";
                buttonttsSTOP.style.display = "inline-block";
                buttonttsPREVIOUS.style.display = "inline-block";
                buttonttsNEXT.style.display = "inline-block";
            } else if (_ttsState === TTSStateEnum.STOPPED) {
                // console.log("refreshTtsUiState _ttsState === TTSStateEnum.STOPPED");
                // console.log((buttonttsPLAYPAUSE as any).mdcButton.on);
                (buttonttsPLAYPAUSE as any).mdcButton.on = false;
                // buttonttsPLAY.style.display = "inline-block";
                // buttonttsRESUME.style.display = "none";
                // buttonttsPAUSE.style.display = "none";
                buttonttsPLAYPAUSE.style.display = "inline-block";
                buttonttsSTOP.style.display = "none";
                buttonttsPREVIOUS.style.display = "none";
                buttonttsNEXT.style.display = "none";
            } else if (_ttsState === TTSStateEnum.PLAYING) {
                // console.log("refreshTtsUiState _ttsState === TTSStateEnum.PLAYING");
                // console.log((buttonttsPLAYPAUSE as any).mdcButton.on);
                (buttonttsPLAYPAUSE as any).mdcButton.on = true;
                // buttonttsPLAY.style.display = "none";
                // buttonttsRESUME.style.display = "none";
                // buttonttsPAUSE.style.display = "inline-block";
                buttonttsPLAYPAUSE.style.display = "inline-block";
                buttonttsSTOP.style.display = "inline-block";
                buttonttsPREVIOUS.style.display = "inline-block";
                buttonttsNEXT.style.display = "inline-block";
            } else {
                // console.log("refreshTtsUiState _ttsState === undefined");
                // console.log((buttonttsPLAYPAUSE as any).mdcButton.on);
                (buttonttsPLAYPAUSE as any).mdcButton.on = false;
                // buttonttsPLAY.style.display = "none";
                // buttonttsRESUME.style.display = "none";
                // buttonttsPAUSE.style.display = "none";
                buttonttsPLAYPAUSE.style.display = "none";
                buttonttsSTOP.style.display = "none";
                buttonttsPREVIOUS.style.display = "none";
                buttonttsNEXT.style.display = "none";
            }
        }

        // buttonttsDISABLE.style.display = "none";
        let _ttsEnabled = false;
        function ttsEnableToggle() {
            if (_ttsEnabled) {
                // buttonttsENABLE.style.display = "inline-block";
                // buttonttsDISABLE.style.display = "none";
                ttsClickEnable(false);
                _ttsEnabled = false;
                _ttsState = undefined;
                refreshTtsUiState();
                ttsStop();
            } else {
                // buttonttsENABLE.style.display = "none";
                // buttonttsDISABLE.style.display = "inline-block";
                ttsClickEnable(true);
                _ttsEnabled = true;
                _ttsState = TTSStateEnum.STOPPED;
                refreshTtsUiState();
                ttsStop();
            }
        }

        const buttonNavLeft = document.getElementById("buttonNavLeft") as HTMLElement;
        buttonNavLeft.addEventListener("click", (_event) => {
            navLeftOrRight(true);
        });

        const buttonNavRight = document.getElementById("buttonNavRight") as HTMLElement;
        buttonNavRight.addEventListener("click", (_event) => {
            navLeftOrRight(false);
        });

        const onWheel = throttle((ev: WheelEvent) => {

            console.log("wheel: " + ev.deltaX + " - " + ev.deltaY);

            if (ev.deltaY < 0 || ev.deltaX < 0) {
                navLeftOrRight(true);
            } else if (ev.deltaY > 0 || ev.deltaX > 0) {
                navLeftOrRight(false);
            }
        }, 300);
        buttonNavLeft.addEventListener("wheel", onWheel);
        buttonNavRight.addEventListener("wheel", onWheel);

        if (_publication.Spine && _publication.Spine.length) {

            const opts: IRiotOptsLinkList = {
                basic: true,
                fixBasic: true, // always single-line list items (no title)
                handleLink: handleLink_,
                links: (_publicationJSON.spine || _publicationJSON.readingOrder) as IRiotOptsLinkListItem[],
                url: publicationJsonUrl,
            };
            // const tag =
            riotMountLinkList("#reader_controls_SPINE", opts);
        }

        if (_publication.TOC && _publication.TOC.length) {

            const opts: IRiotOptsLinkTree = {
                basic: electronStore.get("basicLinkTitles"),
                handleLink: handleLink_,
                links: _publicationJSON.toc as IRiotOptsLinkTreeItem[],
                url: publicationJsonUrl,
            };
            const tag = riotMountLinkTree("#reader_controls_TOC", opts)[0] as IRiotTagLinkTree;

            electronStore.onChanged("basicLinkTitles", (newValue: any, oldValue: any) => {
                if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
                    return;
                }
                tag.setBasic(newValue);
            });
        }
        if (_publication.PageList && _publication.PageList.length) {

            const opts: IRiotOptsLinkList = {
                basic: electronStore.get("basicLinkTitles"),
                handleLink: handleLink_,
                links: _publicationJSON["page-list"] as IRiotOptsLinkListItem[],
                url: publicationJsonUrl,
            };
            const tag = riotMountLinkList("#reader_controls_PAGELIST", opts)[0] as IRiotTagLinkList;

            electronStore.onChanged("basicLinkTitles", (newValue: any, oldValue: any) => {
                if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
                    return;
                }
                tag.setBasic(newValue);
            });
        }

        const landmarksData: IRiotOptsLinkListGroupItem[] = [];
        if (_publication.Landmarks && _publication.Landmarks.length) {
            landmarksData.push({
                label: "Main",
                links: _publicationJSON.landmarks as IRiotOptsLinkListItem[],
            });
        }
        if (_publication.LOT && _publication.LOT.length) {
            landmarksData.push({
                label: "Tables",
                links: _publicationJSON.lot as IRiotOptsLinkListItem[],
            });
        }
        if (_publication.LOI && _publication.LOI.length) {
            landmarksData.push({
                label: "Illustrations",
                links: _publicationJSON.loi as IRiotOptsLinkListItem[],
            });
        }
        if (_publication.LOV && _publication.LOV.length) {
            landmarksData.push({
                label: "Video",
                links: _publicationJSON.lov as IRiotOptsLinkListItem[],
            });
        }
        if (_publication.LOA && _publication.LOA.length) {
            landmarksData.push({
                label: "Audio",
                links: _publicationJSON.loa as IRiotOptsLinkListItem[],
            });
        }
        if (landmarksData.length) {
            const opts: IRiotOptsLinkListGroup = {
                basic: electronStore.get("basicLinkTitles"),
                handleLink: handleLink_,
                linksgroup: landmarksData,
                url: publicationJsonUrl,
            };
            const tag = riotMountLinkListGroup("#reader_controls_LANDMARKS", opts)[0] as IRiotTagLinkListGroup;

            electronStore.onChanged("basicLinkTitles", (newValue: any, oldValue: any) => {
                if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
                    return;
                }
                tag.setBasic(newValue);
            });
        }

        const readStore = electronStore.get("readingLocation");
        let location: Locator | undefined;
        if (readStore) {
            const obj = readStore[pathDecoded] as IReadingLocation;
            if (obj && obj.doc) {
                if (obj.loc) {
                    location = { href: obj.doc, locations: { cfi: undefined, cssSelector: obj.loc } };
                } else if (obj.locCssSelector) {
                    location = { href: obj.doc, locations: { cfi: undefined, cssSelector: obj.locCssSelector } };
                }
                if (obj.locCfi) {
                    if (!location) {
                        location = { href: obj.doc, locations: { cfi: obj.locCfi, cssSelector: "body" } };
                    } else {
                        location.locations.cfi = obj.locCfi;
                    }
                }
            }
        }

        // necessary otherwise focus steal for links in publication documents!
        drawer.open = true;
        setTimeout(() => {
            drawer.open = false;

            let preloadPath = "./preload.js";

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
                    distTarget
                    + "/src/electron/renderer/webview/preload.js");
            }

            preloadPath = IS_DEV ? preloadPath : `${dirnameSlashed}/preload.js`;
            preloadPath = preloadPath.replace(/\\/g, "/");
            // preloadPath = "file://" + preloadPath;
            console.log(preloadPath);

            const rootHtmlElementID = "publication_viewport";
            const rootHtmlElement = document.getElementById(rootHtmlElementID) as HTMLElement;
            if (!rootHtmlElement) {
                console.log("!rootHtmlElement ???");
                return;
            }

            // rootHtmlElement.addEventListener(DOM_EVENT_HIDE_VIEWPORT, () => {
            //     hideWebView();
            // });
            // rootHtmlElement.addEventListener(DOM_EVENT_SHOW_VIEWPORT, () => {
            //     unhideWebView();
            // });

            console.log(location);
            setReadingProgressionSlider(location);

            installNavigatorDOM(_publication, publicationJsonUrl,
                rootHtmlElementID,
                preloadPath,
                location);
        }, 500);
    })();
}

// const ELEMENT_ID_HIDE_PANEL = "r2_navigator_reader_chrome_HIDE";
// let _viewHideInterval: NodeJS.Timer | undefined;
// const unhideWebView = () => {
//     if (window) { // skip this
//         return;
//     }
//     if (_viewHideInterval) {
//         clearInterval(_viewHideInterval);
//         _viewHideInterval = undefined;
//     }
//     const hidePanel = document.getElementById(ELEMENT_ID_HIDE_PANEL) as HTMLElement;
//     if (!hidePanel || hidePanel.style.display === "none") {
//         return;
//     }
//     if (hidePanel) {
//         hidePanel.style.display = "none";
//     }
// };
// const hideWebView = () => {
//     if (window) { // skip this
//         return;
//     }
//     const hidePanel = document.getElementById(ELEMENT_ID_HIDE_PANEL) as HTMLElement;
//     if (hidePanel && hidePanel.style.display !== "block") {
//         hidePanel.style.display = "block";
//         _viewHideInterval = setInterval(() => {
//             console.log("unhideWebView FORCED");
//             unhideWebView();
//         }, 5000);
//     }
// };

function handleLink_(href: string) {
    if (drawer.open) {
        drawer.open = false;
        setTimeout(() => {
            handleLinkUrl(href);
        }, 200);
    } else {
        handleLinkUrl(href);
    }
}
