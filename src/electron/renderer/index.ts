// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import { debounce } from "debounce";
import { ipcRenderer } from "electron";
import * as path from "path";
import * as throttle from "throttleit";

import { TaJsonDeserialize } from "@r2-lcp-js/serializable";
import {
    IEventPayload_R2_EVENT_READIUMCSS, IKeyboardEvent,
} from "@r2-navigator-js/electron/common/events";
import { IHighlight, IHighlightDefinition } from "@r2-navigator-js/electron/common/highlight";
import {
    IReadiumCSS, readiumCSSDefaults,
} from "@r2-navigator-js/electron/common/readium-css-settings";
import {
    READIUM2_ELECTRON_HTTP_PROTOCOL, convertCustomSchemeToHttpUrl,
} from "@r2-navigator-js/electron/common/sessions";
import { getURLQueryParams } from "@r2-navigator-js/electron/renderer/common/querystring";
import {
    LocatorExtended, TTSStateEnum, getCurrentReadingLocation, handleLinkLocator, handleLinkUrl,
    highlightsClickListen, highlightsCreate, highlightsRemove, installNavigatorDOM,
    isLocatorVisible, navLeftOrRight, readiumCssUpdate, reloadContent, setEpubReadingSystemInfo,
    setKeyDownEventHandler, setReadingLocationSaver, ttsClickEnable, ttsListen, ttsNext, ttsPause,
    ttsPlay, ttsPlaybackRate, ttsPrevious, ttsResume, ttsStop,
} from "@r2-navigator-js/electron/renderer/index";
import { initGlobalConverters_OPDS } from "@r2-opds-js/opds/init-globals";
import {
    initGlobalConverters_GENERIC, initGlobalConverters_SHARED,
} from "@r2-shared-js/init-globals";
import { Locator } from "@r2-shared-js/models/locator";
import { IStringMap } from "@r2-shared-js/models/metadata-multilang";
import { Publication } from "@r2-shared-js/models/publication";
import { Link } from "@r2-shared-js/models/publication-link";

import {
    IEventPayload_R2_EVENT_LCP_LSD_RENEW, IEventPayload_R2_EVENT_LCP_LSD_RENEW_RES,
    IEventPayload_R2_EVENT_LCP_LSD_RETURN, IEventPayload_R2_EVENT_LCP_LSD_RETURN_RES,
    IEventPayload_R2_EVENT_TRY_LCP_PASS, IEventPayload_R2_EVENT_TRY_LCP_PASS_RES,
    R2_EVENT_LCP_LSD_RENEW, R2_EVENT_LCP_LSD_RENEW_RES, R2_EVENT_LCP_LSD_RETURN,
    R2_EVENT_LCP_LSD_RETURN_RES, R2_EVENT_TRY_LCP_PASS, R2_EVENT_TRY_LCP_PASS_RES,
} from "../common/events";
import { IStore } from "../common/store";
import { StoreElectron } from "../common/store-electron";
import { HTML_COLORS } from "./colours";
import { setupDragDrop } from "./drag-drop";
import {
    IRiotOptsLinkList, IRiotOptsLinkListItem, IRiotTagLinkList, riotMountLinkList,
} from "./riots/linklist/index_";
import {
    IRiotOptsLinkListGroup, IRiotOptsLinkListGroupItem, IRiotTagLinkListGroup,
    riotMountLinkListGroup,
} from "./riots/linklistgroup/index_";
import {
    IRiotOptsLinkTree, IRiotOptsLinkTreeItem, IRiotTagLinkTree, riotMountLinkTree,
} from "./riots/linktree/index_";
import {
    IRiotOptsMenuSelect, IRiotOptsMenuSelectItem, IRiotTagMenuSelect, riotMountMenuSelect,
} from "./riots/menuselect/index_";

import SystemFonts = require("system-font-families");

// import { consoleRedirect } from "@r2-navigator-js/electron/renderer/common/console-redirect";
// // const releaseConsoleRedirect =
// consoleRedirect("r2:testapp#electron/renderer/index", process.stdout, process.stderr, true);

const IS_DEV = (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dev");

const queryParams = getURLQueryParams();

// import { registerProtocol } from "@r2-navigator-js/electron/renderer/common/protocol";
// registerProtocol();

const R2_LOC_CSSSELECTOR = "r2locCssSelector";
const R2_LOC_PROGRESSION = "r2locProgression";

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
// const pubServerRoot = queryParams["pubServerRoot"];
// console.log(pubServerRoot);

let _publication: Publication | undefined;

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
            // urlRoot: pubServerRoot,
        };
        return jsonMsg;
    } else {
        return { setCSS: undefined }; // reset all (disable ReadiumCSS)
    }
};
// setReadiumCssJsonGetter(computeReadiumCssJsonMessage);

setEpubReadingSystemInfo({ name: "Readium2 test app", version: "0.0.1-alpha.1" });

interface IReadingLocation {
    doc: string;
    loc: string | undefined; // legacy
    locCfi: string;
    locCssSelector: string;
    locProgression: number;
    locPosition: number;
}

function isFixedLayout(publication: Publication, link: Link | undefined): boolean {
    if (link && link.Properties) {
        if (link.Properties.Layout === "fixed") {
            return true;
        }
        if (typeof link.Properties.Layout !== "undefined") {
            return false;
        }
    }
    if (publication &&
        publication.Metadata &&
        publication.Metadata.Rendition) {
        return publication.Metadata.Rendition.Layout === "fixed";
    }
    return false;
}

function sanitizeText(str: string): string {
    // tslint:disable-next-line:max-line-length
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, " ").replace(/\s\s+/g, " ").trim();
}

