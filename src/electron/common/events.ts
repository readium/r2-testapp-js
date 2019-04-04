// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

// in RENDERER: ipcRenderer.send()
// in MAIN: ipcMain.on()
export const R2_EVENT_DEVTOOLS = "R2_EVENT_DEVTOOLS";

// in RENDERER: ipcRenderer.send()
// in MAIN: ipcMain.on()
export const R2_EVENT_OPEN_URL_OR_PATH = "R2_EVENT_OPEN_URL_OR_PATH";
// tslint:disable-next-line:class-name
export interface IEventPayload_R2_EVENT_OPEN_URL_OR_PATH {
    urlOrPath: string;
}

// in RENDERER: ipcRenderer.send()
// in MAIN: ipcMain.on()
export const R2_EVENT_LCP_LSD_RETURN = "R2_EVENT_LCP_LSD_RETURN";
// tslint:disable-next-line:class-name
export interface IEventPayload_R2_EVENT_LCP_LSD_RETURN {
    publicationFilePath: string;
}

// in MAIN: event.sender.send(), where event is from the above ipcMain.on()
// in RENDERER: ipcRenderer.on()
export const R2_EVENT_LCP_LSD_RETURN_RES = "R2_EVENT_LCP_LSD_RETURN_RES";
// tslint:disable-next-line:class-name
export interface IEventPayload_R2_EVENT_LCP_LSD_RETURN_RES {
    okay: boolean;
    error: string | undefined;
    lsdJson: any | undefined;
}

// in RENDERER: ipcRenderer.send()
// in MAIN: ipcMain.on()
export const R2_EVENT_LCP_LSD_RENEW = "R2_EVENT_LCP_LSD_RENEW";
// tslint:disable-next-line:class-name
export interface IEventPayload_R2_EVENT_LCP_LSD_RENEW {
    publicationFilePath: string;
    endDateStr: string | undefined;
}

// in MAIN: event.sender.send(), where event is from the above ipcMain.on()
// in RENDERER: ipcRenderer.on()
export const R2_EVENT_LCP_LSD_RENEW_RES = "R2_EVENT_LCP_LSD_RENEW_RES";
// tslint:disable-next-line:class-name
export interface IEventPayload_R2_EVENT_LCP_LSD_RENEW_RES {
    okay: boolean;
    error: string | undefined;
    lsdJson: any | undefined;
}

// in RENDERER: ipcRenderer.send()
// in MAIN: ipcMain.on()
export const R2_EVENT_TRY_LCP_PASS = "R2_EVENT_TRY_LCP_PASS";
// tslint:disable-next-line:class-name
export interface IEventPayload_R2_EVENT_TRY_LCP_PASS {
    publicationFilePath: string;
    lcpPass: string;
    isSha256Hex: boolean;
}

// in MAIN: event.sender.send(), where event is from the above ipcMain.on()
// in RENDERER: ipcRenderer.on()
export const R2_EVENT_TRY_LCP_PASS_RES = "R2_EVENT_TRY_LCP_PASS_RES";
// tslint:disable-next-line:class-name
export interface IEventPayload_R2_EVENT_TRY_LCP_PASS_RES {
    okay: boolean;
    error: string | number | undefined;
    passSha256Hex: string | undefined;
}