const onChangeReadingProgressionSliderDebounced = debounce(onChangeReadingProgressionSlider, 200);
function onChangeReadingProgressionSlider() {
    const positionSelector = document.getElementById("positionSelector") as HTMLElement;
    const mdcSlider = (positionSelector as any).mdcSlider;
    if (typeof mdcSlider.functionMode === "undefined") {
        return;
    }

    if (mdcSlider.functionMode === "fixed-layout" ||
        mdcSlider.functionMode === "reflow-scrolled") {
        if (_publication && _publication.Spine) {
            const zeroBasedIndex = mdcSlider.value - 1;
            const foundLink = _publication.Spine.find((_link, i) => {
                return zeroBasedIndex === i;
            });
            if (foundLink) {
                const locator = {
                    href: foundLink.Href,
                    locations: {
                        cfi: undefined,
                        cssSelector: undefined,
                        position: undefined,
                        progression: undefined,
                    },
                };
                console.log("handleLinkLocator (fixed-layout / reflow-scrolled) from onChangeReadingProgressionSlider");
                handleLinkLocator(locator);
            }
        }
        return;
    }

    // if (mdcSlider.functionMode === "reflow-scrolled") {
    //     const currentPos = getCurrentReadingLocation(); // LocatorExtended
    //     if (!currentPos) {
    //         return;
    //     }
    //     const locator = {
    //         href: currentPos.locator.href,
    //         locations: {
    //             cfi: undefined,
    //             cssSelector: undefined,
    //             position: undefined,

    //             // zero-based percentage, reaches 100% unlike scroll offset
    //             progression: mdcSlider.value / 100,
    //         },
    //     };
    //     handleLinkLocator(locator);
    //     return;
    // }

    if (mdcSlider.functionMode === "reflow-paginated") {
        const currentPos = getCurrentReadingLocation(); // LocatorExtended
        if (!currentPos) {
            return;
        }

        const locator = {
            href: currentPos.locator.href,
            locations: {
                cfi: undefined,
                cssSelector: undefined,
                position: undefined,

                // zero-based percentage, does not reach 100% (column/spread begin)
                progression: (mdcSlider.value - 1) / mdcSlider.max,
            },
        };
        console.log("onChangeReadingProgressionSlider (reflow-paginated) from onChangeReadingProgressionSlider");
        handleLinkLocator(locator);
    }
}

function updateReadingProgressionSlider(locatorExtended: LocatorExtended | undefined) {
    const locator = locatorExtended ? locatorExtended.locator : undefined;

    const positionSelector = document.getElementById("positionSelector") as HTMLElement;
    positionSelector.style.visibility = "visible";
    const positionSelectorValue = document.getElementById("positionSelectorValue") as HTMLElement;
    const mdcSlider = (positionSelector as any).mdcSlider;

    let foundLink: Link | undefined;
    let spineIndex = -1;
    if (_publication && locator) {
        if (_publication.Spine) {
            foundLink = _publication.Spine.find((link, i) => {
                const ok = link.Href === locator.href;
                if (ok) {
                    spineIndex = i;
                }
                return ok;
            });
        }
        if (!foundLink && _publication.Resources) {
            foundLink = _publication.Resources.find((link) => {
                return link.Href === locator.href;
            });
        }
    }
    const fixedLayout = (locatorExtended && locatorExtended.docInfo) ?
        locatorExtended.docInfo.isFixedLayout :
        (_publication ? isFixedLayout(_publication, foundLink) : false);

    let label = (foundLink && foundLink.Title) ? sanitizeText(foundLink.Title) : undefined;
    if (!label || !label.length) {
        label = (locator && locator.title) ? sanitizeText(locator.title) : undefined;
    }
    if (!label || !label.length) {
        label = foundLink ? foundLink.Href : undefined;
    }

    if (fixedLayout) {
        if (spineIndex >= 0 && _publication && _publication.Spine) {

            mdcSlider.functionMode = "fixed-layout";

            if (_publication.Spine.length === 1) {
                positionSelector.style.visibility = "hidden";
            }
            if (mdcSlider.min !== 1) {
                mdcSlider.min = 1;
            }
            if (mdcSlider.max !== _publication.Spine.length) {
                mdcSlider.max = _publication.Spine.length;
            }
            if (mdcSlider.step !== 1) {
                mdcSlider.step = 1;
            }
            mdcSlider.value = spineIndex + 1;

            const pagePosStr = `Page ${spineIndex + 1} / ${_publication.Spine.length}`;
            // if (label) {
            //     positionSelectorValue.innerHTML = `[<strong>${label}</strong>] ` + pagePosStr;
            // } else {
            //     positionSelectorValue.textContent = pagePosStr;
            // }
            positionSelectorValue.textContent = pagePosStr;
            return;
        }
    } else {
        const current = getCurrentReadingLocation(); // LocatorExtended
        if (!current || !current.paginationInfo ||
            (typeof current.paginationInfo.isTwoPageSpread === "undefined") ||
            (typeof current.paginationInfo.spreadIndex === "undefined") ||
            (typeof current.paginationInfo.currentColumn === "undefined") ||
            (typeof current.paginationInfo.totalColumns === "undefined")) {

            if (spineIndex >= 0 && _publication && _publication.Spine) {

                mdcSlider.functionMode = "reflow-scrolled";

                if (_publication.Spine.length === 1) {
                    positionSelector.style.visibility = "hidden";
                }
                if (mdcSlider.min !== 1) {
                    mdcSlider.min = 1;
                }
                if (mdcSlider.max !== _publication.Spine.length) {
                    mdcSlider.max = _publication.Spine.length;
                }
                if (mdcSlider.step !== 1) {
                    mdcSlider.step = 1;
                }
                mdcSlider.value = spineIndex + 1;

                const pagePosStr = `Chapter ${spineIndex + 1} / ${_publication.Spine.length}`;
                if (label) {
                    positionSelectorValue.innerHTML = `[<strong>${label}</strong>] ` + pagePosStr;
                } else {
                    positionSelectorValue.textContent = pagePosStr;
                }
                return;
            }

            // const percent = (!locator || !locator.locations.progression) ? 0 :
            //     Math.round(locator.locations.progression * 10) * 10;
            // if (mdcSlider.min !== 0) {
            //     mdcSlider.min = 0;
            // }
            // if (mdcSlider.max !== 100) {
            //     mdcSlider.max = 100;
            // }
            // if (mdcSlider.step !== 1) {
            //     mdcSlider.step = 1;
            // }
            // mdcSlider.value = percent;
            // positionSelectorValue.textContent = percent + "%";
            // return;
        } else {

            mdcSlider.functionMode = "reflow-paginated";

            const totalColumns = current.paginationInfo.totalColumns;
            const totalSpreads = Math.ceil(totalColumns / 2);
            const totalSpreadsOrColumns = current.paginationInfo.isTwoPageSpread ? totalSpreads : totalColumns;

            const nColumn = current.paginationInfo.currentColumn + 1;
            const nSpread = current.paginationInfo.spreadIndex + 1;
            const nSpreadOrColumn = current.paginationInfo.isTwoPageSpread ? nSpread : nColumn;

            if (totalSpreadsOrColumns === 1) {
                positionSelector.style.visibility = "hidden";
            }
            if (mdcSlider.min !== 1) {
                mdcSlider.min = 1;
            }
            if (mdcSlider.max !== totalSpreadsOrColumns) {
                mdcSlider.max = totalSpreadsOrColumns;
            }
            if (mdcSlider.step !== 1) {
                mdcSlider.step = 1;
            }
            mdcSlider.value = nSpreadOrColumn;

            const nSpreadColumn = (current.paginationInfo.spreadIndex * 2) + 1;

            const pageStr = current.paginationInfo.isTwoPageSpread ?
                ((nSpreadColumn + 1) <= totalColumns ? `Pages ${nSpreadColumn}-${nSpreadColumn + 1} / ${totalColumns}` :
                    `Page ${nSpreadColumn} / ${totalColumns}`) : `Page ${nColumn} / ${totalColumns}`;
            if (label) {
                positionSelectorValue.innerHTML = `[<strong>${label}</strong>] ` + pageStr;
            } else {
                positionSelectorValue.textContent = pageStr;
            }
            return;
        }
    }

    // default fallback
    mdcSlider.functionMode = undefined;
    positionSelector.style.visibility = "hidden";
    if (mdcSlider.min !== 0) {
        mdcSlider.min = 0;
    }
    if (mdcSlider.max !== 100) {
        mdcSlider.max = 100;
    }
    if (mdcSlider.step !== 1) {
        mdcSlider.step = 1;
    }
    mdcSlider.value = 0;
    positionSelectorValue.textContent = "";
}

const _bookmarks: Locator[] = [];

function getBookmarkMenuGroupLabel(bookmark: Locator): string {
    return bookmark.title ? `${bookmark.title} (${bookmark.href})` : `${bookmark.href}`;
}

function refreshBookmarksMenu() {

    const bookmarksEl = document.getElementById("reader_controls_BOOKMARKS");
    const tagBookmarks: IRiotTagLinkListGroup = (bookmarksEl as any)._tag;

    const bookmarksListGroups =
        ((tagBookmarks.opts as IRiotOptsLinkListGroup).linksgroup as IRiotOptsLinkListGroupItem[]);
    for (let i = bookmarksListGroups.length - 1; i >= 0; i--) { // remove all
        bookmarksListGroups.splice(i, 1);
    }

    let sortedBookmarks: Locator[];
    if (_publication) {
        sortedBookmarks = [];
        for (const bookmark of _bookmarks) {
            sortedBookmarks.push(bookmark);

            let foundLink: Link | undefined;
            let spineIndex = -1;
            if (_publication.Spine) {
                foundLink = _publication.Spine.find((link, i) => {
                    const ok = link.Href === bookmark.href;
                    if (ok) {
                        spineIndex = i;
                    }
                    return ok;
                });
                if (foundLink) {
                    (bookmark as any).sortIndex = spineIndex;
                    (bookmark as any).link = foundLink;
                }
            }
            if (!foundLink && _publication.Resources) {
                foundLink = _publication.Resources.find((link) => {
                    return link.Href === bookmark.href;
                });
                if (foundLink) {
                    (bookmark as any).sortIndex = -1;
                    (bookmark as any).link = foundLink;
                } else {
                    (bookmark as any).sortIndex = -2;
                }
            }
        }

        sortedBookmarks.sort((l1, l2) => {
            if ((l1 as any).sortIndex === -2) {
                if ((l2 as any).sortIndex === -2) {
                    return 0; // l1 "equal" l2
                } else if ((l2 as any).sortIndex === -1) {
                    return 1; // l1 "greater than" l2
                } else {
                    return 1; // l1 "greater than" l2
                }
            }
            if ((l1 as any).sortIndex === -1) {
                if ((l2 as any).sortIndex === -2) {
                    return -1; // l1 "less than" l2
                } else if ((l2 as any).sortIndex === -1) {
                    return 0; // l1 "equal" l2
                } else {
                    return 1; // l1 "greater than" l2
                }
            }

            if ((l1 as any).sortIndex !== (l2 as any).sortIndex ||
                typeof l1.locations.progression === "undefined" ||
                typeof l2.locations.progression === "undefined") {

                return (l1 as any).sortIndex - (l2 as any).sortIndex;
            }

            return l1.locations.progression - l2.locations.progression;
        });

    } else { // should never happen!
        sortedBookmarks = _bookmarks;
    }

    for (const bookmark of sortedBookmarks) {
        const label = getBookmarkMenuGroupLabel(bookmark);

        let listgroup: IRiotOptsLinkListGroupItem | undefined = bookmarksListGroups.find((lg) => {
            return lg.label === label;
        });
        if (!listgroup) {
            listgroup = {
                label,
                links: [],
            };
            bookmarksListGroups.push(listgroup);
        }
        if (bookmark.locations.cssSelector || typeof bookmark.locations.progression !== "undefined") {
            const href = bookmark.href +
                (bookmark.locations.cssSelector ? `#${R2_LOC_CSSSELECTOR}(${bookmark.locations.cssSelector})` :
                `#${R2_LOC_PROGRESSION}(${bookmark.locations.progression})`);
            const r2Link = (bookmark as any).link ? (bookmark as any).link as Link : undefined;
            const isAudio = (r2Link &&
                ((r2Link.TypeLink && r2Link.TypeLink.startsWith("audio/")) || r2Link.Duration));
            const txt = isAudio ? "Audiomark" : "Bookmark";
            const link: IRiotOptsLinkListItem = {
                href,
                title: (typeof bookmark.locations.progression !== "undefined") ?
                    // tslint:disable-next-line:max-line-length
                    `${txt} #${listgroup.links.length + 1} (${Math.round(bookmark.locations.progression * 1000) / 10}%)` :
                    `${txt} #${listgroup.links.length + 1}`,
            };
            listgroup.links.push(link);
        }
    }
    tagBookmarks.update();
}

function visualDebugBookmarks() {

    refreshBookmarksMenu();

    const current = getCurrentReadingLocation(); // LocatorExtended

    if ((window as any).READIUM2) {
        if ((window as any).READIUM2.debugItems) {

            let cssSelector = "";
            let first = true;
            for (const bookmark of _bookmarks) {
                if (!current || current.locator.href !== bookmark.href) {
                    continue;
                }
                if (bookmark.locations.cssSelector) {
                    cssSelector += first ? "" : ", ";
                    cssSelector += `${bookmark.locations.cssSelector}`;
                    first = false;
                }
            }

            const cssClass = "R2_DEBUG_VISUALS_BOOKMARKS";
            const cssStyles = `:root[style] .R2_DEBUG_VISUALS_BOOKMARKS, :root .R2_DEBUG_VISUALS_BOOKMARKS {
                outline-color: #b43519 !important;
                outline-style: solid !important;
                outline-width: 3px !important;
                outline-offset: 0px !important;

                background-color: #fee3dd !important;
            }`;
            (window as any).READIUM2.debugItems(cssSelector, cssClass, undefined); // clear
            if (cssSelector.length && (window as any).READIUM2.DEBUG_VISUALS) {
                setTimeout(() => {
                    (window as any).READIUM2.debugItems(cssSelector, cssClass, cssStyles); // set all
                }, 100);
            }
        }
    }
}

function addCurrentVisibleBookmark() {
    const current = getCurrentReadingLocation(); // LocatorExtended
    if (current && current.locator) {
        const found = _bookmarks.find((locator) => {
            return locator.href === current.locator.href &&
                // locator.locations.cfi === current.locator.locations.cfi &&
                // locator.locations.progression === current.locator.locations.progression &&
                // locator.locations.position === current.locator.locations.position &&
                ((locator.locations.cssSelector && current.locator.locations.cssSelector &&
                locator.locations.cssSelector === current.locator.locations.cssSelector) ||

                (typeof locator.locations.progression !== "undefined" &&
                typeof current.locator.locations.progression !== "undefined" &&
                locator.locations.progression === current.locator.locations.progression));
        });
        if (!found) {
            _bookmarks.push(current.locator);
        }
    }
}
function removeAllBookmarks(): Locator[] {
    const removed: Locator[] = [];
    for (let i = _bookmarks.length - 1; i >= 0; i--) {
        const bookmark = _bookmarks[i];
        removed.push(bookmark);
        _bookmarks.splice(i, 1);
    }
    return removed;
}
async function removeAllCurrentVisibleBookmarks(): Promise<Locator[]> {
    return new Promise(async (resolve, _reject) => {
        const removed: Locator[] = [];
        for (let i = _bookmarks.length - 1; i >= 0; i--) {
            const bookmark = _bookmarks[i];
            try {
                const visible = await isLocatorVisible(bookmark);
                if (visible) {
                    removed.push(bookmark);
                    _bookmarks.splice(i, 1);
                }
            } catch (err) {
                console.log(err);
            }
        }
        resolve(removed);
    });
}
async function isAnyBookmarkVisible(): Promise<boolean> {
    return new Promise(async (resolve, _reject) => {
        for (const bookmark of _bookmarks) {
            try {
                const visible = await isLocatorVisible(bookmark);
                if (visible) {
                    resolve(true);
                    return;
                }
            } catch (err) {
                console.log(err);
            }
        }
        resolve(false);
    });
}
function refreshBookmarksState() {
    // tslint:disable-next-line:no-floating-promises
    (async () => {
        const buttonBookmarkTOGGLE = document.getElementById("bookmarkTOGGLE") as HTMLElement;
        try {
            const atLeastOneBookmarkIsVisible = await isAnyBookmarkVisible();
            (buttonBookmarkTOGGLE as any).mdcButton.on = atLeastOneBookmarkIsVisible;
        } catch (err) {
            console.log(err);
        }
    })();
}
function refreshBookmarksStore() {
    let obj = electronStore.get("bookmarks");
    if (!obj) {
        obj = {};
    }
    obj[pathDecoded] = [];
    _bookmarks.forEach((bookmark) => {
        obj[pathDecoded].push(bookmark);
    });
    electronStore.set("bookmarks", obj);
}
function initBookmarksFromStore() {
    let obj = electronStore.get("bookmarks");
    if (!obj) {
        obj = {};
    }
    removeAllBookmarks();
    if (obj[pathDecoded]) {
        // _bookmarks = [];
        obj[pathDecoded].forEach((bookmark: Locator) => {
            _bookmarks.push(bookmark);
        });
    }
}

electronStore.onChanged("bookmarks", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }
    initBookmarksFromStore();

    visualDebugBookmarks();
    refreshBookmarksState();
});

interface IHighlightData {
    highlight: IHighlight;
    locator: Locator;
}
const _highlights: IHighlightData[] = [];

function getHighlightMenuGroupLabel(highlight: IHighlightData): string {
    return highlight.locator.title ?
        `${highlight.locator.title} (${highlight.locator.href})` : `${highlight.locator.href}`;
}

function refreshHighlightsMenu() {

    const highlightsEl = document.getElementById("reader_controls_HIGHLIGHTS");
    const tagHighlights: IRiotTagLinkListGroup = (highlightsEl as any)._tag;

    const highlightsListGroups =
        ((tagHighlights.opts as IRiotOptsLinkListGroup).linksgroup as IRiotOptsLinkListGroupItem[]);
    for (let i = highlightsListGroups.length - 1; i >= 0; i--) { // remove all
        highlightsListGroups.splice(i, 1);
    }

    let sortedHighlights: IHighlightData[];
    if (_publication) {
        sortedHighlights = [];
        for (const highlight of _highlights) {
            sortedHighlights.push(highlight);

            let foundLink: Link | undefined;
            let spineIndex = -1;
            if (_publication.Spine) {
                foundLink = _publication.Spine.find((link, i) => {
                    const ok = link.Href === highlight.locator.href;
                    if (ok) {
                        spineIndex = i;
                    }
                    return ok;
                });
                if (foundLink) {
                    (highlight as any).sortIndex = spineIndex;
                }
            }
            if (!foundLink && _publication.Resources) {
                foundLink = _publication.Resources.find((link) => {
                    return link.Href === highlight.locator.href;
                });
                if (foundLink) {
                    (highlight as any).sortIndex = -1;
                } else {
                    (highlight as any).sortIndex = -2;
                }
            }
        }

        sortedHighlights.sort((l1, l2) => {
            if ((l1 as any).sortIndex === -2) {
                if ((l2 as any).sortIndex === -2) {
                    return 0; // l1 "equal" l2
                } else if ((l2 as any).sortIndex === -1) {
                    return 1; // l1 "greater than" l2
                } else {
                    return 1; // l1 "greater than" l2
                }
            }
            if ((l1 as any).sortIndex === -1) {
                if ((l2 as any).sortIndex === -2) {
                    return -1; // l1 "less than" l2
                } else if ((l2 as any).sortIndex === -1) {
                    return 0; // l1 "equal" l2
                } else {
                    return 1; // l1 "greater than" l2
                }
            }

            if ((l1 as any).sortIndex !== (l2 as any).sortIndex ||
                typeof l1.locator.locations.progression === "undefined" ||
                typeof l2.locator.locations.progression === "undefined") {

                return (l1 as any).sortIndex - (l2 as any).sortIndex;
            }

            return l1.locator.locations.progression - l2.locator.locations.progression;
        });

    } else { // should never happen!
        sortedHighlights = _highlights;
    }

    for (const highlight of sortedHighlights) {
        const label = getHighlightMenuGroupLabel(highlight);

        let listgroup: IRiotOptsLinkListGroupItem | undefined = highlightsListGroups.find((lg) => {
            return lg.label === label;
        });
        if (!listgroup) {
            listgroup = {
                label,
                links: [],
            };
            highlightsListGroups.push(listgroup);
        }
        if (highlight.locator.locations.cssSelector) {
            const textTrim = highlight.highlight.selectionInfo.cleanText.substr(0, 50);
            const link: IRiotOptsLinkListItem = {
                href: `${highlight.locator.href}#${R2_LOC_CSSSELECTOR}(${highlight.locator.locations.cssSelector})`,

                title: (typeof highlight.locator.locations.progression !== "undefined") ?
                    // tslint:disable-next-line:max-line-length
                    `#${listgroup.links.length + 1} (${Math.round(highlight.locator.locations.progression * 1000) / 10}%) ${textTrim}` :
                    `#${listgroup.links.length + 1} ${textTrim}`,
            };
            listgroup.links.push(link);
        }
    }
    tagHighlights.update();
}

function removeAllHighlights(): IHighlightData[] {
    const removed: IHighlightData[] = [];
    for (let i = _highlights.length - 1; i >= 0; i--) {
        const highlight = _highlights[i];
        removed.push(highlight);
        _highlights.splice(i, 1);
    }
    return removed;
}
function refreshHighlightsStore() {
    let obj = electronStore.get("highlights");
    if (!obj) {
        obj = {};
    }
    obj[pathDecoded] = [];
    _highlights.forEach((highlight) => {
        obj[pathDecoded].push(highlight);
    });
    electronStore.set("highlights", obj);
}
function initHighlightsFromStore() {
    let obj = electronStore.get("highlights");
    if (!obj) {
        obj = {};
    }
    removeAllHighlights();
    if (obj[pathDecoded]) {
        // _highlights = [];
        obj[pathDecoded].forEach((highlight: IHighlightData) => {
            _highlights.push(highlight);
        });
    }
}
electronStore.onChanged("highlights", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }
    initHighlightsFromStore();
    refreshHighlightsMenu();
});

let _lastSavedReadingLocationHref: string | undefined;
const saveReadingLocation = async (location: LocatorExtended) => {
    const hrefHasChanged = _lastSavedReadingLocationHref !== location.locator.href;
    _lastSavedReadingLocationHref = location.locator.href;

    updateReadingProgressionSlider(location);

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

    visualDebugBookmarks();
    refreshBookmarksState();

    let highlightsStoreWasRefreshed = false;

    const selectionInfo = location.selectionInfo;
    if (selectionInfo && location.selectionIsNew) {
        const highlightToCreate = { selectionInfo } as IHighlightDefinition;
        let createdHighlights: Array<IHighlight | null> | undefined;
        try {
            createdHighlights = await highlightsCreate(location.locator.href, [highlightToCreate]);
        } catch (err) {
            console.log(err);
        }
        if (createdHighlights) {
            createdHighlights.forEach((highlight) => {
                if (highlight) {
                    const hd = { highlight, locator: location.locator } as IHighlightData;
                    _highlights.push(hd);
                }
            });
            highlightsStoreWasRefreshed = true;
            refreshHighlightsStore();
        }
    }

    if (hrefHasChanged) {
        const highlightsToCreate: IHighlightDefinition[] = [];
        _highlights.forEach((highlightData) => {
            if (highlightData.locator.href === location.locator.href) {
                const h = {
                    color: highlightData.highlight.color,
                    id: highlightData.highlight.id,
                    selectionInfo: highlightData.highlight.selectionInfo,
                } as IHighlightDefinition;
                highlightsToCreate.push(h);
            }
        });
        if (highlightsToCreate.length) {
            try {
                await highlightsCreate(location.locator.href, highlightsToCreate);
            } catch (err) {
                console.log(err);
            }
        }
    }

    if (!highlightsStoreWasRefreshed) {
        refreshHighlightsMenu();
    }
};
setReadingLocationSaver(saveReadingLocation);

// import * as path from "path";
// import { setLcpNativePluginPath } from "@r2-streamer-js/parser/epub/lcp";
// // tslint:disable-next-line:no-string-literal
// const lcpPluginBase64 = queryParams["lcpPlugin"];
// if (lcpPluginBase64) {
//     const lcpPlugin = Buffer.from(lcpPluginBase64, "base64").toString("utf8");
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
    pathDecoded = Buffer.from(decodeURIComponent(pathBase64), "base64").toString("utf8");
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
        if (electronStore.get("readiumCSS.backgroundColor")) {
            electronStore.set("readiumCSS.backgroundColor", null);
        }
        if (electronStore.get("readiumCSS.textColor")) {
            electronStore.set("readiumCSS.textColor", null);
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
        if (electronStore.get("readiumCSS.backgroundColor")) {
            electronStore.set("readiumCSS.backgroundColor", null);
        }
        if (electronStore.get("readiumCSS.textColor")) {
            electronStore.set("readiumCSS.textColor", null);
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

electronStore.onChanged("readiumCSS.mathJax", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }

    // const mathJaxSwitch = document.getElementById("mathJax_switch-input") as HTMLInputElement;
    const mathJaxSwitchEl = document.getElementById("mathJax_switch") as HTMLElement;
    const mathJaxSwitch = (mathJaxSwitchEl as any).mdcSwitch;
    mathJaxSwitch.checked = newValue ? true : false;

    refreshReadiumCSS();
    setTimeout(() => {
        // window.location.reload();
        reloadContent();
    }, 300);
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
    // readiumCssOnOff();
    readiumCssUpdate(computeReadiumCssJsonMessage());
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

    // const mathJaxSwitch = document.getElementById("mathJax_switch-input") as HTMLInputElement;
    const mathJaxSwitchEl = document.getElementById("mathJax_switch") as HTMLElement;
    const mathJaxSwitch = (mathJaxSwitchEl as any).mdcSwitch;
    mathJaxSwitch.disabled = !newValue;

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

function visualDebug(doDebug: boolean) {

    if ((window as any).READIUM2) {
        if ((window as any).READIUM2.debug) {
            (window as any).READIUM2.debug(doDebug);
        }
        // (window as any).READIUM2.DEBUG_VISUALS ? false : true
    }
    visualDebugBookmarks();
}

electronStore.onChanged("visualDebug", (newValue: any, oldValue: any) => {
    if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
        return;
    }
    const debugSwitchEl = document.getElementById("visual_debug_switch") as HTMLElement;
    const debugSwitch = (debugSwitchEl as any).mdcSwitch;
    debugSwitch.checked = newValue;

    visualDebug(debugSwitch.checked);
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

        // newValue can be null!

        if (newValue) {
            if (electronStore.get("readiumCSS.night")) {
                electronStore.set("readiumCSS.night", false);
            }
            if (electronStore.get("readiumCSS.sepia")) {
                electronStore.set("readiumCSS.sepia", false);
            }
        }

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

    const keyDownEventHandler = (
        ev: IKeyboardEvent,
        _elementName: string,
        _elementAttributes: { [name: string]: string; }) => {

        // DEPRECATED
        // if (ev.keyCode === 37 || ev.keyCode === 39) { // left / right
        // https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/keyCode
        // https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
        // https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code/code_values
        const leftKey = ev.code === "ArrowLeft";
        const rightKey = ev.code === "ArrowRight";
        if (leftKey || rightKey) {
            const noModifierKeys = !ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.metaKey;
            const spineNavModifierKeys = ev.ctrlKey && ev.shiftKey;
            if (noModifierKeys || spineNavModifierKeys) {
                navLeftOrRight(leftKey, spineNavModifierKeys);
            }
        }
    };
    setKeyDownEventHandler(keyDownEventHandler);

    window.document.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (drawer.open) {
            return;
        }
        if ((ev.target as any).mdcSlider) {
            return;
        }
        keyDownEventHandler(ev, "", {});
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

    nightSwitchEl.addEventListener("click", (_event: any) => {
        // nightSwitch.handleClick((_event: any) => {
        const checked = nightSwitch.checked;
        electronStore.set("readiumCSS.night", checked);
    });
    nightSwitch.disabled = !electronStore.get("readiumCSSEnable");

    const sepiaSwitchEl = document.getElementById("sepia_switch") as HTMLElement;
    const sepiaSwitch = new (window as any).mdc.switchControl.MDCSwitch(sepiaSwitchEl);
    (sepiaSwitchEl as any).mdcSwitch = sepiaSwitch;
    sepiaSwitch.checked = electronStore.get("readiumCSS.sepia");
    sepiaSwitchEl.addEventListener("click", (_event: any) => {
        const checked = sepiaSwitch.checked;
        electronStore.set("readiumCSS.sepia", checked);
    });
    sepiaSwitch.disabled = !electronStore.get("readiumCSSEnable");

    const invertSwitchEl = document.getElementById("invert_switch") as HTMLElement;
    const invertSwitch = new (window as any).mdc.switchControl.MDCSwitch(invertSwitchEl);
    (invertSwitchEl as any).mdcSwitch = invertSwitch;
    invertSwitch.checked = electronStore.get("readiumCSS.invert");
    invertSwitchEl.addEventListener("click", (_event: any) => {
        const checked = invertSwitch.checked;
        electronStore.set("readiumCSS.invert", checked);
    });
    invertSwitch.disabled = !nightSwitch.checked || !electronStore.get("readiumCSSEnable");

    const darkenSwitchEl = document.getElementById("darken_switch") as HTMLElement;
    const darkenSwitch = new (window as any).mdc.switchControl.MDCSwitch(darkenSwitchEl);
    (darkenSwitchEl as any).mdcSwitch = darkenSwitch;
    darkenSwitch.checked = electronStore.get("readiumCSS.darken");
    darkenSwitchEl.addEventListener("click", (_event: any) => {
        const checked = darkenSwitch.checked;
        electronStore.set("readiumCSS.darken", checked);
    });
    darkenSwitch.disabled = !nightSwitch.checked || !electronStore.get("readiumCSSEnable");

    // const justifySwitch = document.getElementById("justify_switch-input") as HTMLInputElement;
    const justifySwitchEl = document.getElementById("justify_switch") as HTMLElement;
    const justifySwitch = new (window as any).mdc.switchControl.MDCSwitch(justifySwitchEl);
    (justifySwitchEl as any).mdcSwitch = justifySwitch;
    justifySwitch.checked = electronStore.get("readiumCSS.textAlign") === "justify";
    justifySwitchEl.addEventListener("click", (_event: any) => {
        // justifySwitch.handleClick((_event: any) => {
        const checked = justifySwitch.checked;
        electronStore.set("readiumCSS.textAlign", checked ? "justify" : "initial");
    });
    justifySwitch.disabled = !electronStore.get("readiumCSSEnable");

    // const footnotesSwitch = document.getElementById("footnotes_switch-input") as HTMLInputElement;
    const footnotesSwitchEl = document.getElementById("footnotes_switch") as HTMLElement;
    const footnotesSwitch = new (window as any).mdc.switchControl.MDCSwitch(footnotesSwitchEl);
    (footnotesSwitchEl as any).mdcSwitch = footnotesSwitch;
    footnotesSwitch.checked = electronStore.get("readiumCSS.noFootnotes") ? false : true;
    footnotesSwitchEl.addEventListener("click", (_event: any) => {
        // footnotesSwitch.handleClick((_event: any) => {
        const checked = footnotesSwitch.checked;
        electronStore.set("readiumCSS.noFootnotes", checked ? false : true);
    });
    footnotesSwitch.disabled = !electronStore.get("readiumCSSEnable");

    // const reduceMotionSwitch = document.getElementById("reduceMotion_switch-input") as HTMLInputElement;
    const reduceMotionSwitchEl = document.getElementById("reduceMotion_switch") as HTMLElement;
    const reduceMotionSwitch = new (window as any).mdc.switchControl.MDCSwitch(reduceMotionSwitchEl);
    (reduceMotionSwitchEl as any).mdcSwitch = reduceMotionSwitch;
    reduceMotionSwitch.checked = electronStore.get("readiumCSS.reduceMotion") ? true : false;
    reduceMotionSwitchEl.addEventListener("click", (_event: any) => {
        // footnotesSwitch.handleClick((_event: any) => {
        const checked = reduceMotionSwitch.checked;
        electronStore.set("readiumCSS.reduceMotion", checked ? true : false);
    });
    reduceMotionSwitch.disabled = !electronStore.get("readiumCSSEnable");

    // const mathJaxSwitch = document.getElementById("mathJax_switch-input") as HTMLInputElement;
    const mathJaxSwitchEl = document.getElementById("mathJax_switch") as HTMLElement;
    const mathJaxSwitch = new (window as any).mdc.switchControl.MDCSwitch(mathJaxSwitchEl);
    (mathJaxSwitchEl as any).mdcSwitch = mathJaxSwitch;
    mathJaxSwitch.checked = electronStore.get("readiumCSS.mathJax") ? true : false;
    mathJaxSwitchEl.addEventListener("click", (_event: any) => {
        // footnotesSwitch.handleClick((_event: any) => {
        const checked = mathJaxSwitch.checked;
        electronStore.set("readiumCSS.mathJax", checked ? true : false);
    });
    mathJaxSwitch.disabled = !electronStore.get("readiumCSSEnable");

    // const paginateSwitch = document.getElementById("paginate_switch-input") as HTMLInputElement;
    const paginateSwitchEl = document.getElementById("paginate_switch") as HTMLElement;
    const paginateSwitch = new (window as any).mdc.switchControl.MDCSwitch(paginateSwitchEl);
    (paginateSwitchEl as any).mdcSwitch = paginateSwitch;
    paginateSwitch.checked = electronStore.get("readiumCSS.paged");
    paginateSwitchEl.addEventListener("click", (_event: any) => {
        // paginateSwitch.handleClick((_event: any) => {
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
    readiumcssSwitchEl.addEventListener("click", (_event: any) => {
        // readiumcssSwitch.handleClick((_event: any) => {
        const checked = readiumcssSwitch.checked;
        electronStore.set("readiumCSSEnable", checked);
    });

    // const basicSwitch = document.getElementById("nav_basic_switch-input") as HTMLInputElement;
    const basicSwitchEl = document.getElementById("nav_basic_switch") as HTMLElement;
    const basicSwitch = new (window as any).mdc.switchControl.MDCSwitch(basicSwitchEl);
    (basicSwitchEl as any).mdcSwitch = basicSwitch;
    basicSwitch.checked = !electronStore.get("basicLinkTitles");
    basicSwitchEl.addEventListener("click", (_event: any) => {
        // basicSwitch.handleClick((_event: any) => {
        const checked = basicSwitch.checked;
        electronStore.set("basicLinkTitles", !checked);

        setTimeout(() => {
            snackBar.labelText = `Link URLs now ${checked ? "shown" : "hidden"}.`;
            snackBar.actionButtonText = "OK";
            snackBar.open();
        }, 500);
    });

    const debugSwitchEl = document.getElementById("visual_debug_switch") as HTMLElement;
    const debugSwitch = new (window as any).mdc.switchControl.MDCSwitch(debugSwitchEl);
    (debugSwitchEl as any).mdcSwitch = debugSwitch;
    debugSwitch.checked = electronStore.get("visualDebug");
    debugSwitchEl.addEventListener("click", (_event: any) => {
        const checked = debugSwitch.checked;
        electronStore.set("visualDebug", checked);

        setTimeout(() => {
            snackBar.labelText = `Visual debugging now ${checked ? "enabled" : "disabled"}.`;
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

    slider.listen("MDCSlider:change", (_event: any) => {
        console.log("MDCSlider:change");
        onChangeReadingProgressionSliderDebounced();
    });

    if (lcpPassInput) {
        lcpPassInput.addEventListener("keyup", (ev) => {
            if (ev.key === "Enter") {
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

        electronStore.set("bookmarks", {});

        drawer.open = false;
        setTimeout(() => {
            snackBar.labelText = "Reading locations / bookmarks reset.";
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
    console.log(payload.lsd);
});

ipcRenderer.on(R2_EVENT_LCP_LSD_RETURN_RES, (_event: any, payload: IEventPayload_R2_EVENT_LCP_LSD_RETURN_RES) => {
    console.log("R2_EVENT_LCP_LSD_RETURN_RES");
    console.log(payload.okay);
    console.log(payload.error);
    console.log(payload.lsd);
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

        _publication = TaJsonDeserialize<Publication>(_publicationJSON, Publication);

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
                // h1.addEventListener("click", (_event: any) => {
                // });
            }
        }

        initBookmarksFromStore();

        const buttonBookmarkTOGGLE = document.getElementById("bookmarkTOGGLE") as HTMLElement;
        const mdcButtonBookmarkTOGGLE = new (window as any).mdc.iconButton.MDCIconButtonToggle(buttonBookmarkTOGGLE);
        (buttonBookmarkTOGGLE as any).mdcButton = mdcButtonBookmarkTOGGLE;
        mdcButtonBookmarkTOGGLE.listen("MDCIconButtonToggle:change", async () => {
            if ((event as any).detail.isOn) {
                addCurrentVisibleBookmark();
            } else {
                try {
                    const removed = await removeAllCurrentVisibleBookmarks();
                    console.log("removed bookmarks:");
                    removed.forEach((bookmark) => {
                        console.log(JSON.stringify(bookmark, null, 4));
                    });
                } catch (err) {
                    console.log(err);
                }
            }
            visualDebugBookmarks();
            refreshBookmarksStore();
        });

        // const buttonBookmarkHighlightTOGGLE = document.getElementById("bookmarkHighlightTOGGLE") as HTMLElement;
        // buttonBookmarkHighlightTOGGLE.addEventListener("MDCIconButtonToggle:change", async (_event) => {
        //     const bookmarkHighlightTOGGLELabel =
        //         document.getElementById("bookmarkHighlightTOGGLELabel") as HTMLElement;
        //     if ((event as any).detail.isOn) {
        //         bookmarkHighlightTOGGLELabel.textContent = "hide bookmarks";
        //     } else {
        //         bookmarkHighlightTOGGLELabel.textContent = "show bookmarks";
        //     }
        // });
        // const mdcButtonBookmarkHighlightTOGGLE =
        //     new (window as any).mdc.iconButton.MDCIconButtonToggle(buttonBookmarkHighlightTOGGLE);
        // (buttonBookmarkHighlightTOGGLE as any).mdcButton = mdcButtonBookmarkHighlightTOGGLE;

        const selectttsRATE = document.getElementById("ttsPlaybackRate") as HTMLSelectElement;
        selectttsRATE.addEventListener("change", () => {
            const speed = parseFloat(selectttsRATE.value);
            ttsPlaybackRate(speed);
        });

        const buttonttsPLAYPAUSE = document.getElementById("ttsPLAYPAUSE") as HTMLElement;
        buttonttsPLAYPAUSE.addEventListener("MDCIconButtonToggle:change", (event) => {
            // console.log("MDCIconButtonToggle:change");
            // console.log((event as any).detail.isOn);

            if ((event as any).detail.isOn) {
                if (_ttsState === TTSStateEnum.PAUSED) {
                    ttsResume();
                } else {
                    const speed = parseFloat(selectttsRATE.value);
                    ttsPlay(speed);
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
        //     ttsPlay(1);
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
                selectttsRATE.style.display = "inline-block";
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
                selectttsRATE.style.display = "none";
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
                selectttsRATE.style.display = "inline-block";
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
                selectttsRATE.style.display = "none";
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

        initHighlightsFromStore();

        highlightsClickListen((href: string, highlight: IHighlight) => {
            highlightsRemove(href, [highlight.id]);
            const foundHighlightData = _highlights.find((highlightData) => {
                return highlightData.highlight.id === highlight.id;
            });
            if (foundHighlightData) {
                const i = _highlights.indexOf(foundHighlightData);
                if (i >= 0) {
                    _highlights.splice(i, 1);
                    refreshHighlightsStore();
                }
            }
        });

        const FAKE_URL_HIGHLIGHTS = "https://highlights.me/";
        const optsHighlights: IRiotOptsLinkListGroup = {
            basic: electronStore.get("basicLinkTitles"),
            handleLink: (href: string) => {
                href = href.startsWith(FAKE_URL_HIGHLIGHTS) ? href.substr(FAKE_URL_HIGHLIGHTS.length) : href;
                const fragToken = `#${R2_LOC_CSSSELECTOR}(`;
                const i = href.indexOf(fragToken);
                if (i > 0) {
                    const j = i + fragToken.length;
                    const cssSelector = decodeURIComponent(href.substr(j, href.length - j - 1));
                    href = href.substr(0, i);
                    const locator = {
                        href,
                        locations: {
                            cssSelector,
                        },
                    };
                    handleLinkLocator_(locator);
                }
            },
            linksgroup: [] as IRiotOptsLinkListGroupItem[],
            url: FAKE_URL_HIGHLIGHTS, // publicationJsonUrl,
        };
        const tagHighlights =
            riotMountLinkListGroup("#reader_controls_HIGHLIGHTS", optsHighlights)[0] as IRiotTagLinkListGroup;
        electronStore.onChanged("basicLinkTitles", (newValue: any, oldValue: any) => {
            if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
                return;
            }
            tagHighlights.setBasic(newValue);
        });

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

        const FAKE_URL_BOOKMARKS = "https://bookmarks.me/";
        const optsBookmarks: IRiotOptsLinkListGroup = {
            basic: electronStore.get("basicLinkTitles"),
            handleLink: (href: string) => {
                console.log(href);
                href = href.startsWith(FAKE_URL_BOOKMARKS) ? href.substr(FAKE_URL_BOOKMARKS.length) : href;
                let isProgression = false;
                let fragToken = `#${R2_LOC_CSSSELECTOR}(`;
                let i = href.indexOf(fragToken);
                console.log(i);
                if (i < 0) {
                    fragToken = `#${R2_LOC_PROGRESSION}(`;
                    i = href.indexOf(fragToken);
                    console.log(i);
                    if (i > 0) {
                        isProgression = true;
                    }
                }
                if (i > 0) {
                    const j = i + fragToken.length;
                    const data = decodeURIComponent(href.substr(j, href.length - j - 1));
                    const cssSelector = isProgression ? undefined : data;
                    const progression = isProgression ? parseFloat(data) : undefined;
                    href = href.substr(0, i);
                    const locator: Locator = {
                        href,
                        locations: {
                            cssSelector,
                            progression,
                        },
                    };
                    handleLinkLocator_(locator);
                }
            },
            linksgroup: [] as IRiotOptsLinkListGroupItem[],
            url: FAKE_URL_BOOKMARKS, // publicationJsonUrl,
        };
        const tagBookmarks =
            riotMountLinkListGroup("#reader_controls_BOOKMARKS", optsBookmarks)[0] as IRiotTagLinkListGroup;
        electronStore.onChanged("basicLinkTitles", (newValue: any, oldValue: any) => {
            if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
                return;
            }
            tagBookmarks.setBasic(newValue);
        });

        if (_publication.Spine && _publication.Spine.length) {

            const opts: IRiotOptsLinkList = {
                basic: electronStore.get("basicLinkTitles"),
                handleLink: handleLink_,
                links: (_publicationJSON.spine || _publicationJSON.readingOrder) as IRiotOptsLinkListItem[],
                url: publicationJsonUrl,
            };
            const tag = riotMountLinkList("#reader_controls_SPINE", opts)[0] as IRiotTagLinkList;

            electronStore.onChanged("basicLinkTitles", (newValue: any, oldValue: any) => {
                if (typeof newValue === "undefined" || typeof oldValue === "undefined") {
                    return;
                }
                tag.setBasic(newValue);
            });
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
                } else if (typeof obj.locProgression !== "undefined") {
                    location = {
                        href: obj.doc,
                        locations: { cfi: undefined, cssSelector: undefined, progression: obj.locProgression },
                    };
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

            let foundLink: Link | undefined;
            if (_publication && location) {
                if (_publication.Spine) {
                    foundLink = _publication.Spine.find((link) => {
                        return typeof location !== "undefined" &&
                            link.Href === location.href;
                    });
                }
                if (!foundLink && _publication.Resources) {
                    foundLink = _publication.Resources.find((link) => {
                        return typeof location !== "undefined" &&
                            link.Href === location.href;
                    });
                }
            }
            // console.log(location);
            const locatorExtended: LocatorExtended | undefined = location ? {
                audioPlaybackInfo: undefined,
                docInfo: {
                    isFixedLayout: isFixedLayout(_publication as Publication, foundLink),
                    isRightToLeft: false,
                    isVerticalWritingMode: false,
                },
                epubPage: undefined,
                locator: location,
                paginationInfo: undefined,
                selectionInfo: undefined,
                selectionIsNew: undefined,
            } : undefined;
            updateReadingProgressionSlider(locatorExtended);

            installNavigatorDOM(
                _publication as Publication,
                publicationJsonUrl,
                rootHtmlElementID,
                preloadPath,
                location,
                true,
                undefined,
                undefined,
                computeReadiumCssJsonMessage(),
                );
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

function handleLinkLocator_(locator: Locator) {
    if (drawer.open) {
        drawer.open = false;
        setTimeout(() => {
            console.log("handleLinkLocator (timeout) from handleLinkLocator_");
            handleLinkLocator(locator);
        }, 200);
    } else {
        console.log("handleLinkLocator from handleLinkLocator_");
        handleLinkLocator(locator);
    }
}
